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
import { AiDashboardError, buildDashboardDiff, createAiCompletionRequest, createDevelopmentRequest, createProposalFromPatch, extractAiToolCalls, needsAggregatePreview } from "./lib/ai-dashboard.js";
import { validateDashboardSpec } from "./lib/dashboard-spec.js";

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

    if (url.pathname === "/api/dashboard/versions" && req.method === "GET") {
      return sendJson(res, 200, { versions: dashboardStore.listVersions() }, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/dashboard/restore" && req.method === "POST") {
      return restoreDashboard(req, res);
    }

    if (url.pathname === "/api/dashboard/reset" && req.method === "POST") {
      return resetDashboard(req, res);
    }

    if (url.pathname === "/api/dashboard/ai-draft" && req.method === "POST") {
      return createAiDraft(req, res);
    }

    if (url.pathname === "/api/dashboard/data" && req.method === "GET") {
      return getDashboardData(req, res, url.searchParams.has("refresh"));
    }

    if (url.pathname === "/api/entities" && req.method === "GET") {
      return listEntities(res);
    }

    if (url.pathname === "/api/demo-data" && req.method === "GET") {
      return getDemoData(req, res);
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

  try {
    const body = await readJsonBody(req);
    const current = dashboardStore.getCurrent();

    if (!Number.isInteger(body?.expectedVersion) || body.expectedVersion !== current.version) {
      return sendJson(res, 409, { error: "version_conflict", currentVersion: current.version });
    }

    const headers = resolveVibeHeaders(req);

    if (!headers) {
      return sendGatewayRequired(res);
    }

    const result = await runAiToolLoop({ command: body.command, current, headers, req });

    if (result.kind === "development_request") {
      return sendJson(res, 200, { developmentRequest: result.developmentRequest }, { "Cache-Control": "no-store" });
    }

    return sendJson(res, 200, { proposal: { ...result.proposal, changes: buildDashboardDiff(current, result.proposal.dashboard) } }, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof RequestBodyError || error instanceof AiDashboardError) {
      return sendJson(res, 400, { error: error.code, message: error.message });
    }

    if (error.name === "TimeoutError") {
      return sendJson(res, 504, { error: "ai_timeout", message: "ИИ не успел подготовить черновик. Повторите запрос." });
    }

    throw error;
  }
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
        const proposal = createProposalFromPatch(current, call.arguments.patch, call.arguments.summary);

        if (needsAggregatePreview(current, proposal.dashboard) && !previewed) {
          throw new AiDashboardError("ai_preview_required", "ИИ должен проверить агрегат перед изменением источника, фильтра, периода или нового виджета.");
        }

        const fieldsValidation = await validateDashboardForPortal(req, proposal.dashboard);

        if (!fieldsValidation.valid) {
          throw new AiDashboardError("ai_unknown_dashboard_field", fieldsValidation.errors.join(" "));
        }

        return { kind: "proposal", proposal };
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

    const response = await fetch(`${apiBase}/v1/${widget.entity}/aggregate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(buildAggregateRequest(widget, previewDashboard.period))
    });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new AiDashboardError("ai_preview_failed", "Не удалось проверить агрегат для будущего виджета.");
    }

    return { preview: normalizeWidgetData(widget, payload) };
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
  const widgetResponses = await mapWithConcurrency(sourceWidgets, 4, async (widget) => {
    const response = await fetch(`${apiBase}/v1/${widget.entity}/aggregate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(buildAggregateRequest(widget, dashboard.period))
    });
    const payload = await readJson(response);

    return { response, widget, payload };
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
