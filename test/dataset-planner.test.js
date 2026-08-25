import assert from "node:assert/strict";
import test from "node:test";
import { createDatasetPlannerRequest, DatasetPlannerError, describeCurrentSpec, parseDatasetPlannerResponse } from "../lib/dataset-planner.js";

function toolCall(name, value) { return { choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] }; }

test("constrains BitrixGPT to the supported capability catalog", () => {
  const request = createDatasetPlannerRequest("Конверсия по менеджерам");
  assert.equal(request.tools[0].function.name, "prepare_dataset_spec");
  assert.match(request.messages[0].content, /Не возвращай SQL/);
});

test("turns a valid tool call into a server-derived draft", () => {
  const result = parseDatasetPlannerResponse(toolCall("prepare_dataset_spec", {
    title: "Конверсия по менеджерам и неделям", dimensions: ["week", "manager"], metrics: ["conversion_percent"],
    period: "current_quarter", filters: { excludeCategoryNames: ["Тест"] }, summary: "Подготовлена конверсия."
  }), "Конверсия по менеджерам по неделям без тестовой воронки");
  assert.equal(result.draft.datasetName, "vibecode_ai_deal_conversion_weekly");
  assert.equal(result.draft.planner.provider, "BitrixGPT");
});

test("rejects an attempt to leave the allowlist", () => {
  assert.throws(() => parseDatasetPlannerResponse(toolCall("prepare_dataset_spec", {
    title: "SQL", dimensions: ["sql"], metrics: ["revenue"], period: "all_time", filters: {}, summary: "SQL"
  }), "Сделай SQL"), (error) => error instanceof DatasetPlannerError && error.code === "ai_invalid_spec");
});

test("returns development result for unsupported requests", () => {
  assert.deepEqual(parseDatasetPlannerResponse(toolCall("request_dataset_development", { reason: "Нужна сущность лидов." }), "Лиды"),
    { kind: "development", development: { reason: "Нужна сущность лидов." } });
});

const publishedSpec = { dimensions: ["manager"], metrics: ["total_deals", "won_deals"], period: "current_month" };

test("промпт называет текущий состав набора при изменении", () => {
  const prompt = createDatasetPlannerRequest("добавь конверсию", publishedSpec).messages[0].content;
  assert.match(prompt, /меняет уже опубликованный набор/);
  assert.match(prompt, /total_deals/);
  assert.match(prompt, /won_deals/);
  assert.match(prompt, /current_month/);
  assert.match(prompt, /дополнение к этому составу/);
});

test("для нового набора состав не упоминается", () => {
  const prompt = createDatasetPlannerRequest("конверсия по менеджерам").messages[0].content;
  assert.doesNotMatch(prompt, /меняет уже опубликованный набор/);
});

test("неизвестные ключи из реестра в промпт не попадают", () => {
  const description = describeCurrentSpec({ dimensions: ["manager", "выдумка"], metrics: ["won_deals"], period: "нет_такого" });
  assert.match(description, /manager/);
  assert.doesNotMatch(description, /выдумка/);
  assert.doesNotMatch(description, /Период/);
});

test("пустая спецификация не добавляет ничего в промпт", () => {
  assert.equal(describeCurrentSpec(null), null);
  assert.equal(describeCurrentSpec({ dimensions: [], metrics: [] }), null);
});
