import assert from "node:assert/strict";
import test from "node:test";
import { getDynamicDescription, mergeDynamicTables } from "../lib/dynamic-adapter.js";

const record = { datasetName: "vibecode_ai_deal_conversion_weekly", title: "Конверсия", status: "active", fields: [{ code: "WEEK_START", title: "Неделя", type: "date" }, { code: "CONVERSION_PERCENT", title: "Конверсия", type: "float" }] };
test("merges dynamic and static tables without duplicates", () => {
  assert.deepEqual(mergeDynamicTables([{ code: "static", title: "Static" }], [record]).map((item) => item.code), ["static", record.datasetName]);
});
test("maps server field types to BI connector types", () => {
  assert.deepEqual(getDynamicDescription(record).map((field) => field.type), ["date", "double"]);
});
