export const dashboardCapabilities = Object.freeze({
  widgetTypes: Object.freeze(["kpi", "bar", "line", "pie", "donut", "table"]),
  palettes: Object.freeze({
    bitrix24: Object.freeze(["#2fc6f6", "#0057d9", "#00a2e8", "#30b47a", "#ff9f43", "#e85d75"])
  }),
  barOrientations: Object.freeze(["vertical", "horizontal"]),
  aggregateFunctions: Object.freeze(["count", "sum", "avg"]),
  periodPresets: Object.freeze(["all_time", "this_month", "this_quarter", "this_year"])
});

export function isSupportedWidgetType(value) {
  return dashboardCapabilities.widgetTypes.includes(value);
}

export function isSupportedPalette(value) {
  return typeof value === "string" && Object.hasOwn(dashboardCapabilities.palettes, value);
}

export function getPalette(name = "bitrix24") {
  return dashboardCapabilities.palettes[name] || dashboardCapabilities.palettes.bitrix24;
}

export function getCapabilityPrompt() {
  return [
    `Поддерживаемые типы виджетов: ${dashboardCapabilities.widgetTypes.join(", ")}.`,
    `Для bar доступны ориентации: ${dashboardCapabilities.barOrientations.join(", ")}.`,
    "KPI всегда показываются над графиками.",
    "Фирменная палитра: bitrix24. Для графика по менеджерам используй поле assignedById только после get_entity_fields.",
    "Вычисляемый KPI задаётся только как computed: { expr: 'kpi-id / kpi-id', format: 'percent' | 'number' }; произвольные формулы, код и поля CRM для него запрещены."
  ].join(" ");
}
