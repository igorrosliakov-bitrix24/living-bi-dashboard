const dashboardEntities = {
  activities: "Активности",
  companies: "Компании",
  deals: "Сделки",
  tasks: "Задачи"
};

export function listDashboardEntities(entities) {
  if (!Array.isArray(entities)) {
    return [];
  }

  return entities
    .map((entity) => entity?.name)
    .filter((name) => typeof name === "string" && dashboardEntities[name])
    .map((name) => ({ code: name, title: dashboardEntities[name] }));
}

export function isDashboardEntity(value) {
  return typeof value === "string" && Boolean(dashboardEntities[value]);
}
