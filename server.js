import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialDashboard } from "./lib/dashboard-spec.js";
import { demoNamespace } from "./lib/demo-seed.js";
import { FileDashboardStore } from "./lib/file-dashboard-store.js";
import { buildAggregateRequest, calculateComputedWidget, normalizeWidgetData } from "./lib/dashboard-data.js";
import { isDashboardEntity, listDashboardEntities } from "./lib/entities.js";
import { extractFieldNames, validateDashboardFields } from "./lib/dashboard-fields.js";
import { mapWithConcurrency, TtlCache } from "./lib/ttl-cache.js";
import { resolveDashboardEditAccess } from "./lib/dashboard-access.js";
import { buildVibeHeaders, getGatewayAuthorization, getGatewayUser } from "./lib/gateway.js";
import { GatewaySessionStore } from "./lib/gateway-session.js";
import { RequestBodyError, readJsonBody } from "./lib/request-body.js";
import { AiDashboardError, buildDashboardDiff, createAiCompletionRequest, createConversionCommandProposal, createDevelopmentFallback, createDevelopmentRequest, createDevelopmentRequestCompletion, createProposalFromPatch, createVisualCommandProposal, extractAiToolCalls, needsAggregatePreview } from "./lib/ai-dashboard.js";
import { validateDashboardSpec } from "./lib/dashboard-spec.js";
import { resolveCategoryExclusions } from "./lib/dashboard-rules.js";
import { getBiConnectorData, getBiConnectorDescription, getBiConnectorTables } from "./lib/bi-connector-demo.js";
import { buildDatasetDraft, confirmDatasetDraft, DatasetDraftError } from "./lib/dataset-draft.js";
import { createDatasetPlannerRequest, DatasetPlannerError, parseDatasetPlannerResponse } from "./lib/dataset-planner.js";
import { DatasetPublisherError, deleteDatasetDraft, getPublisherReadiness, listPortalDatasetNames, previewDynamicDatasetPublication, publishDynamicDataset, reconcileManagedDatasets } from "./lib/dataset-publisher.js";
import { AdapterControlClient } from "./lib/adapter-control-client.js";
import { validateSpecCategoryNames } from "./lib/bitrix-crm-reader.js";
import { buildDatasetDraftFromSpec } from "./lib/dataset-spec.js";
import { BitrixRestError } from "./lib/bitrix-rest.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

loadEnv(join(__dirname, ".env"));

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || (isProduction ? 3000 : 5174));
const host = process.env.HOST || (isProduction ? "0.0.0.0" : "127.0.0.1");
const apiBase = process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech";
const apiKey = process.env.VIBECODE_API_KEY || "";
const appKey = process.env.VIBE_APP_KEY || process.env.VIBECODE_APP_KEY || "";
const dashboardStatePath = process.env.DASHBOARD_STATE_PATH || join(
  isProduction ? "/data/living-bi-dashboard" : join(__dirname, ".data"),
  "dashboard-state.json"
);
const dashboardStore = new FileDashboardStore({ initialSpec: createInitialDashboard(), statePath: dashboardStatePath });
const fieldCache = new TtlCache({ ttlMs: 5 * 60 * 1_000 });
const aggregateCache = new TtlCache({ ttlMs: 5 * 60 * 1_000 });
const gatewaySessions = new GatewaySessionStore();
const datasetDrafts = new Map();

