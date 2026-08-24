import assert from "node:assert/strict";
import test from "node:test";
import { buildDatasetDraft } from "../lib/dataset-draft.js";
import { deleteDatasetDraft, getPublisherReadiness, publishDatasetDraft } from "../lib/dataset-publisher.js";

test("reports missing publication prerequisites without contacting Bitrix24", () => {
  const readiness = getPublisherReadiness({ connectorBaseUrl: "", hasOauthState: false, hasClientId: false, hasClientSecret: false });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing.length, 3);
});

test("blocks publication when the public address is a Gateway page instead of an adapter", () => {
  const readiness = getPublisherReadiness({
    connectorBaseUrl: "https://adapter.example.com",
    hasOauthState: true,
    hasClientId: true,
    hasClientSecret: true,
    adapterReachable: false
  });
  assert.equal(readiness.ready, false);
  assert.match(readiness.message, /JSON без Gateway/);
});

test("publishes a new dataset through the restricted BI client", async () => {
  const calls = [];
  const client = { call: async (method, params) => {
    calls.push({ method, params });
    if (method.endsWith("dataset.list")) return [];
    if (method.endsWith("connector.list")) return [];
    if (method.endsWith("connector.add")) return { id: 11 };
    if (method.endsWith("source.list")) return [];
    if (method.endsWith("source.add")) return { id: 12 };
    if (method.endsWith("dataset.add")) return { id: 13 };
    throw new Error(`Unexpected ${method}`);
  } };

  const result = await publishDatasetDraft({
    draft: buildDatasetDraft({ request: "Новые сделки" }),
    client,
    connectorBaseUrl: "https://adapter.example.com"
  });
  assert.deepEqual(result, { status: "published", datasetId: 13, datasetName: "vibecode_ai_deal_intake_weekly" });
  assert.deepEqual(calls.map((call) => call.method), [
    "biconnector.dataset.list", "biconnector.connector.list", "biconnector.connector.add",
    "biconnector.source.list", "biconnector.source.add", "biconnector.dataset.add"
  ]);
  assert.equal(calls.at(-1).params.fields.fields[0].type, "date");
  assert.equal(calls.at(-1).params.fields.fields[1].type, "int");
});

test("does not create objects when the dataset already exists", async () => {
  const client = { call: async (method) => {
    assert.equal(method, "biconnector.dataset.list");
    return [{ id: 77, name: "vibecode_ai_deal_intake_weekly" }];
  } };
  const result = await publishDatasetDraft({
    draft: buildDatasetDraft({ request: "Новые сделки" }),
    client,
    connectorBaseUrl: "https://adapter.example.com"
  });
  assert.deepEqual(result, { status: "already_published", datasetId: 77, datasetName: "vibecode_ai_deal_intake_weekly" });
});

test("deletes only the matching vibecode_ai dataset", async () => {
  const calls = [];
  const client = { call: async (method, params) => {
    calls.push({ method, params });
    if (method === "biconnector.dataset.list") return [{ id: 77, name: "vibecode_ai_deal_intake_weekly" }];
    if (method === "biconnector.dataset.delete") return true;
    throw new Error(`Unexpected ${method}`);
  } };
  const result = await deleteDatasetDraft({ draft: buildDatasetDraft({ request: "Новые сделки" }), client });
  assert.deepEqual(result, { status: "deleted", datasetId: 77, datasetName: "vibecode_ai_deal_intake_weekly" });
  assert.deepEqual(calls.map((call) => call.method), ["biconnector.dataset.list", "biconnector.dataset.delete"]);
  assert.equal(calls[1].params.id, 77);
});
