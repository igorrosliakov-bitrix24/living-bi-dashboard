import assert from "node:assert/strict";
import test from "node:test";
import { createDatasetPlannerRequest } from "../lib/dataset-planner.js";
import { aggregateDealDataset, getPeriodRange } from "../lib/deal-dataset-engine.js";
import {
  datasetCapabilities,
  dimensionKeys,
  getDatasetCapabilities,
  metricKeys,
  periodKeys
} from "../lib/dataset-capabilities.js";

function plannerSchema() {
  return createDatasetPlannerRequest("проверка каталога").tools[0].function.parameters.properties;
}

test("схема инструмента выводится из каталога, а не дублирует его", () => {
  const schema = plannerSchema();
  assert.deepEqual(schema.dimensions.items.enum, [...dimensionKeys]);
  assert.deepEqual(schema.metrics.items.enum, [...metricKeys]);
  assert.deepEqual(schema.period.enum, [...periodKeys]);
  assert.equal(schema.dimensions.maxItems, dimensionKeys.length);
  assert.equal(schema.metrics.maxItems, metricKeys.length);
});

test("промпт перечисляет каждый ключ каталога вместе с человеческим названием", () => {
  const prompt = createDatasetPlannerRequest("проверка каталога").messages[0].content;
  for (const key of dimensionKeys) {
    assert.ok(prompt.includes(`${key} (${datasetCapabilities.dimensions[key].title})`), key);
  }
  for (const key of metricKeys) {
    assert.ok(prompt.includes(`${key} (${datasetCapabilities.metrics[key].title})`), key);
    assert.ok(prompt.includes(datasetCapabilities.metrics[key].formula), `формула ${key}`);
  }
  for (const key of periodKeys) {
    assert.ok(prompt.includes(`${key} (${datasetCapabilities.periods[key].title})`), key);
  }
});

test("каждая метрика умеет считаться из накопителей группы", () => {
  for (const key of metricKeys) {
    const value = datasetCapabilities.metrics[key].compute({ total: 4, won: 1 });
    assert.equal(typeof value, "number", key);
  }
  assert.equal(datasetCapabilities.metrics.conversion_percent.compute({ total: 0, won: 0 }), 0);
  assert.equal(datasetCapabilities.metrics.conversion_percent.compute({ total: 8, won: 3 }), 37.5);
});

test("каждое измерение умеет раскладывать сделку по своим полям", () => {
  const context = { users: new Map([["30", "Анна Воронцова"]]), categories: new Map([["0", "Общая воронка"]]), mondayOf: () => "2026-08-17" };
  const deal = { ASSIGNED_BY_ID: "30", CATEGORY_ID: "0", BEGINDATE: "2026-08-19T00:00:00+03:00" };
  for (const key of dimensionKeys) {
    const resolved = datasetCapabilities.dimensions[key].resolve(deal, context);
    assert.ok(resolved, key);
    for (const field of datasetCapabilities.dimensions[key].fields) {
      assert.ok(field.code in resolved.cells, `${key} → ${field.code}`);
    }
  }
});

test("периоды каталога дают корректные границы", () => {
  const now = new Date("2026-08-24T00:00:00Z");
  assert.equal(getPeriodRange("current_month", now).start, "2026-08-01");
  assert.equal(getPeriodRange("current_quarter", now).start, "2026-07-01");
  assert.equal(getPeriodRange("current_year", now).start, "2026-01-01");
  assert.throws(() => getPeriodRange("current_decade", now), /не поддерживается/);
});

test("расчёт по каталогу совпадает с ожидаемой строкой", () => {
  const rows = aggregateDealDataset({
    deals: [
      { ASSIGNED_BY_ID: "30", CATEGORY_ID: "0", BEGINDATE: "2026-08-19T10:00:00+03:00", STAGE_SEMANTIC_ID: "S" },
      { ASSIGNED_BY_ID: "30", CATEGORY_ID: "0", BEGINDATE: "2026-08-20T10:00:00+03:00", STAGE_SEMANTIC_ID: "P" }
    ],
    users: [{ ID: "30", NAME: "Анна", LAST_NAME: "Воронцова" }],
    categories: [{ id: 0, name: "Общая воронка" }],
    spec: {
      entity: "crm.deal", title: "Проверка", request: "проверка",
      dimensions: ["manager"], metrics: ["total_deals", "won_deals", "conversion_percent"],
      period: "current_month", filters: {}
    }
  });
  assert.deepEqual(rows, [{ MANAGER_ID: 30, MANAGER_NAME: "Анна Воронцова", TOTAL_DEALS: 2, WON_DEALS: 1, CONVERSION_PERCENT: 50 }]);
});

test("сериализуемый срез каталога отдаёт названия и формулы без функций", () => {
  const snapshot = getDatasetCapabilities();
  assert.equal(snapshot.entity, "crm.deal");
  assert.deepEqual(Object.keys(snapshot.metrics), [...metricKeys]);
  assert.equal(typeof snapshot.metrics.total_deals.compute, "undefined");
  assert.equal(snapshot.periods.current_quarter, "Текущий квартал");
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});