await dashboardStore.load();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    rememberGatewaySession(req, res, url);

    if (isProduction && (url.pathname === "/" || url.pathname === "/api/session")) {
      console.info("Gateway request diagnostic", {
        path: url.pathname,
        hasAuthorization: Boolean(getGatewayAuthorization(req.headers)),
        hasOAuthCode: url.searchParams.has("code"),
        placement: url.searchParams.get("placement") || null,
        vibeHeaders: Object.keys(req.headers).filter((name) => name.startsWith("x-vibe-"))
      });
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        hasApiKey: Boolean(apiKey),
        hasAppKey: Boolean(appKey),
        gatewaySession: Boolean(getGatewayAuthorization(req.headers)),
        apiBase
      });
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      return await handleVibecodeMe(req, res);
    }

    if (url.pathname === "/api/session" && req.method === "GET") {
      return await getSession(req, res);
    }

    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      return sendJson(res, 200, { dashboard: dashboardStore.getCurrent() }, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/dashboard" && req.method === "POST") {
      return await saveDashboard(req, res);
    }

    if (url.pathname === "/api/dashboard/versions" && req.method === "GET") {
      return sendJson(res, 200, { versions: dashboardStore.listVersions() }, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/dashboard/restore" && req.method === "POST") {
      return await restoreDashboard(req, res);
    }

    if (url.pathname === "/api/dashboard/reset" && req.method === "POST") {
      return await resetDashboard(req, res);
    }

    if (url.pathname === "/api/dashboard/ai-draft" && req.method === "POST") {
      return await createAiDraft(req, res);
    }

    if (url.pathname === "/api/datasets/draft/preview" && req.method === "POST") {
      return await previewDatasetDraft(req, res);
    }

    if (url.pathname === "/api/datasets/ai-preview" && req.method === "POST") {
      return await previewDatasetWithAi(req, res);
    }

    if (url.pathname === "/api/datasets/draft/confirm" && req.method === "POST") {
      return await confirmDatasetDraftRoute(req, res);
    }

    if (url.pathname === "/api/datasets/publish/readiness" && req.method === "GET") {
      return await getDatasetPublisherReadiness(req, res);
    }

    if (url.pathname === "/api/datasets/managed" && req.method === "GET") {
      return await listManagedDatasets(req, res);
    }

    if (url.pathname === "/api/datasets/publish" && req.method === "POST") {
      return await publishDataset(req, res);
    }

    if (url.pathname === "/api/datasets/publish/preview" && req.method === "POST") {
      return await previewDatasetPublication(req, res);
    }

    if (url.pathname === "/api/datasets/refresh" && req.method === "POST") {
      return await refreshDataset(req, res);
    }

    if (url.pathname === "/api/datasets/publish/status" && req.method === "GET") {
      return await getDatasetPublisherStatus(req, res);
    }

    if (url.pathname === "/api/datasets/publish/delete" && req.method === "POST") {
      return await deleteDataset(req, res);
    }

    if (url.pathname === "/api/dashboard/data" && req.method === "GET") {
      return await getDashboardData(req, res, url.searchParams.has("refresh"));
    }

    if (url.pathname === "/api/entities" && req.method === "GET") {
      return listEntities(res);
    }

    if (url.pathname === "/api/demo-data" && req.method === "GET") {
      return await getDemoData(req, res);
    }

    if (url.pathname === "/api/bi-connector/check" && req.method === "POST") {
      return sendJson(res, 200, { ok: true, connector: "living-bi-dashboard" });
    }

    if (url.pathname === "/api/bi-connector/tables" && req.method === "POST") {
      const body = await readConnectorBody(req);
      return sendJson(res, 200, getBiConnectorTables(body.searchString));
    }

    if (url.pathname === "/api/bi-connector/table-description" && req.method === "POST") {
      const body = await readConnectorBody(req);
      return sendJson(res, 200, getBiConnectorDescription(body.table || body.name));
    }

    if (url.pathname === "/api/bi-connector/data" && req.method === "POST") {
      const body = await readConnectorBody(req);
      return sendJson(res, 200, getBiConnectorData(body));
    }

    const fieldsMatch = url.pathname.match(/^\/api\/entities\/([a-z-]+)\/fields$/);

    if (fieldsMatch && req.method === "GET") {
      return await getEntityFields(req, res, fieldsMatch[1]);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    return sendJson(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection", { message: reason instanceof Error ? reason.message : String(reason) });
});

server.listen(port, host, () => {
  console.log(`BI report prototype: http://${host}:${port}`);
});

async function handleVibecodeMe(req, res) {
  const headers = resolveVibeHeaders(req);

  if (!headers) {
    return sendGatewayRequired(res);
  }

  const response = await fetch(`${apiBase}/v1/me`, { headers });
  return sendJson(res, response.status, await readJson(response));
}

function getSession(req, res) {
  const context = getGatewayContext(req);

  if (context) {
    return sendJson(res, 200, {
      authenticated: true,
      mode: "gateway",
      user: context.user
    }, { "Cache-Control": "no-store" });
  }

  return sendJson(res, 200, {
    authenticated: false,
    mode: isProduction ? "gateway_required" : "local_development",
    user: null
  }, { "Cache-Control": "no-store" });
}

async function listEntities(res) {
  const guideKey = appKey || apiKey;

  if (!guideKey) {
    return sendJson(res, 400, { error: "missing_key", message: "Add VIBE_APP_KEY or VIBECODE_API_KEY to .env" });
  }

  const response = await fetch(`${apiBase}/v1/guide`, {
    headers: { "X-Api-Key": guideKey, "Accept": "application/json" }
  });
  const payload = await readJson(response);

  if (!response.ok) {
    return sendJson(res, response.status, { error: "entity_guide_failed", message: "Не удалось получить список сущностей." });
  }

  return sendJson(res, 200, { entities: listDashboardEntities(payload.data?.entities) }, { "Cache-Control": "no-store" });
}

async function getEntityFields(req, res, entity) {
  if (!isDashboardEntity(entity)) {
    return sendJson(res, 400, { error: "unsupported_entity", message: "Эта сущность не входит в MVP." });
  }

  const headers = resolveVibeHeaders(req);

  if (!headers) {
    return sendGatewayRequired(res);
  }

  const response = await fetch(`${apiBase}/v1/${entity}/fields`, { headers });
  return sendJson(res, response.status, await readJson(response));
}

async function getDemoData(req, res) {
  const headers = resolveVibeHeaders(req);

  if (!headers) {
    return sendGatewayRequired(res);
  }

  const entities = ["deals", "companies", "tasks"];
  const response = await fetch(`${apiBase}/v1/batch`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      calls: entities.map((entity) => ({
        id: entity,
        entity,
        action: "list",
        params: {
          filter: { title: { "$contains": demoNamespace } },
          select: ["title", "stageId", "amount", "deadline"],
          limit: 50,
          withTotal: false
        }
      }))
    })
  });
  const payload = await readJson(response);

  if (!response.ok) {
    return sendJson(res, response.status, { error: "demo_data_failed", message: "Не удалось получить тестовые данные." });
  }

  const sources = Object.fromEntries(entities.map((entity) => [entity, sanitizeDemoRecords(payload.data?.results?.[entity]) ]));
  return sendJson(res, 200, { sources }, { "Cache-Control": "no-store" });
}

function sanitizeDemoRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((record) => ({
    title: typeof record.title === "string" ? record.title : "Без названия",
    stageId: typeof record.stageId === "string" ? record.stageId : null,
    amount: typeof record.amount === "number" ? record.amount : null,
    deadline: typeof record.deadline === "string" ? record.deadline : null
  }));
}

