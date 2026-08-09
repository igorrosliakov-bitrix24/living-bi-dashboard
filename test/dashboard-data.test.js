import assert from "node:assert/strict";
import test from "node:test";
import { buildAggregateRequest, buildPeriodFilter, normalizeWidgetData } from "../lib/dashboard-data.js";

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

test("adds the dashboard period and safe widget filter to aggregate requests", () => {
  const request = buildAggregateRequest({
    aggregate: { fn: "count" },
    filter: { stageId: { "$in": ["NEW", "WON"] } },
    period: { field: "createdAt", preset: "this_month" }
  }, { field: "closedAt", preset: "this_year" }, new Date("2026-08-08T10:20:30Z"));

  assert.deepEqual(request.filter, {
    stageId: { "$in": ["NEW", "WON"] },
    createdAt: { "$gte": "2026-08-01T00:00:00", "$lte": "2026-08-31T23:59:59" }
  });
  assert.deepEqual(buildPeriodFilter(undefined), {});
});

test("normalizes aggregate responses without exposing source records", () => {
  const widget = {
    id: "deals-by-stage",
    type: "bar",
    title: "Сделки по стадиям",
    aggregate: { fn: "count" },
    groupBy: ["stageId"],
    options: { sort: "desc", limit: 1 }
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
    groups: [{ label: "NEW", value: 4 }],
    truncated: true
  });
});

test("sorts grouped aggregates before limiting them", () => {
  const widget = {
    id: "deals-by-stage",
    type: "bar",
    title: "Сделки по стадиям",
    aggregate: { fn: "count" },
    groupBy: ["stageId"],
    options: { sort: "asc" }
  };

  const result = normalizeWidgetData(widget, {
    data: { groups: [{ stageId: "WON", count: 5 }, { stageId: "NEW", count: 2 }, { stageId: "LOSE", count: 1 }] }
  });

  assert.deepEqual(result.groups, [{ label: "LOSE", value: 1 }, { label: "NEW", value: 2 }, { label: "WON", value: 5 }]);
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
