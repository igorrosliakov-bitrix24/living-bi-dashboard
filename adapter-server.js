import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { getBiConnectorData, getBiConnectorDescription, getBiConnectorTables } from "./lib/bi-connector-demo.js";
import { parseConnectorForm } from "./lib/connector-request.js";
import { dealIntakeTable, loadDealIntakeDataset, selectDealIntakeRows } from "./lib/deal-intake-dataset.js";
import { TtlCache } from "./lib/ttl-cache.js";
import { getValidOauthState, writeOauthState } from "./lib/oauth-state.js";
import { ConnectorStatusStore } from "./lib/connector-status.js";
import { DatasetRegistry } from "./lib/dataset-registry.js";
import { buildDatasetDraftFromSpec } from "./lib/dataset-spec.js";
import { loadDealDataset, selectDealDatasetRows } from "./lib/deal-dataset-engine.js";
import { getDynamicDescription, mergeDynamicTables } from "./lib/dynamic-adapter.js";
import { createBitrixRestClient } from "./lib/bitrix-rest.js";
import { listDealCategories } from "./lib/bitrix-crm-reader.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const statePath = process.env.OAUTH_ADAPTER_STATE_PATH || "/data/living-bi-oauth-adapter/auth.json";
const applicationToken = process.env.BITRIX24_APPLICATION_TOKEN || "";
const installSecret = process.env.BITRIX24_INSTALL_SECRET || "";
const oauthClientId = process.env.BITRIX24_OAUTH_CLIENT_ID || "";
const oauthClientSecret = process.env.BITRIX24_OAUTH_CLIENT_SECRET || "";
const oauthEncryptionKey = process.env.OAUTH_STATE_ENCRYPTION_KEY || "";
const connectorLogPath = process.env.BI_CONNECTOR_LOG_PATH || "/tmp/living-bi-connector-events.log";
const connectorStatusPath = process.env.BI_CONNECTOR_STATUS_PATH || "/tmp/living-bi-connector-status.json";
const datasetRegistryPath = process.env.DATASET_REGISTRY_PATH || "/opt/data/state/dataset-specs.json";
const adapterControlKey = process.env.ADAPTER_CONTROL_KEY || installSecret;
const datasetCache = new TtlCache({ ttlMs: 5 * 60 * 1_000 });
const connectorStatus = await ConnectorStatusStore.open({ statusPath: connectorStatusPath });
const datasetRegistry = await DatasetRegistry.open({ registryPath: datasetRegistryPath });