function resolveVibeHeaders(req) {
  const gatewayAuthorization = getGatewayContext(req)?.authorization;

  if (gatewayAuthorization) {
    return buildVibeHeaders({ appKey, apiKey: "", gatewayAuthorization });
  }

  if (!isProduction) {
    return buildVibeHeaders({ appKey: "", apiKey, gatewayAuthorization: null });
  }

  return null;
}

function rememberGatewaySession(req, res, url) {
  if (!isProduction || (url.pathname !== "/" && url.pathname !== "/index.html")) {
    return;
  }

  const authorization = getGatewayAuthorization(req.headers);
  if (!authorization) {
    return;
  }

  const memberId = getMemberId(url.searchParams.get("member_id"));
  const sessionId = gatewaySessions.create({ authorization, user: getGatewayUser(req.headers) }, memberId || undefined);
  if (!memberId) {
    res.setHeader("Set-Cookie", gatewaySessions.cookie(sessionId, true));
  }
}

function getGatewayContext(req) {
  const authorization = getGatewayAuthorization(req.headers);
  if (authorization) {
    return { authorization, user: getGatewayUser(req.headers) };
  }

  const memberSession = gatewaySessions.getById(getMemberId(req.headers["x-dashboard-member-id"]));
  return memberSession || gatewaySessions.get(req.headers.cookie);
}

function getMemberId(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && /^[a-f0-9]{32}$/i.test(raw) ? raw : null;
}

function getRequestUser(req) {
  return getGatewayContext(req)?.user || null;
}

function sendGatewayRequired(res) {
  return sendJson(res, 401, {
    error: "gateway_session_required",
    message: "Откройте приложение через размещение в Битрикс24, чтобы Gateway передал сессию пользователя.",
    reopen: true
  });
}

async function readConnectorBody(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    return {};
  }
  try {
    return await readJsonBody(req);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      throw new Error("Некорректный запрос коннектора BI.");
    }
    throw error;
  }
}

async function saveDashboard(req, res) {
  if (!canEditDashboard(req, res)) {
    return;
  }

  if (!req.headers["content-type"]?.startsWith("application/json")) {
    return sendJson(res, 415, { error: "unsupported_content_type", message: "Передайте изменение в формате JSON." });
  }

  try {
    const body = await readJsonBody(req);

    if (!Number.isInteger(body?.expectedVersion) || !body.dashboard || typeof body.dashboard !== "object") {
      return sendJson(res, 400, {
        error: "invalid_update",
        message: "Нужны dashboard и целочисленная expectedVersion."
      });
    }

    const fieldsValidation = await validateDashboardForPortal(req, body.dashboard);

    if (!fieldsValidation.valid) {
      return sendJson(res, 400, { error: "unknown_dashboard_field", message: fieldsValidation.errors.join(" ") });
    }

    const result = await dashboardStore.save(body.dashboard, body.expectedVersion);

    if (!result.saved && result.error === "version_conflict") {
      return sendJson(res, 409, result);
    }

    if (!result.saved) {
      return sendJson(res, result.error === "storage_unavailable" ? 503 : 400, result);
    }

    return sendJson(res, 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return sendJson(res, error.code === "body_too_large" ? 413 : 400, {
        error: error.code,
        message: error.message
      });
    }

    throw error;
  }
}

async function createAiDraft(req, res) {
  if (!canEditDashboard(req, res)) {
    return;
  }

  if (!req.headers["content-type"]?.startsWith("application/json")) {
    return sendJson(res, 415, { error: "unsupported_content_type", message: "Передайте команду в формате JSON." });
  }

  let command;
  let headers;

  try {
    const body = await readJsonBody(req);
    command = body?.command;
    const current = dashboardStore.getCurrent();

    if (!Number.isInteger(body?.expectedVersion) || body.expectedVersion !== current.version) {
      return sendJson(res, 409, { error: "version_conflict", currentVersion: current.version });
    }

    headers = resolveVibeHeaders(req);

    if (!headers) {
      return sendGatewayRequired(res);
    }

    const visualProposal = createVisualCommandProposal(body.command, current);
    if (visualProposal) {
      const fieldsValidation = await validateDashboardForPortal(req, visualProposal.dashboard);

      if (!fieldsValidation.valid) {
        throw new AiDashboardError("ai_unknown_dashboard_field", fieldsValidation.errors.join(" "));
      }

      return sendJson(res, 200, { proposal: { ...visualProposal, changes: buildDashboardDiff(current, visualProposal.dashboard) } }, { "Cache-Control": "no-store" });
    }

    const conversionProposal = createConversionCommandProposal(body.command, current);
    if (conversionProposal) {
      const fieldsValidation = await validateDashboardForPortal(req, conversionProposal.dashboard);

      if (!fieldsValidation.valid) {
        throw new AiDashboardError("ai_unknown_dashboard_field", fieldsValidation.errors.join(" "));
      }

      const preview = await previewDashboardWidgets(conversionProposal.dashboard, headers);
      return sendJson(res, 200, { proposal: { ...conversionProposal, changes: [...buildDashboardDiff(current, conversionProposal.dashboard), ...preview.warnings] } }, { "Cache-Control": "no-store" });
    }

    const result = await runAiToolLoop({ command: body.command, current, headers, req });

    if (result.kind === "development_request") {
      return sendJson(res, 200, { developmentRequest: result.developmentRequest }, { "Cache-Control": "no-store" });
    }

    return sendJson(res, 200, { proposal: { ...result.proposal, changes: buildDashboardDiff(current, result.proposal.dashboard) } }, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof AiDashboardError && command && shouldCreateDevelopmentFallback(error)) {
      const developmentRequest = await createAiDevelopmentFallback(command, headers);
      return sendJson(res, 200, { developmentRequest }, { "Cache-Control": "no-store" });
    }

    if (error instanceof RequestBodyError || error instanceof AiDashboardError) {
      return sendJson(res, 400, { error: error.code, message: error.message });
    }

    if (error.name === "TimeoutError") {
      return sendJson(res, 504, { error: "ai_timeout", message: "ИИ не успел подготовить черновик. Повторите запрос." });
    }

    throw error;
  }
}

