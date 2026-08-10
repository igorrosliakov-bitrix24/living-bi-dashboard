import { isDashboardEntity } from "./entities.js";
import { dashboardCapabilities, isSupportedPalette, isSupportedWidgetType } from "./dashboard-capabilities.js";

const filterOperators = new Set(["$gt", "$gte", "$lt", "$lte", "$ne", "$contains", "$in", "$nin"]);
const fieldNamePattern = /^[a-z][a-zA-Z0-9]*$/;

export function createInitialDashboard() {
  return {
    version: 1,
    title: "Продажи: обзор",
    period: { field: "closedAt", preset: "all_time" },
    widgets: [
      {
        id: "deals-by-stage",
        type: "bar",
        title: "Сделки по стадиям",
        entity: "deals",
        groupBy: ["stageId"],
        aggregate: { fn: "count" },
        options: { sort: "desc", limit: 10, orientation: "vertical" }
      },
      {
        id: "deal-count",
        type: "kpi",
        title: "Количество сделок",
        entity: "deals",
        aggregate: { fn: "count" }
      }
    ]
  };
}

export function validateDashboardSpec(spec) {
  const errors = [];

  if (!isPlainRecord(spec)) {
    return { valid: false, errors: ["Спека должна быть объектом."] };
  }

  if (!Number.isInteger(spec.version) || spec.version < 1) {
    errors.push("version должен быть положительным целым числом.");
  }

  if (!isShortText(spec.title, 120)) {
    errors.push("title должен быть непустой строкой до 120 символов.");
  }

  validatePeriod(spec.period, errors);
  rejectUnknownKeys(spec, ["version", "title", "period", "widgets"], "Спека", errors);

  if (!Array.isArray(spec.widgets) || spec.widgets.length < 1 || spec.widgets.length > 12) {
    errors.push("widgets должен содержать от 1 до 12 виджетов.");
  } else {
    const ids = new Set();

    for (const widget of spec.widgets) {
      validateWidget(widget, ids, errors);
    }

    validateComputedReferences(spec.widgets, errors);
  }

  return { valid: errors.length === 0, errors };
}

function validatePeriod(period, errors) {
  if (!isPlainRecord(period) || !isFieldName(period.field) || !dashboardCapabilities.periodPresets.includes(period.preset)) {
    errors.push("period должен содержать поле и допустимый период.");
  }
  rejectUnknownKeys(period, ["field", "preset"], "period", errors);
}

function validateWidget(widget, ids, errors) {
  if (!isPlainRecord(widget)) {
    errors.push("Каждый виджет должен быть объектом.");
    return;
  }

  if (!isShortText(widget.id, 64) || !/^[a-z0-9-]+$/.test(widget.id)) {
    errors.push("id виджета должен состоять из строчных букв, цифр и дефисов.");
  } else if (ids.has(widget.id)) {
    errors.push(`id виджета ${widget.id} повторяется.`);
  } else {
    ids.add(widget.id);
  }

  if (!isSupportedWidgetType(widget.type)) {
    errors.push("Указан неподдерживаемый тип виджета.");
  }

  if (!isShortText(widget.title, 120)) {
    errors.push("title виджета должен быть непустой строкой до 120 символов.");
  }

  const isComputed = widget.computed !== undefined;

  if (!isComputed && !isDashboardEntity(widget.entity)) {
    errors.push("Виджет использует неподдерживаемую сущность.");
  }

  if (isComputed && widget.entity !== undefined) {
    errors.push("Вычисляемый KPI не использует сущность.");
  }

  if (widget.groupBy !== undefined && (!Array.isArray(widget.groupBy) || widget.groupBy.some((field) => !isFieldName(field)))) {
    errors.push("groupBy может содержать только безопасные имена полей.");
  }

  validateFilter(widget.filter, errors);
  validateCategoryExclusions(widget.categoryExclusions, errors);
  if (widget.period !== undefined) {
    validatePeriod(widget.period, errors);
  }
  if (isComputed) {
    validateComputed(widget, errors);
  } else {
    validateAggregate(widget.aggregate, errors);
  }
  validateOptions(widget.options, errors);
  rejectUnknownKeys(widget, ["id", "type", "title", "entity", "filter", "categoryExclusions", "groupBy", "aggregate", "period", "options", "computed"], "Виджет", errors);
}

