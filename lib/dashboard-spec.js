import { isDashboardEntity } from "./entities.js";

const widgetTypes = new Set(["bar", "kpi", "line", "table"]);
const aggregateFunctions = new Set(["count", "sum", "avg"]);
const periodPresets = new Set(["this_month", "this_quarter", "this_year"]);
const fieldNamePattern = /^[a-z][a-zA-Z0-9]*$/;

export function createInitialDashboard() {
  return {
    version: 1,
    title: "Продажи: обзор",
    period: { field: "closeDate", preset: "this_quarter" },
    widgets: [
      {
        id: "deals-by-stage",
        type: "bar",
        title: "Сделки по стадиям",
        entity: "deals",
        groupBy: ["stageId"],
        aggregate: { fn: "count" },
        options: { sort: "desc", limit: 10 }
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

  if (!isRecord(spec)) {
    return { valid: false, errors: ["Спека должна быть объектом."] };
  }

  if (!Number.isInteger(spec.version) || spec.version < 1) {
    errors.push("version должен быть положительным целым числом.");
  }

  if (!isShortText(spec.title, 120)) {
    errors.push("title должен быть непустой строкой до 120 символов.");
  }

  validatePeriod(spec.period, errors);

  if (!Array.isArray(spec.widgets) || spec.widgets.length < 1 || spec.widgets.length > 12) {
    errors.push("widgets должен содержать от 1 до 12 виджетов.");
  } else {
    const ids = new Set();

    for (const widget of spec.widgets) {
      validateWidget(widget, ids, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

function validatePeriod(period, errors) {
  if (!isRecord(period) || !isFieldName(period.field) || !periodPresets.has(period.preset)) {
    errors.push("period должен содержать поле и допустимый период.");
  }
}

function validateWidget(widget, ids, errors) {
  if (!isRecord(widget)) {
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

  if (!widgetTypes.has(widget.type)) {
    errors.push("Указан неподдерживаемый тип виджета.");
  }

  if (!isShortText(widget.title, 120)) {
    errors.push("title виджета должен быть непустой строкой до 120 символов.");
  }

  if (!isDashboardEntity(widget.entity)) {
    errors.push("Виджет использует неподдерживаемую сущность.");
  }

  if (widget.groupBy !== undefined && (!Array.isArray(widget.groupBy) || widget.groupBy.some((field) => !isFieldName(field)))) {
    errors.push("groupBy может содержать только безопасные имена полей.");
  }

  validateAggregate(widget.aggregate, errors);
  validateOptions(widget.options, errors);
}

function validateAggregate(aggregate, errors) {
  if (!isRecord(aggregate) || !aggregateFunctions.has(aggregate.fn)) {
    errors.push("aggregate должен содержать поддерживаемую функцию.");
    return;
  }

  if (aggregate.fn === "count" && aggregate.field !== undefined) {
    errors.push("Для count поле aggregate.field не указывается.");
  }

  if (aggregate.fn !== "count" && !isFieldName(aggregate.field)) {
    errors.push("Для sum и avg нужно безопасное имя поля.");
  }
}

function validateOptions(options, errors) {
  if (options === undefined) {
    return;
  }

  if (!isRecord(options)) {
    errors.push("options должен быть объектом.");
    return;
  }

  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50)) {
    errors.push("options.limit должен быть целым числом от 1 до 50.");
  }

  if (options.sort !== undefined && options.sort !== "asc" && options.sort !== "desc") {
    errors.push("options.sort может быть только asc или desc.");
  }
}

function isFieldName(value) {
  return typeof value === "string" && fieldNamePattern.test(value);
}

function isShortText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