async function previewDatasetDraft(req, res) {
  if (!canEditDashboard(req, res)) return;
  try {
    const body = await readJsonRequest(req, "Передайте запрос к датасету в формате JSON.");
    const draft = buildDatasetDraft({ request: body?.request });
    return sendJson(res, 200, { draft }, { "Cache-Control": "no-store" });
  } catch (error) {
    return handleDatasetDraftError(error, res);
  }
}

async function previewDatasetWithAi(req, res) {
  if (!canEditDashboard(req, res)) return;
  try {
    const body = await readJsonRequest(req, "Передайте запрос к датасету в формате JSON.");
    const headers = resolveVibeHeaders(req);
    if (!headers) return sendGatewayRequired(res);

    // Состав выбранного набора нужен модели до вызова: без него «добавь поле»
    // строит спецификацию с нуля и удаляет прежние метрики.
    const target = body?.targetDatasetName ? await findManagedDataset(body.targetDatasetName) : null;

    const response = await fetch(`${apiBase}/v1/chat/completions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(createDatasetPlannerRequest(body?.request, target?.spec)),
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new DatasetPlannerError("dataset_planner_failed", "BitrixGPT не смог подготовить рецепт. Повторите запрос.");
    }

    const result = parseDatasetPlannerResponse(payload, body?.request);
    if (result.kind === "draft" && target) {
      result.draft.datasetName = target.datasetName;
    }
    return sendJson(res, 200, result.kind === "draft" ? { draft: result.draft } : { development: result.development }, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error.name === "TimeoutError") {
      return sendJson(res, 504, { error: "ai_timeout", message: "BitrixGPT не успел подготовить рецепт. Повторите запрос." });
    }
    return handleDatasetDraftError(error, res);
  }
}

async function confirmDatasetDraftRoute(req, res) {
  if (!canEditDashboard(req, res)) return;
  try {
    const body = await readJsonRequest(req, "Передайте черновик в формате JSON.");
    const record = confirmDatasetDraft(body?.draft);
    datasetDrafts.set(record.id, record);
    return sendJson(res, 200, { record }, { "Cache-Control": "no-store" });
  } catch (error) {
    return handleDatasetDraftError(error, res);
  }
}

async function getDatasetPublisherReadiness(req, res) {
  if (!canEditDashboard(req, res)) return;
  const readiness = await getDatasetPublisherReadinessForEnvironment();
  return sendJson(res, 200, { readiness }, { "Cache-Control": "no-store" });
}

async function findManagedDataset(datasetName) {
  const managed = await createAdapterClient().list();
  const target = (managed.result || []).find((item) => item.datasetName === datasetName && item.status === "active");
  if (!target) throw new DatasetPlannerError("unknown_dataset_target", "Выбранный управляемый датасет не найден.");
  return target;
}

async function listManagedDatasets(req, res) {
  if (!canEditDashboard(req, res)) return;
  const adapterClient = createAdapterClient();
  let records = [];
  try {
    records = (await adapterClient.list()).result || [];
  } catch { return sendJson(res, 503, { error: "adapter_unavailable", message: "Не удалось получить список управляемых датасетов." }); }

  // Набор могли удалить вручную в BI-конструкторе — реестр адаптера об этом не знает.
  // Сверяем его с порталом и вычищаем записи, за которыми больше нет датасета.
  let reconciled = { datasets: records.filter((item) => item.status === "active"), missing: [] };
  let portalChecked = false;
  try {
    const { client } = await createPublisherContext(process.env.OAUTH_ADAPTER_STATE_PATH);
    reconciled = reconcileManagedDatasets(records, await listPortalDatasetNames(client));
    portalChecked = true;
  } catch { /* портал недоступен — показываем реестр как есть, чтобы список не опустел */ }

  if (portalChecked) {
    for (const datasetName of reconciled.missing) {
      try { await adapterClient.remove(datasetName); } catch { /* уборка не должна ломать выдачу списка */ }
    }
  }

  const datasets = reconciled.datasets
    .map((item) => ({ datasetName: item.datasetName, title: item.title, updatedAt: item.updatedAt, draft: rebuildManagedDraft(item) }));
  return sendJson(res, 200, { datasets, reconciled: portalChecked, removed: reconciled.missing }, { "Cache-Control": "no-store" });
}

// Черновик управляемого набора восстанавливается из сохранённой спецификации,
// чтобы кнопки управления работали и после перезагрузки страницы.
function rebuildManagedDraft(record) {
  try {
    const draft = buildDatasetDraftFromSpec(record.spec, { request: record.spec?.request || record.title });
    // Имя из спецификации выводится заново и не знает про суффикс версии (_v2),
    // который присваивается при публикации. Берём фактическое имя из реестра,
    // иначе управление и удаление нацелятся на чужой набор.
    return { ...draft, datasetName: record.datasetName };
  } catch {
    return null;
  }
}

async function publishDataset(req, res) {
  if (!canEditDashboard(req, res)) return;
  try {
    const body = await readJsonRequest(req, "Передайте подтверждение публикации в формате JSON.");
    if (body?.confirmed !== true) {
      throw new DatasetPublisherError("publication_confirmation_required", "Подтвердите публикацию выбранного датасета.");
    }
    const statePath = process.env.OAUTH_ADAPTER_STATE_PATH || "/tmp/living-bi-chepyuk-auth.json";
    const readiness = await getDatasetPublisherReadinessForEnvironment();
    if (!readiness.ready) {
      throw new DatasetPublisherError("publisher_not_ready", readiness.message);
    }
    const { client } = await createPublisherContext(statePath);
    await validateDraftCategories(body?.draft);
    const result = await publishDynamicDataset({ draft: body?.draft, client, connectorBaseUrl: process.env.BI_CONNECTOR_BASE_URL, adapterClient: createAdapterClient() });
    return sendJson(res, 200, { result }, { "Cache-Control": "no-store" });
  } catch (error) {
    return handleDatasetDraftError(error, res);
  }
}

async function previewDatasetPublication(req, res) {
  if (!canEditDashboard(req, res)) return;
  try {
    const body = await readJsonRequest(req, "Передайте черновик в формате JSON.");
    const statePath = process.env.OAUTH_ADAPTER_STATE_PATH || "/tmp/living-bi-chepyuk-auth.json";
    const { client } = await createPublisherContext(statePath);
    await validateDraftCategories(body?.draft);
    const preview = await previewDynamicDatasetPublication({ draft: body?.draft, client });
    return sendJson(res, 200, { preview }, { "Cache-Control": "no-store" });
  } catch (error) { return handleDatasetDraftError(error, res); }
}

async function refreshDataset(req, res) {
  if (!canEditDashboard(req, res)) return;
  try {
    const body = await readJsonRequest(req, "Передайте имя датасета в формате JSON.");
    if (typeof body?.datasetName !== "string" || !body.datasetName.startsWith("vibecode_ai_")) throw new DatasetPublisherError("invalid_dataset_name", "Можно обновлять только управляемые датасеты VibeCode AI.");
    const result = await createAdapterClient().refresh(body.datasetName);
    return sendJson(res, 200, { result }, { "Cache-Control": "no-store" });
  } catch (error) { return handleDatasetDraftError(error, res); }
}

async function getDatasetPublisherStatus(req, res) {
  if (!canEditDashboard(req, res)) return;
  const health = await readAdapterHealth(process.env.BI_CONNECTOR_BASE_URL);
  if (!health) return sendJson(res, 503, { error: "adapter_unavailable", message: "Adapter недоступен по публичному HTTPS-адресу." });
  return sendJson(res, 200, { synchronization: health.synchronization || null, oauthStorage: health.oauthStorage || "unknown" }, { "Cache-Control": "no-store" });
}

async function deleteDataset(req, res) {
  if (!canEditDashboard(req, res)) return;
  try {
    const body = await readJsonRequest(req, "Передайте подтверждение удаления в формате JSON.");
    if (body?.confirmed !== true) {
      throw new DatasetPublisherError("deletion_confirmation_required", "Подтвердите удаление выбранного датасета.");
    }
    const statePath = process.env.OAUTH_ADAPTER_STATE_PATH || "/tmp/living-bi-chepyuk-auth.json";
    const readiness = await getDatasetPublisherReadinessForEnvironment();
    if (!readiness.ready) throw new DatasetPublisherError("publisher_not_ready", readiness.message);
    const { client } = await createPublisherContext(statePath);
    const result = await deleteDatasetDraft({ draft: body?.draft, client });
    if (["deleted", "not_found"].includes(result.status)) await createAdapterClient().remove(body.draft.datasetName);
    return sendJson(res, 200, { result }, { "Cache-Control": "no-store" });
  } catch (error) {
    return handleDatasetDraftError(error, res);
  }
}

function createAdapterClient() {
  return new AdapterControlClient({ baseUrl: process.env.BI_CONNECTOR_BASE_URL, controlKey: process.env.ADAPTER_CONTROL_KEY });
}

async function createPublisherContext(statePath) {
  void statePath;
  return { client: createAdapterClient() };
}

async function validateDraftCategories(draft) {
  if (!draft?.spec) throw new DatasetPublisherError("missing_dataset_spec", "У черновика нет проверенной спецификации.");
  const categories = (await createAdapterClient().listCategories()).categories || [];
  try { validateSpecCategoryNames(draft.spec, categories); }
  catch (error) { throw new DatasetPublisherError(error.code || "invalid_category_filter", error.message); }
}

async function getDatasetPublisherReadinessForEnvironment() {
  const statePath = process.env.OAUTH_ADAPTER_STATE_PATH || "/tmp/living-bi-chepyuk-auth.json";
  const adapterReachable = await verifyAdapterHealth(process.env.BI_CONNECTOR_BASE_URL);
  const readiness = getPublisherReadiness({
    connectorBaseUrl: process.env.BI_CONNECTOR_BASE_URL,
    hasOauthState: existsSync(statePath), hasClientId: Boolean(process.env.BITRIX24_OAUTH_CLIENT_ID),
    hasClientSecret: Boolean(process.env.BITRIX24_OAUTH_CLIENT_SECRET), adapterReachable, usesAdapterControl: true
  });
  if (!process.env.ADAPTER_CONTROL_KEY) readiness.missing.push("отдельный ключ ADAPTER_CONTROL_KEY для управления adapter-сервисом");
  readiness.ready = readiness.missing.length === 0;
  if (!readiness.ready) readiness.message = `До публикации настройте: ${readiness.missing.join(", ")}.`;
  return readiness;
}

async function verifyAdapterHealth(baseUrl) {
  return Boolean(await readAdapterHealth(baseUrl));
}

async function readAdapterHealth(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return false;
    url.pathname = "/health";
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false;
    const payload = await response.json();
    return payload?.ok === true ? payload : null;
  } catch {
    return null;
  }
}

async function readJsonRequest(req, message) {
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    throw new DatasetDraftError("unsupported_content_type", message);
  }
  return readJsonBody(req);
}

function handleDatasetDraftError(error, res) {
  if (error instanceof RequestBodyError || error instanceof DatasetDraftError || error instanceof DatasetPlannerError || error instanceof DatasetPublisherError) {
    return sendJson(res, 400, { error: error.code || "invalid_request", message: error.message });
  }
  if (error instanceof BitrixRestError) {
    return sendJson(res, 502, {
      error: error.code || "bitrix_rest_failed",
      message: `Битрикс24 отклонил публикацию: ${error.message}`
    });
  }

  // Неизвестная ошибка раньше выбрасывалась наружу и роняла процесс целиком.
  console.error("Dataset publisher request failed", { code: error?.code || null, message: error instanceof Error ? error.message : String(error) });
  return sendJson(res, 502, {
    error: error?.code || "dataset_operation_failed",
    message: error instanceof Error ? error.message : String(error)
  });
}

async function createAiDevelopmentFallback(command, headers) {
  if (!headers) {
    return createDevelopmentFallback(command);
  }

  try {
    const response = await fetch(`${apiBase}/v1/chat/completions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(createDevelopmentRequestCompletion(command)),
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await readJson(response);

    if (!response.ok) {
      return createDevelopmentFallback(command);
    }

    const call = extractAiToolCalls(payload).find((item) => item.name === "request_development");
    return call ? createDevelopmentRequest(command, call.arguments) : createDevelopmentFallback(command);
  } catch {
    return createDevelopmentFallback(command);
  }
}

function shouldCreateDevelopmentFallback(error) {
  return new Set([
    "ai_tool_required",
    "ai_invalid_tool_call",
    "ai_invalid_tool_arguments",
    "ai_invalid_development_request",
    "ai_unsupported_entity",
    "ai_invalid_preview",
    "ai_preview_required",
    "ai_unknown_dashboard_field",
    "ai_unknown_tool",
    "ai_tool_limit",
    "invalid_patch",
    "invalid_patch_operation",
    "invalid_patch_path",
    "invalid_patch_result",
    "protected_patch_path"
  ]).has(error.code);
}

async function runAiToolLoop({ command, current, headers, req }) {
  const messages = [];
  let previewed = false;

  for (let round = 0; round < 4; round += 1) {
    const response = await fetch(`${apiBase}/v1/chat/completions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(createAiCompletionRequest(command, messages)),
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new AiDashboardError("ai_request_failed", payload.error?.message || "Не удалось подготовить изменение с помощью ИИ.");
    }

    const calls = extractAiToolCalls(payload);
    const assistantMessage = payload.choices[0].message;
    messages.push({ role: "assistant", content: assistantMessage.content || null, tool_calls: assistantMessage.tool_calls });

    const developmentCall = calls.find((call) => call.name === "request_development");
    if (developmentCall) {
      return {
        kind: "development_request",
        developmentRequest: createDevelopmentRequest(command, developmentCall.arguments)
      };
    }

    for (const call of calls) {
      if (call.name === "apply_changes") {
        try {
          const proposal = createProposalFromPatch(current, call.arguments.patch, call.arguments.summary);

          if (needsAggregatePreview(current, proposal.dashboard) && !previewed) {
            throw new AiDashboardError("ai_preview_required", "ИИ должен проверить агрегат перед изменением источника, фильтра, периода или нового виджета.");
          }

          const fieldsValidation = await validateDashboardForPortal(req, proposal.dashboard);

          if (!fieldsValidation.valid) {
            throw new AiDashboardError("ai_unknown_dashboard_field", fieldsValidation.errors.join(" "));
          }

          return { kind: "proposal", proposal };
        } catch (error) {
          if (!(error instanceof AiDashboardError)) {
            throw error;
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: error.code, message: error.message, retry: "Исправь JSON Patch и вызови apply_changes ещё раз." })
          });
        }

        continue;
      }

      const result = await executeAiTool({ call, current, headers, req });
      previewed ||= call.name === "preview_aggregate";
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new AiDashboardError("ai_tool_limit", "ИИ не подготовил изменение за четыре шага.");
}

async function executeAiTool({ call, current, headers, req }) {
  if (call.name === "get_dashboard") {
    return { dashboard: current };
  }

  if (call.name === "list_entities") {
    return { entities: ["deals", "companies", "tasks", "activities", "calls"] };
  }

  if (call.name === "get_entity_fields") {
    if (!isDashboardEntity(call.arguments.entity)) {
      throw new AiDashboardError("ai_unsupported_entity", "ИИ запросил сущность вне дашборда.");
    }

    const response = await fetch(`${apiBase}/v1/${call.arguments.entity}/fields`, { headers });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new AiDashboardError("ai_fields_failed", "Не удалось получить поля сущности для ИИ.");
    }

    return { entity: call.arguments.entity, fields: Object.keys(payload.data?.fields || {}) };
  }

  if (call.name === "preview_aggregate") {
    const widget = call.arguments.widget;
    const previewDashboard = { ...current, widgets: [widget] };
    const validation = validateDashboardSpec(previewDashboard);

    if (!validation.valid) {
      throw new AiDashboardError("ai_invalid_preview", validation.errors.join(" "));
    }

    const fieldsValidation = await validateDashboardForPortal(req, previewDashboard);

    if (!fieldsValidation.valid) {
      throw new AiDashboardError("ai_unknown_dashboard_field", fieldsValidation.errors.join(" "));
    }

    const prepared = await prepareWidgetForAggregate(widget, headers);
    const response = await fetch(`${apiBase}/v1/${widget.entity}/aggregate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(buildAggregateRequest(prepared.widget, previewDashboard.period))
    });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new AiDashboardError("ai_preview_failed", "Не удалось проверить агрегат для будущего виджета.");
    }

    return { preview: normalizeWidgetData(widget, payload), warnings: prepared.warnings };
  }

  throw new AiDashboardError("ai_unknown_tool", "ИИ запросил недоступный инструмент.");
}

