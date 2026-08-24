import assert from "node:assert/strict";
import test from "node:test";
import { buildDatasetDraftFromSpec } from "../lib/dataset-spec.js";
import { buildDatasetSchemaDiff, previewDynamicDatasetPublication, publishDynamicDataset } from "../lib/dataset-publisher.js";

function matchingBitrixFields(source) {
  const types = { integer: "int", string: "string", float: "double", date: "date", datetime: "datetime" };
  return source.fields.map((field) => ({ name: field.code, type: types[field.type] }));
}

const draft = buildDatasetDraftFromSpec({ title: "Конверсия", dimensions: ["week", "manager"], metrics: ["total_deals", "conversion_percent"], period: "current_quarter", filters: { excludeCategoryNames: ["Тест"] } }, { request: "Конверсия" });

test("classifies additive schema changes as compatible", () => {
  const diff = buildDatasetSchemaDiff([{ name: "WEEK_START", type: "date" }], draft.fields);
  assert.equal(diff.compatible, true);
  assert.ok(diff.add.some((item) => item.name === "CONVERSION_PERCENT"));
});

test("classifies removed or retyped fields as versioned changes", () => {
  const diff = buildDatasetSchemaDiff([{ name: "WEEK_START", type: "string" }, { name: "OLD", type: "int" }], draft.fields);
  assert.equal(diff.compatible, false);
  assert.equal(diff.incompatible[0].name, "WEEK_START");
});

test("previews creation without mutating Bitrix24", async () => {
  const client = { call: async (method) => { assert.equal(method, "biconnector.dataset.list"); return []; } };
  assert.equal((await previewDynamicDatasetPublication({ draft, client })).action, "create");
});

test("reads an existing schema from the real dataset.get item envelope", async () => {
  const client = { call: async (method) => method.endsWith("dataset.list")
    ? [{ id: 14, name: draft.datasetName }]
    : { item: { fields: draft.fields.map((field) => ({ name: field.code, type: field.type === "integer" ? "int" : field.type === "float" ? "double" : field.type })) } } };
  const preview = await previewDynamicDatasetPublication({ draft, client });
  assert.equal(preview.action, "reuse");
});

test("stages, publishes and activates a new dynamic dataset", async () => {
  const calls = []; const adapterCalls = [];
  const client = { call: async (method) => {
    calls.push(method);
    if (method.endsWith("dataset.list") || method.endsWith("connector.list") || method.endsWith("source.list")) return [];
    if (method.endsWith("connector.add")) return { id: 1 };
    if (method.endsWith("source.add")) return { id: 2 };
    if (method.endsWith("dataset.add")) return { result: { id: 3 } };
    throw new Error(method);
  } };
  const adapterClient = { stage: async (...args) => adapterCalls.push(["stage", ...args]), activate: async (...args) => adapterCalls.push(["activate", ...args]), fail: async () => {} };
  const result = await publishDynamicDataset({ draft, client, connectorBaseUrl: "https://adapter.example.com", adapterClient });
  assert.equal(result.datasetId, 3);
  assert.deepEqual(adapterCalls.map((item) => item[0]), ["stage", "activate"]);
  assert.equal(calls.at(-1), "biconnector.dataset.add");
});

test("adds compatible fields using the documented Bitrix24 REST payload", async () => {
  const existingFields = draft.fields.filter((field) => field.code !== "CONVERSION_PERCENT");
  const calls = [];
  const client = { call: async (method, params) => {
    calls.push([method, params]);
    if (method === "biconnector.dataset.list") return [{ id: 14, name: draft.datasetName }];
    if (method === "biconnector.dataset.get") {
      return { item: { fields: existingFields.map((field) => ({ name: field.code, type: field.type === "integer" ? "int" : field.type })) } };
    }
    if (method === "biconnector.dataset.fields.update" || method === "biconnector.dataset.update") return true;
    throw new Error(method);
  } };
  const adapterClient = { stage: async () => {}, activate: async () => {}, fail: async () => {} };

  const result = await publishDynamicDataset({ draft, client, connectorBaseUrl: "https://adapter.example.com", adapterClient });

  assert.equal(result.status, "updated");
  const [, params] = calls.find(([method]) => method === "biconnector.dataset.fields.update");
  assert.deepEqual(params, {
    id: 14,
    add: [{ type: "double", name: "CONVERSION_PERCENT", externalCode: "CONVERSION_PERCENT" }]
  });
  assert.equal("fields" in params, false);
});