function validateComputed(widget, errors) {
  if (widget.type !== "kpi") {
    errors.push("Вычисляемым может быть только KPI-виджет.");
  }

  if (widget.aggregate !== undefined || widget.groupBy !== undefined || widget.filter !== undefined || widget.period !== undefined) {
    errors.push("Вычисляемый KPI не может содержать aggregate, groupBy, filter или period.");
  }

  if (!isPlainRecord(widget.computed) || !parseComputedExpression(widget.computed.expr) || !["number", "percent"].includes(widget.computed.format)) {
    errors.push("computed должен содержать безопасное выражение деления двух KPI и формат number или percent.");
    return;
  }

  rejectUnknownKeys(widget.computed, ["expr", "format"], "computed", errors);
}

function validateComputedReferences(widgets, errors) {
  const ids = new Set(widgets.map((widget) => widget?.id));

  for (const widget of widgets) {
    if (widget?.computed === undefined) {
      continue;
    }

    const references = parseComputedExpression(widget.computed?.expr);
    if (!references || references.some((id) => !ids.has(id) || id === widget.id)) {
      errors.push("computed может ссылаться только на существующие KPI, кроме самого себя.");
    }
  }
}

export function parseComputedExpression(expression) {
  if (typeof expression !== "string") {
    return null;
  }

  const match = expression.match(/^([a-z0-9-]+)\s*\/\s*([a-z0-9-]+)$/);
  return match ? [match[1], match[2]] : null;
}

function validateAggregate(aggregate, errors) {
  if (!isPlainRecord(aggregate) || !dashboardCapabilities.aggregateFunctions.includes(aggregate.fn)) {
    errors.push("aggregate должен содержать поддерживаемую функцию.");
    return;
  }

  if (aggregate.fn === "count" && aggregate.field !== undefined) {
    errors.push("Для count поле aggregate.field не указывается.");
  }

  if (aggregate.fn !== "count" && !isFieldName(aggregate.field)) {
    errors.push("Для sum и avg нужно безопасное имя поля.");
  }
  rejectUnknownKeys(aggregate, ["fn", "field"], "aggregate", errors);
}

function validateOptions(options, errors) {
  if (options === undefined) {
    return;
  }

  if (!isPlainRecord(options)) {
    errors.push("options должен быть объектом.");
    return;
  }

  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50)) {
    errors.push("options.limit должен быть целым числом от 1 до 50.");
  }

  if (options.sort !== undefined && options.sort !== "asc" && options.sort !== "desc") {
    errors.push("options.sort может быть только asc или desc.");
  }

  if (options.orientation !== undefined && options.orientation !== "vertical" && options.orientation !== "horizontal") {
    errors.push("options.orientation может быть vertical или horizontal.");
  }

  if (options.color !== undefined && (typeof options.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(options.color))) {
    errors.push("options.color должен быть цветом формата #RRGGBB.");
  }

  if (options.palette !== undefined && !isSupportedPalette(options.palette)) {
    errors.push("options.palette должен быть известной палитрой.");
  }

  rejectUnknownKeys(options, ["limit", "sort", "orientation", "color", "palette"], "options", errors);
}

function validateFilter(filter, errors) {
  if (filter === undefined) {
    return;
  }

  if (!isPlainRecord(filter)) {
    errors.push("filter должен быть объектом условий.");
    return;
  }

  for (const [field, condition] of Object.entries(filter)) {
    if (!isFieldName(field) || !isSafeFilterCondition(condition)) {
      errors.push("filter содержит неподдерживаемое поле или условие.");
      return;
    }
  }
}

function validateCategoryExclusions(value, errors) {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value) || value.length < 1 || value.length > 10 || value.some((name) => !isShortText(name, 120))) {
    errors.push("categoryExclusions должен содержать от 1 до 10 названий воронок.");
  }
}

function isSafeFilterCondition(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }

  if (!isPlainRecord(value)) {
    return false;
  }

  return Object.entries(value).every(([operator, operand]) => filterOperators.has(operator) && isSafeFilterOperand(operand));
}

function isSafeFilterOperand(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.length > 0 && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item)));
}

function isFieldName(value) {
  return typeof value === "string" && fieldNamePattern.test(value);
}

function isShortText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function rejectUnknownKeys(value, allowedKeys, label, errors) {
  if (!isPlainRecord(value)) {
    return;
  }

  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    errors.push(`${label} содержит неподдерживаемые свойства: ${unknown.join(", ")}.`);
  }
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
