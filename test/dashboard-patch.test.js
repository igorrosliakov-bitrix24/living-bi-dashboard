import test from "node:test";
import assert from "node:assert/strict";
import { createInitialDashboard } from "../lib/dashboard-spec.js";
import { applyDashboardPatch, DashboardPatchError } from "../lib/dashboard-patch.js";

test("applies a constrained patch without changing dashboard version", () => {
  const dashboard = createInitialDashboard();
  const next = applyDashboardPatch(dashboard, [
    { op: "replace", path: "/widgets/0/options/sort", value: "asc" },
    { op: "replace", path: "/title", value: "Продажи по этапам" }
  ]);

  assert.equal(next.version, 1);
  assert.equal(next.title, "Продажи по этапам");
  assert.equal(next.widgets[0].options.sort, "asc");
});

test("rejects unsafe and invalid patch paths", () => {
  const dashboard = createInitialDashboard();

  assert.throws(() => applyDashboardPatch(dashboard, [{ op: "replace", path: "/version", value: 9 }]), DashboardPatchError);
  assert.throws(() => applyDashboardPatch(dashboard, [{ op: "copy", path: "/title", value: "x" }]), DashboardPatchError);
  assert.throws(() => applyDashboardPatch(dashboard, [{ op: "replace", path: "/__proto__/x", value: "x" }]), DashboardPatchError);
});
