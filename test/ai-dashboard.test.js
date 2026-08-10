import assert from "node:assert/strict";
import test from "node:test";
import { AiDashboardError, buildDashboardDiff, createAiCompletionRequest, createProposalFromPatch, extractAiToolCalls } from "../lib/ai-dashboard.js";
import { createInitialDashboard } from "../lib/dashboard-spec.js";

test("creates a constrained tool request without CRM records", () => {
  const request = createAiCompletionRequest("Отсортируй стадии по возрастанию");

  assert.equal(request.model, "bitrix/bitrixgpt-5.5");
  assert.equal(request.tools.length, 5);
  assert.match(request.messages[1].content, /Отсортируй стадии/);
  assert.match(request.messages[0].content, /Не добавляй CRM-записи/);
  assert.match(request.messages[0].content, /Фирменная палитра: bitrix24/);
});

test("accepts an apply_changes tool call and validates its patch", () => {
  const dashboard = createInitialDashboard();
  const calls = extractAiToolCalls({ choices: [{ message: { tool_calls: [{ id: "call_1", type: "function", function: { name: "apply_changes", arguments: JSON.stringify({ patch: [{ op: "replace", path: "/widgets/0/options/sort", value: "asc" }], summary: "Изменил сортировку." }) } }] } }] });
  const result = createProposalFromPatch(dashboard, calls[0].arguments.patch, calls[0].arguments.summary);

  assert.equal(result.summary, "Изменил сортировку.");
  assert.equal(result.dashboard.widgets[0].options.sort, "asc");
  assert.throws(
    () => extractAiToolCalls({ choices: [{ message: { tool_calls: [{ id: "broken", type: "function", function: { name: "apply_changes", arguments: "{" } }] } }] }),
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
