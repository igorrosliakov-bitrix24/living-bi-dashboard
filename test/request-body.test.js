import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { RequestBodyError, readJsonBody } from "../lib/request-body.js";

test("reads a JSON request body", async () => {
  const body = await readJsonBody(Readable.from(["{\"title\":\"Продажи\"}"]));

  assert.deepEqual(body, { title: "Продажи" });
});

test("rejects empty, invalid, and oversized JSON bodies", async () => {
  await assert.rejects(readJsonBody(Readable.from([])), RequestBodyError);
  await assert.rejects(readJsonBody(Readable.from(["{"])), /Не удалось прочитать JSON/);
  await assert.rejects(readJsonBody(Readable.from(["12345"]), 4), /Изменение слишком большое/);
});
