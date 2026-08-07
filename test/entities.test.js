import assert from "node:assert/strict";
import test from "node:test";
import { isDashboardEntity, listDashboardEntities } from "../lib/entities.js";

test("keeps only entities supported by the MVP dashboard", () => {
  const entities = listDashboardEntities([
    { name: "deals" },
    { name: "contacts" },
    { name: "companies" },
    { name: "tasks" },
    { name: "activities" }
  ]);

  assert.deepEqual(entities, [
    { code: "deals", title: "Сделки" },
    { code: "companies", title: "Компании" },
    { code: "tasks", title: "Задачи" },
    { code: "activities", title: "Активности" }
  ]);
});

test("rejects unknown and malformed entity codes", () => {
  assert.equal(isDashboardEntity("deals"), true);
  assert.equal(isDashboardEntity("contacts"), false);
  assert.equal(isDashboardEntity(), false);
  assert.deepEqual(listDashboardEntities(), []);
});
