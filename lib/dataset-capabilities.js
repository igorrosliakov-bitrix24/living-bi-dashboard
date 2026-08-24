export const datasetCapabilities = Object.freeze({
  entity: "crm.deal",
  dimensions: Object.freeze({
    week: Object.freeze({
      title: "Неделя",
      fields: Object.freeze([{ code: "WEEK_START", title: "Начало недели", type: "date" }])
    }),
    manager: Object.freeze({
      title: "Менеджер",
      fields: Object.freeze([
        { code: "MANAGER_ID", title: "ID менеджера", type: "integer" },
        { code: "MANAGER_NAME", title: "Менеджер", type: "string" }
      ])
    }),
    category: Object.freeze({
      title: "Воронка",
      fields: Object.freeze([
        { code: "CATEGORY_ID", title: "ID воронки", type: "integer" },
        { code: "CATEGORY_NAME", title: "Воронка", type: "string" }
      ])
    })
  }),
  metrics: Object.freeze({
    total_deals: Object.freeze({
      title: "Всего сделок",
      field: Object.freeze({ code: "TOTAL_DEALS", title: "Всего сделок", type: "integer" })
    }),
    won_deals: Object.freeze({
      title: "Выигранные сделки",
      field: Object.freeze({ code: "WON_DEALS", title: "Выигранные сделки", type: "integer" })
    }),
    conversion_percent: Object.freeze({
      title: "Конверсия, %",
      field: Object.freeze({ code: "CONVERSION_PERCENT", title: "Конверсия, %", type: "float" })
    })
  }),
  periods: Object.freeze({
    current_month: "Текущий месяц",
    current_quarter: "Текущий квартал",
    current_year: "Текущий год"
  })
});

export function getDatasetCapabilities() {
  return JSON.parse(JSON.stringify(datasetCapabilities));
}
