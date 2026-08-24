import assert from "node:assert/strict";
import test from "node:test";
import { getBiConnectorData, getBiConnectorDescription, getBiConnectorTables } from "../lib/bi-connector-demo.js";

test("BI connector exposes the demo table and its schema", () => {
  assert.deepEqual(
    getBiConnectorTables("vibecode").map((table) => table.code),
    ["vibecode_bi_demo", "vibecode_ai_deal_intake_weekly"]
  );
  assert.equal(getBiConnectorTables("missing").length, 0);
  assert.deepEqual(getBiConnectorDescription("vibecode_bi_demo").map((field) => field.code), ["ID", "TITLE", "AMOUNT", "CREATED_AT"]);
  assert.deepEqual(
    getBiConnectorDescription("vibecode_ai_deal_intake_weekly").map((field) => field.code),
    [
      "WEEK_START",
      "MANAGER_ID",
      "MANAGER_NAME",
      "CURRENCY_ID",
      "NEW_DEALS",
      "PIPELINE_AMOUNT",
      "AVERAGE_AMOUNT",
      "WEEKLY_SHARE_PERCENT"
    ]
  );
});

test("BI connector returns a header row and only requested fields", () => {
  const rows = getBiConnectorData({ table: "vibecode_bi_demo", select: ["TITLE", "AMOUNT"], limit: 2 });
  assert.deepEqual(rows[0], ["TITLE", "AMOUNT"]);
  assert.deepEqual(rows[1], ["Демонстрационная сделка A", 120000]);
  assert.equal(rows.length, 3);
  assert.deepEqual(getBiConnectorData({ table: "unknown" }), []);
});
