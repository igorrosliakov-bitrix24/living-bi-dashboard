import assert from "node:assert/strict";
import test from "node:test";
import { getDynamicDescription, mergeDynamicTables, resolveTableAvailability } from "../lib/dynamic-adapter.js";

const record = { datasetName: "vibecode_ai_deal_conversion_weekly", title: "Конверсия", status: "active", fields: [{ code: "WEEK_START", title: "Неделя", type: "date" }, { code: "CONVERSION_PERCENT", title: "Конверсия", type: "float" }] };
test("merges dynamic and static tables without duplicates", () => {
  assert.deepEqual(mergeDynamicTables([{ code: "static", title: "Static" }], [record]).map((item) => item.code), ["static", record.datasetName]);
});
test("maps server field types to BI connector types", () => {
  assert.deepEqual(getDynamicDescription(record).map((field) => field.type), ["date", "double"]);
});

test("статическая таблица обслуживается без записи в реестре", () => {
  assert.deepEqual(resolveTableAvailability("vibecode_bi_demo", null, ["vibecode_bi_demo"]), { available: true, kind: "static" });
});

test("активная запись реестра обслуживается как динамическая", () => {
  assert.equal(resolveTableAvailability(record.datasetName, record, []).kind, "dynamic");
});

test("незнакомая таблица отдаётся ошибкой, а не пустым ответом", () => {
  const result = resolveTableAvailability("чужая_таблица", null, ["vibecode_bi_demo"]);
  assert.equal(result.available, false);
  assert.equal(result.code, "unknown_table");
});

test("сломанный набор называет своё состояние", () => {
  const result = resolveTableAvailability(record.datasetName, { ...record, status: "failed" }, []);
  assert.equal(result.available, false);
  assert.equal(result.code, "dataset_not_available");
  assert.match(result.message, /failed/);
});

test("запрос без имени таблицы отклоняется", () => {
  assert.equal(resolveTableAvailability("", null, []).code, "table_not_specified");
});
