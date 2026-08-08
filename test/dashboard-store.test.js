import assert from "node:assert/strict";
import test from "node:test";
import { DashboardStore } from "../lib/dashboard-store.js";

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
