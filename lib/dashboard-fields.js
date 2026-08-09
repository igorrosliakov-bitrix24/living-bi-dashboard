export function extractFieldNames(payload) {
  const fields = payload?.data?.fields;

  return new Set(fields && typeof fields === "object" && !Array.isArray(fields) ? Object.keys(fields) : []);
}

export function validateDashboardFields(dashboard, fieldsByEntity) {
  const errors = [];

  for (const widget of dashboard.widgets || []) {
    const fields = fieldsByEntity.get(widget.entity);

    if (!fields) {
      errors.push(`Не удалось получить поля сущности «${widget.entity}».`);
      continue;
    }

    validateField(fields, widget.entity, dashboard.period?.field, "период дашборда", errors);
    validateField(fields, widget.entity, widget.period?.field, "период виджета", errors);

    for (const field of widget.groupBy || []) {
      validateField(fields, widget.entity, field, "группировка", errors);
    }

    if (widget.aggregate?.field) {
      validateField(fields, widget.entity, widget.aggregate.field, "агрегат", errors);
    }

    for (const field of Object.keys(widget.filter || {})) {
      validateField(fields, widget.entity, field, "фильтр", errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateField(fields, entity, field, purpose, errors) {
  if (field && !fields.has(field)) {
    errors.push(`Поле «${field}» для «${purpose}» отсутствует у сущности «${entity}».`);
  }
}