async function validateDashboardForPortal(req, dashboard) {
  const headers = resolveVibeHeaders(req);

  if (!headers) {
    return { valid: false, errors: ["Для проверки полей нужна сессия Gateway."] };
  }

  const entities = [...new Set(dashboard.widgets.filter((widget) => widget.computed === undefined).map((widget) => widget.entity))];
  const userId = getRequestUser(req)?.id || "local";
  const responses = await mapWithConcurrency(entities, 4, async (entity) => {
    const cacheKey = `${userId}:${entity}`;
    const cached = fieldCache.get(cacheKey);

    if (cached) {
      return { entity, response: { ok: true }, payload: cached };
    }

    const response = await fetch(`${apiBase}/v1/${entity}/fields`, { headers });
    const payload = await readJson(response);
    if (response.ok) {
      fieldCache.set(cacheKey, payload);
    }
    return { entity, response, payload };
  });
  const fieldsByEntity = new Map();

  for (const { entity, response, payload } of responses) {
    if (!response.ok) {
      return { valid: false, errors: [`Не удалось получить поля сущности «${entity}».`] };
    }

    fieldsByEntity.set(entity, extractFieldNames(payload));
  }

  return validateDashboardFields(dashboard, fieldsByEntity);
}

async function restoreDashboard(req, res) {
  if (!canEditDashboard(req, res)) {
    return;
  }

  if (!req.headers["content-type"]?.startsWith("application/json")) {
    return sendJson(res, 415, { error: "unsupported_content_type", message: "Передайте номер версии в формате JSON." });
  }

  try {
    const body = await readJsonBody(req);

    if (!Number.isInteger(body?.version) || !Number.isInteger(body?.expectedVersion)) {
      return sendJson(res, 400, { error: "invalid_restore", message: "Нужны целочисленные version и expectedVersion." });
    }

    const result = await dashboardStore.restore(body.version, body.expectedVersion);

    if (!result.saved && result.error === "version_conflict") {
      return sendJson(res, 409, result);
    }

    if (!result.saved && result.error === "version_not_found") {
      return sendJson(res, 404, result);
    }

    if (!result.saved) {
      return sendJson(res, result.error === "storage_unavailable" ? 503 : 400, result);
    }

    return sendJson(res, 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return sendJson(res, error.code === "body_too_large" ? 413 : 400, {
        error: error.code,
        message: error.message
      });
    }

    throw error;
  }
}

