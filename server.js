import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DashboardStore } from "./lib/dashboard-store.js";
import { buildAggregateRequest, normalizeWidgetData } from "./lib/dashboard-data.js";
import { isDashboardEntity, listDashboardEntities } from "./lib/entities.js";
import { buildVibeHeaders, getGatewayAuthorization, getGatewayUser } from "./lib/gateway.js";
import { RequestBodyError, readJsonBody } from "./lib/request-body.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

loadEnv(join(__dirname, ".env"));

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || (isProduction ? 3000 : 5174));
const host = process.env.HOST || (isProduction ? "0.0.0.0" : "127.0.0.1");
const apiBase = process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech";
const apiKey = process.env.VIBECODE_API_KEY || "";
const appKey = process.env.VIBE_APP_KEY || process.env.VIBECODE_APP_KEY || "";
const dashboardStore = new DashboardStore();

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
      return handleVibecodeMe(req, res);
    }

    if (url.pathname === "/api/session" && req.method === "GET") {
      return getSession(req, res);
    }

    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      return sendJson(res, 200, { dashboard: dashboardStore.getCurrent() }, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/dashboard" && req.method === "POST") {
      return saveDashboard(req, res);
    }

    if (url.pathname === "/api/dashboard/data" && req.method === "GET") {
      return getDashboardData(req, res);
    }

    if (url.pathname === "/api/entities" && req.method === "GET") {
      return listEntities(res);
    }

    const fieldsMatch = url.pathname.match(/^\/api\/entities\/([a-z-]+)\/fields$/);

    if (fieldsMatch && req.method === "GET") {
      return getEntityFields(req, res, fieldsMatch[1]);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    return sendJson(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
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
  const gatewayAuthorization = getGatewayAuthorization(req.headers);
  const user = getGatewayUser(req.headers);

  if (gatewayAuthorization) {
    return sendJson(res, 200, {
      authenticated: true,
      mode: "gateway",
      user
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

function resolveVibeHeaders(req) {
  const gatewayAuthorization = getGatewayAuthorization(req.headers);

  if (gatewayAuthorization) {
    return buildVibeHeaders({ appKey, apiKey: "", gatewayAuthorization });
  }

  if (!isProduction) {
    return buildVibeHeaders({ appKey: "", apiKey, gatewayAuthorization: null });
  }

  return null;
}

function sendGatewayRequired(res) {
  return sendJson(res, 401, {
    error: "gateway_session_required",
    message: "Откройте приложение через размещение в Битрикс24, чтобы Gateway передал сессию пользователя.",
    reopen: true
  });
}

async function saveDashboard(req, res) {
  if (isProduction && (!getGatewayAuthorization(req.headers) || getGatewayUser(req.headers)?.role !== "ADMIN")) {
    return sendJson(res, 403, {
      error: "dashboard_edit_forbidden",
      message: "Редактировать отчёт может администратор, открывший приложение через Битрикс24."
    });
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

    const result = dashboardStore.save(body.dashboard, body.expectedVersion);

    if (!result.saved && result.error === "version_conflict") {
      return sendJson(res, 409, result);
    }

    if (!result.saved) {
      return sendJson(res, 400, result);
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

async function getDashboardData(req, res) {
  const headers = resolveVibeHeaders(req);

  if (!headers) {
    return sendGatewayRequired(res);
  }

  const dashboard = dashboardStore.getCurrent();
  const widgetResponses = await Promise.all(dashboard.widgets.map(async (widget) => {
    const response = await fetch(`${apiBase}/v1/${widget.entity}/aggregate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(buildAggregateRequest(widget))
    });
    const payload = await readJson(response);

    return { response, widget, payload };
  }));
  const failed = widgetResponses.find(({ response }) => !response.ok);

  if (failed) {
    return sendJson(res, failed.response.status, {
      error: "dashboard_data_failed",
      message: "Не удалось получить агрегаты для дашборда.",
      details: failed.payload.error?.code || "vibe_api_error"
    });
  }

  return sendJson(res, 200, {
    dashboardVersion: dashboard.version,
    widgets: widgetResponses.map(({ widget, payload }) => normalizeWidgetData(widget, payload))
  }, { "Cache-Control": "no-store" });
}

async function serveStatic(pathname, res) {
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return sendJson(res, 404, { error: "not_found" });
  }

  const body = await readFile(filePath);
  const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";

  res.writeHead(200, { ...securityHeaders, "Content-Type": contentType });
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
