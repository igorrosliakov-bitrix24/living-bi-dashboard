import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { dirname } from "node:path";

const defaultOauthUrl = "https://oauth.bitrix24.tech/oauth/token/";

export async function readOauthState(statePath, { encryptionKey } = {}) {
  const raw = await readFile(statePath, "utf8");
  const state = decodeState(raw, encryptionKey);
  validateState(state);
  return state;
}

export async function getValidOauthState({
  statePath,
  clientId,
  clientSecret,
  fetchImpl = fetch,
  forceRefresh = false,
  now = Date.now(),
  encryptionKey
}) {
  const state = await readOauthState(statePath, { encryptionKey });
  if (!forceRefresh && Number(state.expiresAt) > now + 5 * 60 * 1_000) {
    return state;
  }
  return refreshOauthState({ statePath, state, clientId, clientSecret, fetchImpl, now, encryptionKey });
}

export async function refreshOauthState({
  statePath,
  state,
  clientId,
  clientSecret,
  fetchImpl = fetch,
  now = Date.now(),
  encryptionKey
}) {
  if (!clientId || !clientSecret) {
    throw new Error("Для обновления OAuth добавьте BITRIX24_OAUTH_CLIENT_ID и BITRIX24_OAUTH_CLIENT_SECRET.");
  }

  const url = new URL(defaultOauthUrl);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("refresh_token", state.refreshToken);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const payload = await readJson(response);
  if (!response.ok || payload.error || !payload.access_token || !payload.refresh_token) {
    throw new Error(payload.error_description || payload.error || `OAuth вернул HTTP ${response.status}.`);
  }

  const next = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    clientEndpoint: payload.client_endpoint || state.clientEndpoint,
    domain: state.domain,
    expiresAt: now + Number(payload.expires_in || 3600) * 1_000
  };
  await writeOauthState(statePath, next, { encryptionKey });
  return next;
}

export async function writeOauthState(statePath, state, { encryptionKey } = {}) {
  validateState(state);
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, encodeState(state, encryptionKey), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, statePath);
}

function encodeState(state, encryptionKey) {
  if (!encryptionKey) return JSON.stringify(state);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(encryptionKey, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    encrypted: true,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  });
}

function decodeState(raw, encryptionKey) {
  const payload = JSON.parse(raw);
  if (!payload?.encrypted) return payload;
  if (!encryptionKey) throw new Error("OAuth state зашифрован. Добавьте OAUTH_STATE_ENCRYPTION_KEY в окружение adapter-а.");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(encryptionKey, Buffer.from(payload.salt, "base64")),
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8"));
  } catch {
    throw new Error("Не удалось расшифровать OAuth state. Проверьте OAUTH_STATE_ENCRYPTION_KEY.");
  }
}

function deriveKey(secret, salt) {
  return scryptSync(secret, salt, 32);
}

function validateState(state) {
  if (!state || typeof state !== "object"
    || !state.accessToken
    || !state.refreshToken
    || !state.clientEndpoint
    || !state.domain) {
    throw new Error("OAuth state неполон. Переустановите локальное приложение.");
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