async function resetDashboard(req, res) {
  if (!canEditDashboard(req, res)) {
    return;
  }

  const result = await dashboardStore.reset();
  aggregateCache.clear();
  return sendJson(res, 200, result, { "Cache-Control": "no-store" });
}

function canEditDashboard(req, res) {
  if (!isProduction) {
    return true;
  }

  const user = getRequestUser(req);
  const access = resolveDashboardEditAccess({ ownerId: dashboardStore.getOwnerId(), user });

  if (access.allowed) {
    if (access.claimOwner) {
      dashboardStore.claimOwner(user.id);
    }
    return true;
  }

  sendJson(res, 403, {
    error: "dashboard_edit_forbidden",
    message: "Редактировать отчёт может только его владелец, открывший приложение через Битрикс24."
  });
  return false;
}

async function getDashboardData(req, res, refresh) {
  const headers = resolveVibeHeaders(req);

  if (!headers) {
    return sendGatewayRequired(res);
  }

  const dashboard = dashboardStore.getCurrent();
  const userId = getRequestUser(req)?.id || "local";
  const cacheKey = `${userId}:${dashboard.version}`;
  const cached = !refresh && aggregateCache.get(cacheKey);

  if (cached) {
    return sendJson(res, 200, { ...cached, cached: true }, { "Cache-Control": "no-store" });
  }

  const sourceWidgets = dashboard.widgets.filter((widget) => widget.computed === undefined);
  const labelMaps = await loadDashboardLabelMaps({ ...dashboard, widgets: sourceWidgets }, headers);
  const dealCategories = await loadDealCategoriesIfNeeded(sourceWidgets, headers);
  const widgetResponses = await mapWithConcurrency(sourceWidgets, 4, async (widget) => {
    const prepared = await prepareWidgetForAggregate(widget, headers, dealCategories);
    const response = await fetch(`${apiBase}/v1/${widget.entity}/aggregate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(buildAggregateRequest(prepared.widget, dashboard.period))
    });
    const payload = await readJson(response);

    return { response, widget, payload, warnings: prepared.warnings };
  });
  const failed = widgetResponses.find(({ response }) => !response.ok);

  if (failed) {
    return sendJson(res, failed.response.status, {
      error: "dashboard_data_failed",
      message: "Не удалось получить агрегаты для дашборда.",
      details: failed.payload.error?.code || "vibe_api_error"
    });
  }

  const normalizedById = new Map(widgetResponses.map(({ widget, payload }) => [widget.id, normalizeWidgetData(widget, payload, labelMaps)]));
  const result = {
    dashboardVersion: dashboard.version,
    warnings: [...new Set(widgetResponses.flatMap(({ warnings }) => warnings))],
    widgets: dashboard.widgets.map((widget) => {
      if (widget.computed !== undefined) {
        return calculateComputedWidget(widget, normalizedById);
      }

      return normalizedById.get(widget.id);
    })
  };
  aggregateCache.set(cacheKey, result);
  return sendJson(res, 200, { ...result, cached: false }, { "Cache-Control": "no-store" });
}

async function previewDashboardWidgets(dashboard, headers) {
  const widgets = dashboard.widgets.filter((widget) => widget.computed === undefined);
  const dealCategories = await loadDealCategoriesIfNeeded(widgets, headers);
  const previews = await mapWithConcurrency(widgets, 4, async (widget) => {
    const prepared = await prepareWidgetForAggregate(widget, headers, dealCategories);
    const response = await fetch(`${apiBase}/v1/${widget.entity}/aggregate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(buildAggregateRequest(prepared.widget, dashboard.period))
    });

    return { response, warnings: prepared.warnings };
  });

  if (previews.some(({ response }) => !response.ok)) {
    throw new AiDashboardError("ai_preview_failed", "Не удалось проверить агрегаты для конверсии.");
  }

  return { warnings: [...new Set(previews.flatMap(({ warnings }) => warnings))] };
}

