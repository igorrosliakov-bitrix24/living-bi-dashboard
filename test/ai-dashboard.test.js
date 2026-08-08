import assert from "node:assert/strict";
import test from "node:test";
import { AiDashboardError, buildDashboardDiff, createAiCompletionRequest, extractAiProposal } from "../lib/ai-dashboard.js";
import { createInitialDashboard } from "../lib/dashboard-spec.js";

test("creates a constrained JSON request without CRM records", () => {
  const dashboard = createInitialDashboard();
  const request = createAiCompletionRequest(dashboard, "Отсортируй стадии по возрастанию");

  assert.equal(request.model, "bitrix/bitrixgpt-5.5");
  assert.deepEqual(request.response_format, { type: "json_object" });
  assert.match(request.messages[0].content, /Не добавляй CRM-записи/);
  assert.match(request.messages[1].content, /Отсортируй стадии/);
});

test("accepts only a valid proposal for the current version", () => {
  const dashboard = createInitialDashboard();
  const proposed = structuredClone(dashboard);
  proposed.widgets[0].options.sort = "asc";
  const result = extractAiProposal({
    choices: [{ message: { content: JSON.stringify({ dashboard: proposed, summary: "Изменил сортировку." }) } }]
  }, 1);

  assert.equal(result.summary, "Изменил сортировку.");
  assert.equal(result.dashboard.widgets[0].options.sort, "asc");
  assert.throws(
    () => extractAiProposal({ choices: [{ message: { content: JSON.stringify({ dashboard: { ...proposed, version: 2 } }) } }] }, 1),
    AiDashboardError
  );
});

test("builds a compact human-readable dashboard diff", () => {
  const current = createInitialDashboard();
  const next = structuredClone(current);
  next.title = "Продажи за квартал";
  next.widgets[0].options.sort = "asc";

  assert.deepEqual(buildDashboardDiff(current, next), [
    "Название отчёта: «Продажи: обзор» -> «Продажи за квартал»",
    "Сортировка «Сделки по стадиям»: по возрастанию."
  ]);
});
