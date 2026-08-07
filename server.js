import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAuthorizationUrl,
  createOpaqueToken,
  parseCookies,
  serializeCookie,
  toSafeUser
} from "./lib/oauth.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

loadEnv(join(__dirname, ".env"));

const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || "127.0.0.1";
const apiBase = process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech";
const apiKey = process.env.VIBECODE_API_KEY || "";
const appKey = process.env.VIBECODE_APP_KEY || "";
const isProduction = process.env.NODE_ENV === "production";
const oauthAttempts = new Map();
const userSessions = new Map();

const oauthStateCookie = "oauth_state";
const dashboardSessionCookie = "dashboard_session";
const oauthStateTtlMs = 20 * 60 * 1000;
const sessionTtlMs = 24 * 60 * 60 * 1000;

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
        apiBase
      });
    }

    if (url.pathname === "/api/me") {
      return handleVibecodeMe(res);
    }

    if (url.pathname === "/api/auth/start" && req.method === "GET") {
      return startOAuth(res);
    }

    if (url.pathname === "/api/auth/status" && req.method === "GET") {
      return pollOAuth(req, res);
    }

    if (url.pathname === "/api/session" && req.method === "GET") {
      return getSession(req, res);
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

async function handleVibecodeMe(res) {
  if (!apiKey) {
    return sendJson(res, 400, {
      error: "missing_api_key",
      message: "Add VIBECODE_API_KEY to .env"
    });
  }

  const response = await fetch(`${apiBase}/v1/me`, {
    headers: {
      "X-Api-Key": apiKey,
      "Accept": "application/json"
    }
  });

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  return sendJson(res, response.status, payload);
}

function startOAuth(res) {
  if (!appKey) {
    return sendJson(res, 400, {
      error: "missing_app_key",
      message: "Add VIBECODE_APP_KEY to .env"
    });
  }

  removeExpiredSessions();
  const state = createOpaqueToken();
  oauthAttempts.set(state, { expiresAt: Date.now() + oauthStateTtlMs });

  return sendJson(
    res,
    200,
    { authorizationUrl: buildAuthorizationUrl({ apiBase, appKey, state }) },
    {
      "Cache-Control": "no-store",
      "Set-Cookie": serializeCookie(oauthStateCookie, state, {
        maxAge: Math.floor(oauthStateTtlMs / 1000),
        secure: isProduction
      })
    }
  );
}

async function pollOAuth(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const state = cookies[oauthStateCookie];
  const attempt = state ? oauthAttempts.get(state) : undefined;

  if (!state || !attempt) {
    return sendJson(res, 401, {
      authenticated: false,
      error: "oauth_state_missing",
      message: "Начните вход через Битрикс24 заново."
    });
  }

  if (attempt.expiresAt <= Date.now()) {
    oauthAttempts.delete(state);
    return sendJson(res, 401, {
      authenticated: false,
      error: "oauth_state_expired",
      message: "Время входа истекло. Начните его заново."
    });
  }

  const url = new URL("/v1/oauth/poll", apiBase);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("state", state);

  const response = await fetch(url, {
    headers: {
      "X-Api-Key": appKey,
      "Accept": "application/json"
    }
  });
  const payload = await readJson(response);

  if (!response.ok) {
    return sendJson(res, response.status, {
      authenticated: false,
      error: payload.error?.code || payload.error || "oauth_poll_failed",
      message: payload.error?.message || payload.message || "Не удалось проверить авторизацию."
    });
  }

  if (payload.status === "pending") {
    return sendJson(res, 200, { authenticated: false, status: "pending" }, { "Cache-Control": "no-store" });
  }

  const user = toSafeUser(payload.user);

  if (payload.status !== "complete" || !payload.access_token || !user) {
    return sendJson(res, 502, {
      authenticated: false,
      error: "invalid_oauth_response",
      message: "Платформа вернула неполный ответ авторизации."
    });
  }

  const sessionId = createOpaqueToken();
  userSessions.set(sessionId, {
    accessToken: payload.access_token,
    expiresAt: Date.now() + sessionTtlMs,
    user
  });
  oauthAttempts.delete(state);

  return sendJson(
    res,
    200,
    { authenticated: true, user },
    {
      "Cache-Control": "no-store",
      "Set-Cookie": [
        serializeCookie(oauthStateCookie, "cleared", { maxAge: 0, secure: isProduction }),
        serializeCookie(dashboardSessionCookie, sessionId, {
          maxAge: Math.floor(sessionTtlMs / 1000),
          secure: isProduction
        })
      ]
    }
  );
}

function getSession(req, res) {
  removeExpiredSessions();
  const cookies = parseCookies(req.headers.cookie);
  const session = cookies[dashboardSessionCookie] ? userSessions.get(cookies[dashboardSessionCookie]) : undefined;

  return sendJson(res, 200, {
    authenticated: Boolean(session),
    user: session?.user || null
  });
}

function removeExpiredSessions() {
  const now = Date.now();

  for (const [state, attempt] of oauthAttempts) {
    if (attempt.expiresAt <= now) {
      oauthAttempts.delete(state);
    }
  }

  for (const [sessionId, session] of userSessions) {
    if (session.expiresAt <= now) {
      userSessions.delete(sessionId);
    }
  }
}

async function serveStatic(pathname, res) {
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return sendJson(res, 404, { error: "not_found" });
  }

  const body = await readFile(filePath);
  const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
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

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
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
