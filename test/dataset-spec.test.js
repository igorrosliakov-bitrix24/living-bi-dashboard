import assert from "node:assert/strict";
import test from "node:test";
import { buildDatasetDraftFromSpec, DatasetSpecError } from "../lib/dataset-spec.js";

test("uses current quarter by default and rejects another entity", () => {
  const draft = buildDatasetDraftFromSpec({ dimensions: ["manager"], metrics: ["total_deals"], filters: {} }, { request: "Все сделки по менеджерам" });
  assert.equal(draft.period, "current_quarter");
  assert.throws(() => buildDatasetDraftFromSpec({ entity: "crm.lead", dimensions: ["manager"], metrics: ["total_deals"], filters: {} }, { request: "Лиды" }), (error) => error instanceof DatasetSpecError && error.code === "unsupported_entity");
});

test("builds different safe schemas from combinations", () => {
  const draft = buildDatasetDraftFromSpec({ title: "Победы по воронкам", dimensions: ["category"], metrics: ["won_deals"], period: "current_year", filters: {} }, { request: "Победы по воронкам" });
  assert.deepEqual(draft.fields.map((field) => field.code), ["CATEGORY_ID", "CATEGORY_NAME", "WON_DEALS"]);
});

test("черновик управляемого набора восстанавливается из сохранённой спецификации", () => {
  const spec = {
    entity: "crm.deal",
    title: "Сделки и выигрыши по менеджерам",
    request: "всего сделок и выигранные сделки по менеджерам за текущий месяц",
    period: "current_month",
    dimensions: ["manager"],
    metrics: ["total_deals", "won_deals"],
    filters: { includeCategoryNames: [], excludeCategoryNames: [] }
  };
  const restored = buildDatasetDraftFromSpec(spec, { request: spec.request });
  assert.equal(restored.datasetName, "vibecode_ai_deal_won_managers");
  assert.deepEqual(restored.fields.map((field) => field.code), ["MANAGER_ID", "MANAGER_NAME", "TOTAL_DEALS", "WON_DEALS"]);
  assert.equal(restored.period, "current_month");
});

test("версионное имя набора не выводится из спецификации", () => {
  const spec = {
    entity: "crm.deal",
    title: "Конверсия по менеджерам",
    request: "конверсия по менеджерам за текущий месяц",
    period: "current_month",
    dimensions: ["manager"],
    metrics: ["conversion_percent"],
    filters: { includeCategoryNames: [], excludeCategoryNames: [] }
  };
  const derived = buildDatasetDraftFromSpec(spec, { request: spec.request });
  // Спецификация даёт имя без версии, поэтому фактическое имя обязано браться из реестра.
  assert.equal(derived.datasetName, "vibecode_ai_deal_conversion_managers");
  assert.notEqual(derived.datasetName, "vibecode_ai_deal_won_managers_v2");
});