async function prepareWidgetForAggregate(widget, headers, dealCategories) {
  if (widget.entity !== "deals" || !Array.isArray(widget.categoryExclusions) || widget.categoryExclusions.length === 0) {
    return { widget, warnings: [] };
  }

  const categories = dealCategories || await loadDealCategories(headers);
  return resolveCategoryExclusions(widget, categories);
}

async function loadDealCategoriesIfNeeded(widgets, headers) {
  const needed = widgets.some((widget) => widget.entity === "deals" && Array.isArray(widget.categoryExclusions) && widget.categoryExclusions.length > 0);
  return needed ? loadDealCategories(headers) : undefined;
}

async function loadDealCategories(headers) {
  const response = await fetch(`${apiBase}/v1/deal-categories`, { headers });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new AiDashboardError("ai_preview_failed", "Не удалось получить справочник воронок для фильтра.");
  }

  return Array.isArray(payload.data) ? payload.data : [];
}

async function loadDashboardLabelMaps(dashboard, headers) {
  const dealGroups = new Set(
    dashboard.widgets
      .filter((widget) => widget.entity === "deals" && Array.isArray(widget.groupBy))
      .flatMap((widget) => widget.groupBy)
  );
  const labelMaps = {};
  const requests = [];

  if (dealGroups.has("stageId")) {
    requests.push(fetch(`${apiBase}/v1/statuses?filter%5BentityId%5D=DEAL_STAGE`, { headers })
      .then(readJson)
      .then((payload) => {
        labelMaps.stageId = Object.fromEntries((payload.data || [])
          .filter((status) => typeof status?.statusId === "string" && typeof status?.name === "string")
          .map((status) => [status.statusId, status.name]));
      }));
  }

  if (dealGroups.has("assignedById")) {
    requests.push(fetch(`${apiBase}/v1/users?limit=200`, { headers })
      .then(readJson)
      .then((payload) => {
        labelMaps.assignedById = Object.fromEntries((Array.isArray(payload.data) ? payload.data : [])
          .filter((user) => Number.isInteger(user?.id))
          .map((user) => [String(user.id), safeManagerLabel(user)]));
      }));
  }

  await Promise.allSettled(requests);
  return labelMaps;
}

function safeManagerLabel(user) {
  const name = [user.name, user.lastName].filter((part) => typeof part === "string" && part.trim()).join(" ").trim();
  return name || `Менеджер #${user.id}`;
}

async function serveStatic(pathname, res) {
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return sendJson(res, 404, { error: "not_found" });
  }

  const body = await readFile(filePath);
  const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";

  const cacheControl = extname(filePath) === ".html" || extname(filePath) === ".js" ? "no-store" : "public, max-age=3600";
  res.writeHead(200, { ...securityHeaders, "Content-Type": contentType, "Cache-Control": cacheControl });
  res.end(body);
}

async function readJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; frame-ancestors https://vibecode.bitrix24.tech https://*.bitrix24.ru",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload, null, 2));
}

function loadEnv(path) {
  if (!existsSync(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