test("повтор публикации без изменений не делает ни одного REST-вызова", async () => {
  const calls = [];
  const adapterCalls = [];
  const client = {
    call: async (method, params) => {
      calls.push(method);
      if (method === "biconnector.dataset.list") {
        return [{ id: 16, name: draft.datasetName }];
      }
      if (method === "biconnector.dataset.get") {
        return { item: { id: 16, fields: matchingBitrixFields(draft) } };
      }
      throw new Error(`неожиданный вызов ${method} ${JSON.stringify(params)}`);
    }
  };
  const adapterClient = {
    list: async () => ({ result: [{ datasetName: draft.datasetName, status: "active", spec: draft.spec }] }),
    stage: async (name) => { adapterCalls.push(`stage:${name}`); },
    activate: async (name) => { adapterCalls.push(`activate:${name}`); },
    fail: async (name) => { adapterCalls.push(`fail:${name}`); },
    remove: async (name) => { adapterCalls.push(`remove:${name}`); }
  };

  const result = await publishDynamicDataset({ draft: draft, client, connectorBaseUrl: "https://adapter.example.com", adapterClient });

  assert.equal(result.status, "unchanged");
  assert.ok(!calls.includes("biconnector.dataset.update"), "dataset.update не должен вызываться");
  assert.ok(!calls.includes("biconnector.dataset.fields.update"), "fields.update не должен вызываться");
  assert.ok(!adapterCalls.some((c) => c.startsWith("fail:")), "запись не должна попадать в failed");
  assert.ok(adapterCalls.includes(`activate:${draft.datasetName}`));
});

test("неудачное обновление возвращает предыдущую активную версию, а не ломает её", async () => {
  const previousSpec = { ...draft.spec, title: "Предыдущая версия" };
  const staged = [];
  const adapterCalls = [];
  const client = {
    call: async (method) => {
      if (method === "biconnector.dataset.list") return [{ id: 16, name: draft.datasetName }];
      if (method === "biconnector.dataset.get") return { item: { id: 16, fields: [{ name: "MANAGER_ID", type: "int" }] } };
      const error = new Error("Поле нельзя изменить");
      error.code = "VALIDATION_IMMUTABLE_FIELD";
      throw error;
    }
  };
  const adapterClient = {
    list: async () => ({ result: [{ datasetName: draft.datasetName, status: "active", spec: previousSpec }] }),
    stage: async (name, spec) => { staged.push(spec); adapterCalls.push(`stage:${name}`); },
    activate: async (name) => { adapterCalls.push(`activate:${name}`); },
    fail: async (name) => { adapterCalls.push(`fail:${name}`); },
    remove: async (name) => { adapterCalls.push(`remove:${name}`); }
  };

  await assert.rejects(
    () => publishDynamicDataset({ draft: draft, client, connectorBaseUrl: "https://adapter.example.com", adapterClient }),
    /Поле нельзя изменить/
  );

  assert.ok(!adapterCalls.some((c) => c.startsWith("fail:")), "работавшая запись не должна уходить в failed");
  assert.ok(adapterCalls.includes(`activate:${draft.datasetName}`), "предыдущая версия должна быть возвращена в active");
  assert.deepEqual(staged.at(-1), previousSpec, "должна восстанавливаться прежняя спецификация");
});

test("неудачная первая публикация убирает запись, которой раньше не было", async () => {
  const adapterCalls = [];
  const client = {
    call: async (method) => {
      if (method === "biconnector.dataset.list") return [];
      const error = new Error("REST отказал");
      error.code = "BITRIX_FAILED";
      throw error;
    }
  };
  const adapterClient = {
    list: async () => ({ result: [] }),
    stage: async (name) => { adapterCalls.push(`stage:${name}`); },
    activate: async (name) => { adapterCalls.push(`activate:${name}`); },
    fail: async (name) => { adapterCalls.push(`fail:${name}`); },
    remove: async (name) => { adapterCalls.push(`remove:${name}`); }
  };

  await assert.rejects(() => publishDynamicDataset({ draft: draft, client, connectorBaseUrl: "https://adapter.example.com", adapterClient }), /REST отказал/);
  assert.ok(adapterCalls.includes(`remove:${draft.datasetName}`), "черновая запись должна быть удалена");
  assert.ok(!adapterCalls.some((c) => c.startsWith("fail:")));
});
