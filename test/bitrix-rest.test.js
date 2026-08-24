import assert from "node:assert/strict";
import test from "node:test";
import { BitrixRestError, createBitrixRestClient } from "../lib/bitrix-rest.js";

test("Bitrix REST client calls only biconnector methods through OAuth", async () => {
  const calls = [];
  const client = createBitrixRestClient({
    portalUrl: "https://example.bitrix24.ru",
    accessToken: "test-access-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ result: [{ id: 7, name: "demo" }] });
    }
  });

  const result = await client.call("biconnector.dataset.list", { select: ["id"] });

  assert.deepEqual(result, [{ id: 7, name: "demo" }]);
  assert.equal(calls[0].url, "https://example.bitrix24.ru/rest/biconnector.dataset.list.json");
  assert.equal(JSON.parse(calls[0].options.body).select[0], "id");
  assert.equal(JSON.parse(calls[0].options.body).auth, "test-access-token");
});

test("Bitrix REST client rejects unrelated methods and malformed OAuth configuration", async () => {
  const client = createBitrixRestClient({
    portalUrl: "https://example.bitrix24.ru",
    accessToken: "test-access-token",
    fetchImpl: async () => jsonResponse({ result: {} })
  });
  await assert.rejects(() => client.call("crm.deal.list"), /только методы модуля biconnector/);
  await assert.doesNotReject(() => client.call("biconnector.dataset.fields.update"));
  await assert.doesNotReject(() => client.call("biconnector.connector.delete"));
  assert.throws(() => createBitrixRestClient({ portalUrl: "http://example.test", accessToken: "token" }), /HTTPS URL/);
  assert.throws(() => createBitrixRestClient({ portalUrl: "https://example.test/rest", accessToken: "token" }), /без пути/);
  assert.throws(() => createBitrixRestClient({ portalUrl: "https://example.test" }), /OAUTH_ACCESS_TOKEN/);
});

test("Bitrix REST client exposes an API error without leaking the webhook", async () => {
  const client = createBitrixRestClient({
    portalUrl: "https://example.bitrix24.ru",
    accessToken: "test-access-token",
    fetchImpl: async () => jsonResponse({ error: "ACCESS_DENIED", error_description: "Access denied" }, 403)
  });

  await assert.rejects(
    () => client.call("biconnector.dataset.list"),
    (error) => error instanceof BitrixRestError && error.code === "ACCESS_DENIED" && error.status === 403
  );
});

test("Bitrix REST client detects an API error nested in result", async () => {
  const client = createBitrixRestClient({
    portalUrl: "https://example.bitrix24.ru",
    accessToken: "test-access-token",
    fetchImpl: async () => jsonResponse({ result: { error: { error: "ACCESS_DENIED", error_description: "Access denied" } } })
  });

  await assert.rejects(
    () => client.call("biconnector.dataset.list"),
    (error) => error instanceof BitrixRestError && error.code === "ACCESS_DENIED" && error.message === "Access denied"
  );
});

test("Bitrix REST client calls biconnector through an incoming webhook without an OAuth token", async () => {
  const calls = [];
  const client = createBitrixRestClient({
    webhookUrl: "https://example.bitrix24.ru/rest/1/secret/",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ result: [{ id: 7, name: "demo" }] });
    }
  });

  await client.call("biconnector.dataset.list", { select: ["id"] });

  assert.equal(calls[0].url, "https://example.bitrix24.ru/rest/1/secret/biconnector.dataset.list.json");
  assert.deepEqual(JSON.parse(calls[0].options.body), { select: ["id"] });
});

test("Bitrix REST client validates webhook configuration and keeps its method boundary", async () => {
  assert.throws(
    () => createBitrixRestClient({ webhookUrl: "http://example.test/rest/1/secret/" }),
    /HTTPS URL/
  );
  assert.throws(
    () => createBitrixRestClient({ webhookUrl: "https://example.test/not-rest/" }),
    /входящего вебхука/
  );

  const client = createBitrixRestClient({
    webhookUrl: "https://example.bitrix24.ru/rest/1/secret/",
    fetchImpl: async () => jsonResponse({ result: {} })
  });
  await assert.rejects(() => client.call("crm.deal.list"), /только методы модуля biconnector/);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}
