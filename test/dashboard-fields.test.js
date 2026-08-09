import test from "node:test";
import assert from "node:assert/strict";
import { createInitialDashboard } from "../lib/dashboard-spec.js";
import { extractFieldNames, validateDashboardFields } from "../lib/dashboard-fields.js";

test("extracts fields and validates every dashboard reference", () => {
  const dashboard = createInitialDashboard();
  const fields = new Map([["deals", new Set(["closedAt", "stageId"])]]);

  assert.deepEqual([...extractFieldNames({ data: { fields: { title: {}, amount: {} } } })], ["title", "amount"]);
  assert.deepEqual(validateDashboardFields(dashboard, fields), { valid: true, errors: [] });

  dashboard.widgets[0].filter = { imaginaryField: "value" };
  const validation = validateDashboardFields(dashboard, fields);
  assert.equal(validation.valid, false);
  assert.match(validation.errors[0], /imaginaryField/);
});
