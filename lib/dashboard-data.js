const aggregateFunctionMap = {
  avg: "avg",
  count: "count",
  sum: "sum"
};

export function buildAggregateRequest(widget) {
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

  return request;
}

export function normalizeWidgetData(widget, payload) {
  const data = payload?.data || {};
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const groupField = Array.isArray(widget.groupBy) ? widget.groupBy[0] : undefined;

  return {
    id: widget.id,
    type: widget.type,
    title: widget.title,
    value: getAggregateValue(widget, data),
    groups: groupField
      ? groups.map((group) => ({ label: String(group[groupField] ?? "Не указано"), value: getAggregateValue(widget, group) }))
      : [],
    truncated: data.meta?.truncated === true
  };
}

function getAggregateValue(widget, data) {
  if (widget.aggregate.fn === "count") {
    return typeof data.count === "number" ? data.count : 0;
  }

  const value = data.aggregates?.[widget.aggregate.field]?.[widget.aggregate.fn];
  return typeof value === "number" ? value : 0;
}
