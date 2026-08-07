import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { isDashboardEntity, listDashboardEntities } from "./lib/entities.js";
import { buildVibeHeaders, getGatewayAuthorization, getGatewayUser } from "./lib/gateway.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

loadEnv(join(__dirname, ".env"));

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || (isProduction ? 3000 : 5174));
const host = process.env.HOST || (isProduction ? "0.0.0.0" : "127.0.0.1");
const apiBase = process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech";
const apiKey = process.env.VIBECODE_API_KEY || "";
const appKey = process.env.VIBE_APP_KEY || process.env.VIBECODE_APP_KEY || "";

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
