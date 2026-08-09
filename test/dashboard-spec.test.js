import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDashboard, validateDashboardSpec } from "../lib/dashboard-spec.js";

test("creates a valid initial dashboard specification", () => {
  const spec = createInitialDashboard();

  assert.equal(validateDashboardSpec(spec).valid, true);
  assert.equal(spec.widgets[0].aggregate.fn, "count");
});

test("rejects unsafe dashboard shapes and unsupported business operations", () => {
  const invalid = {
    version: 0,
    title: "",
    period: { field: "close date", preset: "forever" },
    widgets: [
      {
        id: "same",
        type: "pie",
        title: "",
        entity: "contacts",
        groupBy: ["bad field"],
        aggregate: { fn: "sum" },
        options: { limit: 51, sort: "random" }
      },
      {
        id: "same",
        type: "kpi",
        title: "Дублирующий",
        entity: "deals",
        aggregate: { fn: "count", field: "id" }
      }
    ]
  };

  const result = validateDashboardSpec(invalid);

  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 9);
});

test("accepts a numeric aggregate only with a safe field name", () => {
  const spec = createInitialDashboard();
  spec.widgets[1].aggregate = { fn: "sum", field: "opportunity" };

  assert.equal(validateDashboardSpec(spec).valid, true);
  spec.widgets[1].aggregate.field = "opportunity; delete";
  assert.equal(validateDashboardSpec(spec).valid, false);
});

test("accepts supported visual types, filters, and widget period overrides", () => {
  const dashboard = createInitialDashboard();
  dashboard.widgets[0] = {
    ...dashboard.widgets[0],
    type: "donut",
    filter: { stageId: { "$in": ["NEW", "WON"] } },
    period: { field: "createdAt", preset: "this_month" },
    options: { color: "#2fc6f6", orientation: "horizontal" }
  };

  assert.deepEqual(validateDashboardSpec(dashboard), { valid: true, errors: [] });

  dashboard.widgets[0].filter = { "$or": [] };
  assert.equal(validateDashboardSpec(dashboard).valid, false);
});
