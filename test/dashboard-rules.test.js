import assert from "node:assert/strict";
import test from "node:test";
import { resolveCategoryExclusions } from "../lib/dashboard-rules.js";

test("resolves a named deal funnel into a safe category filter", () => {
  const result = resolveCategoryExclusions({
    entity: "deals",
    filter: { isReturning: false },
    categoryExclusions: ["Тест"]
  }, [{ id: 12, name: "Тест" }, { id: 5, name: "Продажи" }]);

  assert.deepEqual(result.widget.filter, { isReturning: false, categoryId: { $nin: [12] } });
  assert.deepEqual(result.warnings, []);
});

test("keeps the configuration valid when a named funnel is absent", () => {
  const result = resolveCategoryExclusions({ entity: "deals", categoryExclusions: ["Тест"] }, []);

  assert.deepEqual(result.widget.filter, {});
  assert.match(result.warnings[0], /пока не найдена/);
});
