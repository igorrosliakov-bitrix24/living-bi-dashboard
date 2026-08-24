import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDealDataset, getPeriodRange, selectDealDatasetRows } from "../lib/deal-dataset-engine.js";
import { buildDatasetDraftFromSpec } from "../lib/dataset-spec.js";

const spec = { request: "Конверсия", title: "Конверсия", dimensions: ["week", "manager"], metrics: ["total_deals", "won_deals", "conversion_percent"], period: "current_quarter", filters: { excludeCategoryNames: ["Тест"] } };
const users = [{ ID: "7", NAME: "Анна", LAST_NAME: "Иванова" }];
const categories = [{ id: 0, name: "Основная" }, { id: 2, name: "Тест" }];

test("aggregates arbitrary allowed dimensions and conversion metrics", () => {
  const rows = aggregateDealDataset({ spec, users, categories, deals: [
    { ID: "1", CATEGORY_ID: "0", ASSIGNED_BY_ID: "7", BEGINDATE: "2026-08-03", STAGE_SEMANTIC_ID: "S" },
    { ID: "2", CATEGORY_ID: "0", ASSIGNED_BY_ID: "7", BEGINDATE: "2026-08-05", STAGE_SEMANTIC_ID: "P" },
    { ID: "3", CATEGORY_ID: "2", ASSIGNED_BY_ID: "7", BEGINDATE: "2026-08-05", STAGE_SEMANTIC_ID: "S" }
  ] });
  assert.deepEqual(rows, [{ WEEK_START: "2026-08-03", MANAGER_ID: 7, MANAGER_NAME: "Анна Иванова", TOTAL_DEALS: 2, WON_DEALS: 1, CONVERSION_PERCENT: 50 }]);
});

test("supports category-only totals and include filters", () => {
  const rows = aggregateDealDataset({ users, categories, spec: { ...spec, dimensions: ["category"], metrics: ["total_deals"], filters: { includeCategoryNames: ["Основная"] } }, deals: [
    { CATEGORY_ID: 0, ASSIGNED_BY_ID: 7, BEGINDATE: "2026-08-01" }, { CATEGORY_ID: 2, ASSIGNED_BY_ID: 7, BEGINDATE: "2026-08-01" }
  ] });
  assert.equal(rows[0].TOTAL_DEALS, 1);
});

test("selects only requested columns for the adapter", () => {
  const draft = buildDatasetDraftFromSpec(spec, { request: spec.request });
  assert.deepEqual(selectDealDatasetRows([{ WEEK_START: "2026-08-03", TOTAL_DEALS: 2 }], draft, { select: ["WEEK_START", "TOTAL_DEALS"] }), [["WEEK_START", "TOTAL_DEALS"], ["2026-08-03", 2]]);
});

test("calculates bounded month, quarter and year periods", () => {
  assert.equal(getPeriodRange("current_month", new Date("2026-08-24T00:00:00Z")).start, "2026-08-01");
  assert.equal(getPeriodRange("current_quarter", new Date("2026-08-24T00:00:00Z")).start, "2026-07-01");
  assert.equal(getPeriodRange("current_year", new Date("2026-08-24T00:00:00Z")).start, "2026-01-01");
});
