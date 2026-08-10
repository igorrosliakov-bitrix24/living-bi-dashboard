import assert from "node:assert/strict";
import test from "node:test";
import { AiDashboardError, buildDashboardDiff, createAiCompletionRequest, createDevelopmentRequest, createProposalFromPatch, extractAiToolCalls } from "../lib/ai-dashboard.js";
import { createInitialDashboard } from "../lib/dashboard-spec.js";

test("creates a constrained tool request without CRM records", () => {
  const request = createAiCompletionRequest("Отсортируй стадии по возрастанию");

  assert.equal(request.model, "bitrix/bitrixgpt-5.5");
  assert.equal(request.tools.length, 6);
  assert.match(request.messages[1].content, /Отсортируй стадии/);
  assert.match(request.messages[0].content, /Не добавляй CRM-записи/);
  assert.match(request.messages[0].content, /Фирменная палитра: bitrix24/);
  assert.match(request.messages[0].content, /request_development/);
});

test("creates a copyable development request without dashboard records", () => {
  const request = createDevelopmentRequest("Добавь просроченные задачи по отделам", {
    title: "Динамика просроченных задач",
    reason: "В дашборде нет недельной группировки и поля отдела для задач.",
    requiredCapabilities: ["Добавить агрегацию задач по неделям", "Поддержать группировку по отделам"],
    expectedResult: ["Пользователь видит график динамики и таблицу по отделам"],
    acceptanceCriteria: ["Команда проходит preview и показывает diff до сохранения"]
  });

  assert.equal(request.requiredCapabilities.length, 2);
  assert.match(request.markdown, /# Заявка на доработку BI-дашборда/);
  assert.match(request.markdown, /Добавь просроченные задачи по отделам/);
  assert.match(request.markdown, /Критерии готовности/);
  assert.doesNotMatch(request.markdown, /vibe_app_|vibe_session_/);
});

test("rejects an incomplete development request", () => {
  assert.throws(
    () => createDevelopmentRequest("Добавь график", { title: "График", reason: "Нужна функция", requiredCapabilities: [] }),
    (error) => error instanceof AiDashboardError && error.code === "ai_invalid_development_request"
  );
});

test("redacts credentials from a development request", () => {
  const request = createDevelopmentRequest("Добавь график, ключ vibe_app_secret", {
    title: "График",
    reason: "Нужна функция с Bearer token-value",
    requiredCapabilities: ["Новая агрегация"],
    expectedResult: ["График отображается"],
    acceptanceCriteria: ["Есть preview"]
  });

  assert.match(request.markdown, /\[скрыто\]/);
  assert.doesNotMatch(request.markdown, /secret|token-value/);
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