await bootstrapOauthState();

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        configured: Boolean(installSecret && oauthClientId && oauthClientSecret && oauthEncryptionKey),
        oauthStorage: oauthEncryptionKey ? "encrypted" : "plaintext_development_only",
        synchronization: connectorStatus.snapshot()
        ,dynamicDatasets: { configured: Boolean(adapterControlKey), active: datasetRegistry.list({ includePending: false }).length }
      });
    }

    if (req.method === "POST" && url.pathname === "/control/datasets") {
      requireControlKey(req);
      const body = await readJsonBody(req);
      let result;
      if (body.action === "stage") result = await datasetRegistry.stage({ datasetName: body.datasetName, spec: body.spec });
      else if (body.action === "activate") result = await datasetRegistry.activate(body.datasetName);
      else if (body.action === "fail") result = await datasetRegistry.fail(body.datasetName, body.error);
      else if (body.action === "remove") result = { removed: await datasetRegistry.remove(body.datasetName) };
      else if (body.action === "list") result = datasetRegistry.list();
      else throw new Error("unsupported_control_action");
      datasetCache.delete(body.datasetName);
      return sendJson(res, 200, { ok: true, result });
    }
    if (req.method === "POST" && url.pathname === "/control/refresh") {
      requireControlKey(req);
      const body = await readJsonBody(req);
      datasetCache.delete(body.datasetName);
      const snapshot = await getDynamicSnapshot(body.datasetName);
      await connectorStatus.recordSuccess({ table: body.datasetName });
      return sendJson(res, 200, { ok: true, datasetName: body.datasetName, rowCount: snapshot.rows.length, refreshedAt: new Date().toISOString() });
    }
    if (req.method === "POST" && url.pathname === "/control/bitrix") {
      requireControlKey(req);
      const body = await readJsonBody(req);
      if (!/^biconnector\.(?:dataset|source|connector)(?:\.fields)?\.(?:list|get|add|update|delete)$/.test(body.method)) throw new Error("unsupported_bitrix_method");
      const result = await withOauth((auth) => createBitrixRestClient({ portalUrl: `https://${auth.domain}`, accessToken: auth.accessToken }).call(body.method, body.params));
      return sendJson(res, 200, { ok: true, result });
    }
    if (req.method === "POST" && url.pathname === "/control/categories") {
      requireControlKey(req);
      const categories = await withOauth((auth) => listDealCategories({ portalUrl: `https://${auth.domain}`, accessToken: auth.accessToken }));
      return sendJson(res, 200, { ok: true, categories });
    }

    if (req.method === "POST" && url.pathname === "/bitrix/handler") {
      return sendJson(res, 200, { ok: true, mode: "api_only" });
    }

    if (req.method === "POST" && url.pathname === "/bitrix/install") {
      const body = await readFormBody(req);
      const auth = extractAuth(body);
      const secretMatches = installSecret && url.searchParams.get("install_secret") === installSecret;
      const tokenMatches = applicationToken && auth.application_token === applicationToken;
      if (!secretMatches && !tokenMatches) {
        return sendJson(res, 403, { ok: false, error: "installation_not_authorized" });
      }
      await saveAuth(auth);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/bi-connector/check") {
      await connectorStatus.recordSuccess();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/bi-connector/tables") {
      const request = await readConnectorBody(req);
      await logConnectorRequest(url.pathname, request);
      await connectorStatus.recordSuccess({ table: request.body.table });
      return sendJson(res, 200, mergeDynamicTables(getBiConnectorTables(request.body.searchString), datasetRegistry.list(), request.body.searchString));
    }
    if (req.method === "POST" && url.pathname === "/bi-connector/table-description") {
      const request = await readConnectorBody(req);
      await logConnectorRequest(url.pathname, request);
      await connectorStatus.recordSuccess({ table: request.body.table || request.body.name });
      const table = request.body.table || request.body.name;
      const dynamic = getDynamicDescription(datasetRegistry.get(table));
      return sendJson(res, 200, dynamic.length ? dynamic : getBiConnectorDescription(table));
    }
    if (req.method === "POST" && url.pathname === "/bi-connector/data") {
      const request = await readConnectorBody(req);
      await logConnectorRequest(url.pathname, request);
      if (request.body.table === dealIntakeTable.code) {
        const snapshot = await getDealIntakeSnapshot();
        const result = selectDealIntakeRows(snapshot.rows, request.body);
        await connectorStatus.recordSuccess({ table: request.body.table });
        return sendJson(res, 200, result);
      }
      if (["active", "pending"].includes(datasetRegistry.get(request.body.table)?.status)) {
        const record = datasetRegistry.get(request.body.table);
        const snapshot = await getDynamicSnapshot(request.body.table);
        const draft = buildDatasetDraftFromSpec(record.spec, { request: record.spec.request });
        const result = selectDealDatasetRows(snapshot.rows, draft, request.body);
        await connectorStatus.recordSuccess({ table: request.body.table });
        return sendJson(res, 200, result);
      }
      const result = getBiConnectorData(request.body);
      await connectorStatus.recordSuccess({ table: request.body.table });
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    console.error("BI adapter request failed", {
      route: url.pathname,
      method: req.method,
      code: error?.code || null,
      message: error instanceof Error ? error.message : String(error)
    });
    const isControlRoute = url.pathname.startsWith("/control/");

    // Статус синхронизации описывает обращения BI-коннектора. Отказы служебных
    // маршрутов не должны помечать коннектор сбойным.
    if (!isControlRoute) await connectorStatus.recordError(error?.code || "request_failed");

    if (error?.code === "adapter_control_unauthorized") {
      return sendJson(res, 403, { ok: false, error: error.code });
    }

    // Управляющие маршруты аутентифицированы, поэтому возвращают настоящий код
    // и текст ошибки Битрикс24 — иначе причину сбоя публикации не найти.
    if (isControlRoute) {
      return sendJson(res, 400, {
        ok: false,
        error: error?.code || "control_request_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return sendJson(res, 400, { ok: false, error: "invalid_request" });
  }
}).listen(port, host, () => console.info(`OAuth adapter listening on ${host}:${port}`));

async function saveAuth(auth) {
  const record = {
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token,
    clientEndpoint: auth.client_endpoint,
    domain: auth.domain,
    expiresAt: Date.now() + Number(auth.expires_in || 3600) * 1000
  };
  await writeOauthState(statePath, record, { encryptionKey: oauthEncryptionKey });
}

async function bootstrapOauthState() {
  const encodedState = process.env.OAUTH_INITIAL_STATE_BASE64;
  if (!encodedState || existsSync(statePath)) return;
  let initialState;
  try {
    initialState = JSON.parse(Buffer.from(encodedState, "base64").toString("utf8"));
  } catch {
    throw new Error("OAUTH_INITIAL_STATE_BASE64 содержит некорректное OAuth state.");
  } finally {
    delete process.env.OAUTH_INITIAL_STATE_BASE64;
  }
  await writeOauthState(statePath, initialState, { encryptionKey: oauthEncryptionKey });
}

async function getDealIntakeSnapshot() {
  const cached = datasetCache.get(dealIntakeTable.code);
  if (cached) return cached;

  let auth = await getValidOauthState({
    statePath,
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    encryptionKey: oauthEncryptionKey
  });
  let snapshot;
  try {
    snapshot = await loadDealIntakeDataset({
      clientEndpoint: auth.clientEndpoint,
      accessToken: auth.accessToken
    });
  } catch (error) {
    if (error.code !== "expired_token") throw error;
    auth = await getValidOauthState({
      statePath,
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      forceRefresh: true,
      encryptionKey: oauthEncryptionKey
    });
    snapshot = await loadDealIntakeDataset({
      clientEndpoint: auth.clientEndpoint,
      accessToken: auth.accessToken
    });
  }
  datasetCache.set(dealIntakeTable.code, snapshot);
  return snapshot;
}

async function getDynamicSnapshot(datasetName) {
  const cached = datasetCache.get(datasetName);
  if (cached) return cached;
  const record = datasetRegistry.get(datasetName);
  if (!record || !["active", "pending"].includes(record.status)) throw new Error("dynamic_dataset_not_available");
  const snapshot = await withOauth((auth) => loadDealDataset({ clientEndpoint: auth.clientEndpoint, accessToken: auth.accessToken, spec: record.spec }));
  datasetCache.set(datasetName, snapshot);
  return snapshot;
}

async function withOauth(operation) {
  let auth = await getValidOauthState({ statePath, clientId: oauthClientId, clientSecret: oauthClientSecret, encryptionKey: oauthEncryptionKey });
  try { return await operation(auth); } catch (error) {
    if (error.code !== "expired_token") throw error;
    auth = await getValidOauthState({ statePath, clientId: oauthClientId, clientSecret: oauthClientSecret, forceRefresh: true, encryptionKey: oauthEncryptionKey });
    return operation(auth);
  }
}

function extractAuth(body) {
  const auth = body.auth;
  if (!auth || typeof auth !== "object" || !auth.access_token || !auth.refresh_token || !auth.application_token) {
    throw new Error("missing_installation_auth");
  }
  return auth;
}

async function readFormBody(req) {
  const raw = await readRawBody(req);
  const params = new URLSearchParams(raw);
  const auth = {};
  for (const [key, value] of params) {
    const match = key.match(/^auth\[([^\]]+)\]$/);
    if (match) auth[match[1]] = value;
  }
  return { auth };
}

async function readConnectorBody(req) {
  const raw = await readRawBody(req);
  const contentType = String(req.headers["content-type"] || "");
  if (!raw) {
    return { body: {}, contentType };
  }
  if (contentType.includes("application/json")) {
    return { body: JSON.parse(raw), contentType };
  }
  return { body: parseConnectorForm(raw), contentType };
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  const value = JSON.parse(raw || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json_body");
  return value;
}

function requireControlKey(req) {
  const supplied = String(req.headers["x-adapter-control-key"] || "");
  if (!adapterControlKey || supplied.length !== adapterControlKey.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(adapterControlKey))) {
    const error = new Error("adapter_control_unauthorized"); error.code = "adapter_control_unauthorized"; throw error;
  }
}

async function logConnectorRequest(route, request) {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const event = {
    at: new Date().toISOString(),
    route,
    contentType: request.contentType,
    keys: Object.keys(body).sort(),
    table: typeof body.table === "string" ? body.table : undefined,
    select: Array.isArray(body.select) ? body.select : undefined
  };
  await appendFile(connectorLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
