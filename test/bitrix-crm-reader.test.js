import assert from "node:assert/strict";
import test from "node:test";
import { listDealCategories, validateSpecCategoryNames } from "../lib/bitrix-crm-reader.js";

test("reads only deal categories through the constrained CRM reader", async () => {
  const categories = await listDealCategories({ portalUrl: "https://portal.example.com", accessToken: "token", fetchImpl: async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/crm.category.list.json");
    assert.equal(JSON.parse(init.body).entityTypeId, 2);
    return { ok: true, json: async () => ({ result: { categories: [{ id: 1, name: "Основная" }] } }) };
  } });
  assert.deepEqual(categories, [{ id: 1, name: "Основная" }]);
});

test("rejects unknown funnel names before publication", () => {
  assert.throws(() => validateSpecCategoryNames({ filters: { excludeCategoryNames: ["Тест"] } }, [{ name: "Основная" }]), /Тест/);
});
