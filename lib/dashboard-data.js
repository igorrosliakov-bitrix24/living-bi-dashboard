import { getPalette } from "./dashboard-capabilities.js";
import { parseComputedExpression } from "./dashboard-spec.js";

const aggregateFunctionMap = {
  avg: "avg",
  count: "count",
  sum: "sum"
};

export function buildAggregateRequest(widget, dashboardPeriod, now = new Date()) {
  const aggregate = widget.aggregate;
  const request = {
    aggregate: [{
      field: aggregate.fn === "count" ? "*" : aggregate.field,
      function: aggregateFunctionMap[aggregate.fn]
    }]
  };

  if (Array.isArray(widget.groupBy) && widget.groupBy.length > 0) {
    request.groupBy = widget.groupBy;
  }

  const period = widget.period || dashboardPeriod;
  const periodFilter = buildPeriodFilter(period, now);
  const filter = { ...(widget.filter || {}), ...periodFilter };

  if (Object.keys(filter).length > 0) {
    request.filter = filter;
  }

  return request;
}

export function buildPeriodFilter(period, now = new Date()) {
  if (!period?.field || !period?.preset) {
    return {};
  }

  const start = new Date(now);
  const end = new Date(now);

  if (period.preset === "this_month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(end.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 0);
  } else if (period.preset === "this_quarter") {
    start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(Math.floor(end.getMonth() / 3) * 3 + 3, 0);
    end.setHours(23, 59, 59, 0);
  } else if (period.preset === "this_year") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 0);
  } else {
    return {};
  }

  return {
    [period.field]: {
      "$gte": formatPortalDate(start),
      "$lte": formatPortalDate(end)
    }
  };
}

export function normalizeWidgetData(widget, payload, labelMaps = {}) {
  const data = payload?.data || {};
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const groupField = Array.isArray(widget.groupBy) ? widget.groupBy[0] : undefined;

  const normalizedGroups = groupField
    ? groups.map((group) => ({ label: getGroupLabel(groupField, group[groupField], labelMaps), value: getAggregateValue(widget, group) }))
    : [];
  const sortedGroups = sortGroups(normalizedGroups, widget.options?.sort);
  const limitedGroups = Number.isInteger(widget.options?.limit)
    ? sortedGroups.slice(0, widget.options.limit)
    : sortedGroups;

  return {
    id: widget.id,
    type: widget.type,
    title: widget.title,
    value: getAggregateValue(widget, data),
    groups: limitedGroups,
    options: structuredClone(widget.options || {}),
    colors: widget.options?.color ? [widget.options.color] : getPalette(widget.options?.palette),
    truncated: data.meta?.truncated === true
  };
}

export function calculateComputedWidget(widget, widgetsById) {
  const references = parseComputedExpression(widget.computed?.expr);
  const numerator = references ? widgetsById.get(references[0])?.value : undefined;
  const denominator = references ? widgetsById.get(references[1])?.value : undefined;
  const value = typeof numerator === "number" && typeof denominator === "number" && denominator !== 0
    ? numerator / denominator
    : 0;

  return {
    id: widget.id,
    type: widget.type,
    title: widget.title,
    value,
    format: widget.computed?.format || "number",
    groups: [],
    options: {},
    colors: [],
    truncated: false
  };
}

function getGroupLabel(field, value, labelMaps) {
  if (value === undefined || value === null || value === "") {
    return "Не указано";
  }

  return labelMaps[field]?.[String(value)] || String(value);
}

function sortGroups(groups, direction) {
  if (direction !== "asc" && direction !== "desc") {
    return groups;
  }

  const multiplier = direction === "asc" ? 1 : -1;

  return [...groups].sort((left, right) => {
    const valueDifference = (left.value - right.value) * multiplier;
    return valueDifference || left.label.localeCompare(right.label, "ru");
  });
}

function getAggregateValue(widget, data) {
  if (widget.aggregate.fn === "count") {
    return typeof data.count === "number" ? data.count : 0;
  }

  const value = data.aggregates?.[widget.aggregate.field]?.[widget.aggregate.fn];
  return typeof value === "number" ? value : 0;
}

function formatPortalDate(date) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
