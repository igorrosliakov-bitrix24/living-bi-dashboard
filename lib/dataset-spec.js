import { datasetCapabilities } from "./dataset-capabilities.js";
import { validateDatasetDraft } from "./dataset-draft.js";

const maxRequestLength = 500;
const maxCategoryFilters = 10;

export class DatasetSpecError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DatasetSpecError";
    this.code = code;
  }
}

export function normalizeDatasetSpec(input, { request = "" } = {}) {
  if (!isRecord(input)) throw new DatasetSpecError("invalid_dataset_spec", "Спецификация датасета должна быть объектом.");
  if (input.entity !== undefined && input.entity !== "crm.deal") throw new DatasetSpecError("unsupported_entity", "Поддерживаются только сделки CRM.");
  const normalizedRequest = String(request || input.request || "").trim();
  if (!normalizedRequest || normalizedRequest.length > maxRequestLength) {
    throw new DatasetSpecError("invalid_dataset_request", `Описание должно содержать от 1 до ${maxRequestLength} символов.`);
  }

  const dimensions = normalizeKeys(input.dimensions, datasetCapabilities.dimensions, "измерение");
  const metrics = normalizeKeys(input.metrics, datasetCapabilities.metrics, "метрику");
  const period = String(input.period || "current_quarter");
  if (!Object.hasOwn(datasetCapabilities.periods, period)) {
    throw new DatasetSpecError("unsupported_period", "Период не поддерживается.");
  }
  const includeCategoryNames = normalizeNames(input.filters?.includeCategoryNames, "includeCategoryNames");
  const excludeCategoryNames = normalizeNames(input.filters?.excludeCategoryNames, "excludeCategoryNames");
  if (includeCategoryNames.length && excludeCategoryNames.length) {
    throw new DatasetSpecError("conflicting_category_filters", "Нельзя одновременно включать и исключать воронки.");
  }
  const title = String(input.title || buildTitle(dimensions, metrics)).trim();
  if (!title || title.length > 120) throw new DatasetSpecError("invalid_dataset_title", "Название должно содержать от 1 до 120 символов.");

  return {
    version: 1,
    entity: "crm.deal",
    request: normalizedRequest,
    title,
    dimensions,
    metrics,
    period,
    filters: { includeCategoryNames, excludeCategoryNames }
  };
}

export function buildDatasetDraftFromSpec(input, options = {}) {
  const spec = normalizeDatasetSpec(input, options);
  const fields = [
    ...spec.dimensions.flatMap((key) => datasetCapabilities.dimensions[key].fields),
    ...spec.metrics.map((key) => datasetCapabilities.metrics[key].field)
  ].map((field) => ({ ...field }));
  const draft = {
    template: "dynamic_deal_dataset",
    datasetName: deriveDatasetName(spec),
    title: spec.title,
    request: spec.request,
    source: { entity: spec.entity, description: "Расчётный набор по сделкам CRM." },
    period: spec.period,
    filters: describeFilters(spec.filters),
    formula: describeFormula(spec.metrics),
    fields,
    sampleRows: buildSampleRows(fields),
    spec,
    publication: { status: "draft", message: "Черновик проверен сервером. В Битрикс24 он ещё не опубликован." }
  };
  const validation = validateDatasetDraft(draft);
  if (!validation.valid) throw new DatasetSpecError("invalid_dataset_draft", validation.errors.join(" "));
  return draft;
}

export function deriveDatasetName(spec) {
  const metric = spec.metrics.includes("conversion_percent")
    ? "conversion"
    : spec.metrics.includes("won_deals") ? "won" : "total";
  const dimension = spec.dimensions.includes("week")
    ? "weekly"
    : spec.dimensions.includes("manager") ? "managers" : "categories";
  return `vibecode_ai_deal_${metric}_${dimension}`;
}

function normalizeKeys(value, catalog, label) {
  if (!Array.isArray(value) || value.length === 0) throw new DatasetSpecError("empty_dataset_axis", `Выберите хотя бы одно ${label}.`);
  const keys = [...new Set(value.map(String))];
  if (keys.length !== value.length || keys.some((key) => !Object.hasOwn(catalog, key))) {
    throw new DatasetSpecError("unsupported_dataset_axis", `Спецификация содержит неподдерживаемое ${label}.`);
  }
  return keys;
}

function normalizeNames(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxCategoryFilters) {
    throw new DatasetSpecError("invalid_category_filter", `${field} должен быть массивом не более чем из ${maxCategoryFilters} названий.`);
  }
  const names = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (names.some((name) => name.length > 100)) throw new DatasetSpecError("invalid_category_filter", "Название воронки слишком длинное.");
  return names;
}

function buildTitle(dimensions, metrics) {
  const metric = metrics.map((key) => datasetCapabilities.metrics[key].title.toLowerCase()).join(", ");
  const dimension = dimensions.map((key) => datasetCapabilities.dimensions[key].title.toLowerCase()).join(" и ");
  return `${metric} по ${dimension}`;
}

function describeFilters(filters) {
  if (filters.includeCategoryNames.length) return [`включить только воронки: ${filters.includeCategoryNames.join(", ")}`];
  if (filters.excludeCategoryNames.length) return [`исключить воронки: ${filters.excludeCategoryNames.join(", ")}`];
  return ["все воронки"];
}

function describeFormula(metrics) {
  const parts = [];
  if (metrics.includes("total_deals")) parts.push("TOTAL_DEALS — количество подходящих сделок");
  if (metrics.includes("won_deals")) parts.push("WON_DEALS — сделки со STAGE_SEMANTIC_ID = S");
  if (metrics.includes("conversion_percent")) parts.push("CONVERSION_PERCENT = WON_DEALS / TOTAL_DEALS × 100");
  return parts.join("; ") + ".";
}

function buildSampleRows(fields) {
  const row = {};
  for (const field of fields) {
    if (field.code === "WEEK_START") row[field.code] = "2026-08-03";
    else if (field.code.endsWith("_ID")) row[field.code] = 101;
    else if (field.code === "MANAGER_NAME") row[field.code] = "Менеджер A";
    else if (field.code === "CATEGORY_NAME") row[field.code] = "Основная";
    else if (field.code === "CONVERSION_PERCENT") row[field.code] = 40;
    else row[field.code] = 10;
  }
  return [row];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
