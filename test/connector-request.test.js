import assert from "node:assert/strict";
import test from "node:test";
import { parseConnectorForm } from "../lib/connector-request.js";

test("parses indexed arrays and field maps sent by the BI constructor", () => {
  const body = parseConnectorForm(
    "table=vibecode_bi_demo&select%5B0%5D=ID&select%5B1%5D=TITLE&mapFields%5BID%5D=ID&limit=100"
  );

  assert.deepEqual(body, {
    table: "vibecode_bi_demo",
    select: ["ID", "TITLE"],
    mapFields: { ID: "ID" },
    limit: "100"
  });
});

test("parses repeated array parameters", () => {
  assert.deepEqual(parseConnectorForm("select%5B%5D=ID&select%5B%5D=TITLE"), {
    select: ["ID", "TITLE"]
  });
});
