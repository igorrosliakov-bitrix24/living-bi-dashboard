import assert from "node:assert/strict";
import test from "node:test";
import { DashboardStore } from "../lib/dashboard-store.js";
import { createInitialDashboard } from "../lib/dashboard-spec.js";

test("creates immutable copies and saves a new version", () => {
  const store = new DashboardStore();
  const current = store.getCurrent();
  current.title = "Изменённая копия";

  assert.equal(store.getCurrent().title, "Продажи: обзор");

  const next = store.getCurrent();
  next.title = "Продажи за квартал";
  const result = store.save(next, 1);

  assert.equal(result.saved, true);
  assert.equal(result.dashboard.version, 2);
  assert.equal(store.getCurrent().title, "Продажи за квартал");
});

test("prevents stale and invalid writes", () => {
  const store = new DashboardStore();
  const invalid = store.getCurrent();
  invalid.widgets = [];

  assert.deepEqual(store.save(invalid, 99), {
    saved: false,
    error: "version_conflict",
    currentVersion: 1
  });

  const result = store.save(invalid, 1);
  assert.equal(result.saved, false);
  assert.equal(result.error, "invalid_spec");
  assert.ok(result.errors.includes("widgets должен содержать от 1 до 12 виджетов."));
});

test("lists versions and restores a prior version as a new record", () => {
  const store = new DashboardStore();
  const changed = store.getCurrent();
  changed.title = "Продажи за квартал";
  store.save(changed, 1);

  assert.deepEqual(store.listVersions(), [
    { version: 2, title: "Продажи за квартал", widgetCount: 2, current: true },
    { version: 1, title: "Продажи: обзор", widgetCount: 2, current: false }
  ]);

  const restored = store.restore(1, 2);
  assert.equal(restored.saved, true);
  assert.equal(restored.dashboard.version, 3);
  assert.equal(restored.dashboard.title, "Продажи: обзор");
  assert.deepEqual(store.restore(99, 3), { saved: false, error: "version_not_found" });
});

test("migrates the legacy closeDate period field", () => {
  const legacy = createInitialDashboard();
  legacy.period.field = "closeDate";
  const store = new DashboardStore(legacy);

  assert.equal(store.getCurrent().period.field, "closedAt");
});

test("includes dashboard owner in the persistent snapshot", () => {
  const store = new DashboardStore();

  assert.equal(store.claimOwner("user-1"), true);
  assert.equal(store.claimOwner("user-2"), false);
  assert.equal(store.getSnapshot().ownerId, "user-1");
  assert.equal(store.getSnapshot().format, 2);
});
