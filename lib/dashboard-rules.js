export function resolveCategoryExclusions(widget, categories) {
  const requestedNames = Array.isArray(widget.categoryExclusions) ? widget.categoryExclusions : [];
  const normalizedNames = requestedNames.map(normalizeName).filter(Boolean);

  if (widget.entity !== "deals" || normalizedNames.length === 0) {
    return { widget, warnings: [] };
  }

  const matched = (Array.isArray(categories) ? categories : []).filter((category) => {
    const name = normalizeName(category?.name || category?.title);
    return name && normalizedNames.includes(name);
  });
  const ids = [...new Set(matched.map((category) => Number(category?.id)).filter(Number.isInteger))];
  const unresolved = requestedNames.filter((name) => !matched.some((category) => normalizeName(category?.name || category?.title) === normalizeName(name)));
  const filter = { ...(widget.filter || {}) };

  if (ids.length > 0) {
    filter.categoryId = mergeNotInFilter(filter.categoryId, ids);
  }

  return {
    widget: { ...widget, filter },
    warnings: unresolved.map((name) => `Воронка «${name}» пока не найдена на портале; исключение начнёт действовать после её появления.`)
  };
}

function mergeNotInFilter(existing, ids) {
  if (existing && typeof existing === "object" && Array.isArray(existing.$nin)) {
    return { ...existing, $nin: [...new Set([...existing.$nin, ...ids])] };
  }

  return { $nin: ids };
}

function normalizeName(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("ru-RU") : "";
}
