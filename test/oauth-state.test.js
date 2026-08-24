import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getValidOauthState, writeOauthState } from "../lib/oauth-state.js";

test("OAuth state remains unchanged while its access token is valid", async () => {
  const statePath = await createState({ expiresAt: 1_000_000 });
  const state = await getValidOauthState({ statePath, now: 1_000 });
  assert.equal(state.accessToken, "access-old");
});

test("OAuth state refreshes and atomically saves the new token pair", async () => {
  const statePath = await createState({ expiresAt: 1_000 });
  const state = await getValidOauthState({
    statePath,
    clientId: "client-id",
    clientSecret: "client-secret",
    now: 2_000,
    fetchImpl: async (url) => {
      assert.equal(new URL(url).searchParams.get("refresh_token"), "refresh-old");
      return response({
        access_token: "access-new",
        refresh_token: "refresh-new",
        client_endpoint: "https://portal.bitrix24.ru/rest/",
        expires_in: 3600
      });
    }
  });

  assert.equal(state.accessToken, "access-new");
  assert.equal(state.expiresAt, 3_602_000);
  const saved = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(saved.refreshToken, "refresh-new");
});

test("OAuth refresh requires local application credentials", async () => {
  const statePath = await createState({ expiresAt: 1_000 });
  await assert.rejects(
    () => getValidOauthState({ statePath, now: 2_000 }),
    /BITRIX24_OAUTH_CLIENT_ID/
  );
});

test("OAuth state is encrypted on disk when a production key is supplied", async () => {
  const directory = await mkdtemp(join(tmpdir(), "living-bi-oauth-encrypted-"));
  const statePath = join(directory, "auth.json");
  const encryptionKey = "test-only-long-encryption-key";
  await writeOauthState(statePath, {
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    clientEndpoint: "https://portal.bitrix24.ru/rest/",
    domain: "portal.bitrix24.ru",
    expiresAt: 1_000_000
  }, { encryptionKey });

  const raw = await readFile(statePath, "utf8");
  assert.doesNotMatch(raw, /access-secret|refresh-secret/);
  const state = await getValidOauthState({ statePath, encryptionKey, now: 1_000 });
  assert.equal(state.accessToken, "access-secret");
  await assert.rejects(() => getValidOauthState({ statePath, encryptionKey: "wrong", now: 1_000 }), /расшифровать/);
});

async function createState(overrides) {
  const directory = await mkdtemp(join(tmpdir(), "living-bi-oauth-"));
  const statePath = join(directory, "auth.json");
  await writeOauthState(statePath, {
    accessToken: "access-old",
    refreshToken: "refresh-old",
    clientEndpoint: "https://portal.bitrix24.ru/rest/",
    domain: "portal.bitrix24.ru",
    ...overrides
  });
  return statePath;
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}
