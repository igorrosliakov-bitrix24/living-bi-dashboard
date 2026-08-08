import assert from "node:assert/strict";
import test from "node:test";
import { buildAggregateRequest, normalizeWidgetData } from "../lib/dashboard-data.js";

test("builds a count aggregate with an optional grouping", () => {
  const request = buildAggregateRequest({
    aggregate: { fn: "count" },
    groupBy: ["stageId"]
  });

  assert.deepEqual(request, {
    aggregate: [{ field: "*", function: "count" }],
    groupBy: ["stageId"]
  });
});

test("builds a numeric aggregate without empty groupings", () => {
  const request = buildAggregateRequest({
    aggregate: { fn: "sum", field: "opportunity" },
    groupBy: []
  });

  assert.deepEqual(request, {
    aggregate: [{ field: "opportunity", function: "sum" }]
  });
});

test("normalizes aggregate responses without exposing source records", () => {
  const widget = {
    id: "deals-by-stage",
    type: "bar",
    title: "Сделки по стадиям",
    aggregate: { fn: "count" },
    groupBy: ["stageId"]
  };

  const result = normalizeWidgetData(widget, {
    data: {
      count: 7,
      groups: [{ stageId: "NEW", count: 4 }, { count: 3 }],
      meta: { truncated: true }
    }
  });

  assert.deepEqual(result, {
    id: "deals-by-stage",
    type: "bar",
    title: "Сделки по стадиям",
    value: 7,
    groups: [{ label: "NEW", value: 4 }, { label: "Не указано", value: 3 }],
    truncated: true
  });
});

test("normalizes absent and numeric aggregate values to zero", () => {
  const widget = {
    id: "revenue",
    type: "kpi",
    title: "Выручка",
    aggregate: { fn: "sum", field: "opportunity" }
  };

  assert.deepEqual(normalizeWidgetData(widget, {}), {
    id: "revenue",
    type: "kpi",
    title: "Выручка",
    value: 0,
    groups: [],
    truncated: false
  });
});
