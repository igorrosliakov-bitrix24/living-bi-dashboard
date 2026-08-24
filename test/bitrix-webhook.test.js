import assert from "node:assert/strict";
import test from "node:test";
import { createBitrixWebhookClient } from "../lib/bitrix-rest.js";

test("webhook client permits only explicitly listed read-only methods", async () => {
  const calls = [];
  const client = createBitrixWebhookClient({
    webhookUrl: "https://example.bitrix24.ru/rest/1/secret/",
    allowedMethods: ["crm.deal.list", "biconnector.dataset.list"],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ result: { total: 12 } });
    }
  });

  const result = await client.call("crm.deal.list", { select: ["ID"] });

  assert.equal(result.total, 12);
  assert.equal(calls[0].url, "https://example.bitrix24.ru/rest/1/secret/crm.deal.list.json");
  assert.deepEqual(JSON.parse(calls[0].options.body), { select: ["ID"] });
  await assert.rejects(() => client.call("crm.deal.add"), /не разрешён/);
});

test("webhook client returns a paginated total without exposing source rows", async () => {
  const client = createBitrixWebhookClient({
    webhookUrl: "https://example.bitrix24.ru/rest/1/secret/",
    allowedMethods: ["crm.deal.list"],
    fetchImpl: async () => response({ result: [{ ID: "1" }], total: 42 })
  });

  const payload = await client.callWithMeta("crm.deal.list", { select: ["ID"] });

  assert.deepEqual(payload, { result: [{ ID: "1" }], total: 42 });
});

function response(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  };
}
