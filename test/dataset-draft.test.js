import assert from "node:assert/strict";
import test from "node:test";
import { buildDatasetDraft, confirmDatasetDraft, validateDatasetDraft } from "../lib/dataset-draft.js";

test("builds a safe preview for the supported dataset template", () => {
  const draft = buildDatasetDraft({ request: "Новые сделки по менеджерам за квартал" });

  assert.equal(draft.datasetName, "vibecode_ai_deal_intake_weekly");
  assert.equal(draft.fields.length, 8);
  assert.equal(draft.period, "current_quarter");
  assert.equal(draft.publication.status, "draft");
});

test("rejects an empty or oversized business request", () => {
  assert.throws(() => buildDatasetDraft({ request: "" }), /длиной от 1 до 500/);
  assert.throws(() => buildDatasetDraft({ request: "x".repeat(501) }), /длиной от 1 до 500/);
});

test("rejects duplicate fields, unsafe names, and unknown types", () => {
  const result = validateDatasetDraft({
    datasetName: "VIBECODE_DATASET",
    title: "Набор",
    fields: [
      { code: "FIELD", title: "Поле", type: "string" },
      { code: "FIELD", title: "Дубликат", type: "sql" }
    ]
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
});

test("confirmation records only an application draft", () => {
  const draft = buildDatasetDraft({ request: "Новые сделки по неделям" });
  const record = confirmDatasetDraft(draft);

  assert.match(record.id, /^draft-/);
  assert.equal(record.status, "draft_confirmed");
  assert.match(record.message, /готов к безопасному сравнению/);
});
