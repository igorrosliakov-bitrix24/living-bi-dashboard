import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

loadEnv(join(__dirname, ".env"));

const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || "127.0.0.1";
const apiBase = process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech";
const apiKey = process.env.VIBECODE_API_KEY || "";

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
        apiBase
      });
    }

    if (url.pathname === "/api/me") {
      return handleVibecodeMe(res);
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

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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
