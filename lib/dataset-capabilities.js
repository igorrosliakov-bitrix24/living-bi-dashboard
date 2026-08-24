// Единственный источник правды о том, что умеет публикатор. Каждая запись
// описывает и объявление, и поведение: планировщик строит из каталога промпт
// и схему инструмента, движок — группировку и расчёт. Чтобы добавить метрику
// или измерение, правится только этот файл.

const round = (value) => Math.round(value * 100) / 100;

export const datasetCapabilities = Object.freeze({
  entity: "crm.deal",

  dimensions: Object.freeze({
    week: Object.freeze({
      title: "Неделя",
      fields: Object.freeze([{ code: "WEEK_START", title: "Начало недели", type: "date" }]),
      resolve: (deal, { mondayOf }) => {
        const value = mondayOf(deal.BEGINDATE || deal.DATE_CREATE);
        return value ? { key: value, cells: { WEEK_START: value } } : null;
      }
    }),
    manager: Object.freeze({
      title: "Менеджер",
      fields: Object.freeze([
        { code: "MANAGER_ID", title: "ID менеджера", type: "integer" },
        { code: "MANAGER_NAME", title: "Менеджер", type: "string" }
      ]),
      resolve: (deal, { users }) => {
        const id = Number(deal.ASSIGNED_BY_ID);
        if (!Number.isInteger(id) || id <= 0) return null;
        return { key: id, cells: { MANAGER_ID: id, MANAGER_NAME: users.get(String(id)) || `Менеджер ${id}` } };
      }
    }),
    category: Object.freeze({
      title: "Воронка",
      fields: Object.freeze([
        { code: "CATEGORY_ID", title: "ID воронки", type: "integer" },
        { code: "CATEGORY_NAME", title: "Воронка", type: "string" }
      ]),
      resolve: (deal, { categories }) => {
        const id = Number(deal.CATEGORY_ID ?? 0);
        if (!Number.isInteger(id) || id < 0) return null;
        return { key: id, cells: { CATEGORY_ID: id, CATEGORY_NAME: categories.get(String(id)) || `Воронка ${id}` } };
      }
    })
  }),

  metrics: Object.freeze({
    total_deals: Object.freeze({
      title: "Всего сделок",
      field: Object.freeze({ code: "TOTAL_DEALS", title: "Всего сделок", type: "integer" }),
      formula: "TOTAL_DEALS — количество подходящих сделок",
      compute: ({ total }) => total
    }),
    won_deals: Object.freeze({
      title: "Выигранные сделки",
      field: Object.freeze({ code: "WON_DEALS", title: "Выигранные сделки", type: "integer" }),
      formula: "WON_DEALS — сделки со STAGE_SEMANTIC_ID = S",
      compute: ({ won }) => won
    }),
    conversion_percent: Object.freeze({
      title: "Конверсия, %",
      field: Object.freeze({ code: "CONVERSION_PERCENT", title: "Конверсия, %", type: "float" }),
      formula: "CONVERSION_PERCENT = WON_DEALS / TOTAL_DEALS × 100",
      compute: ({ total, won }) => (total ? round(100 * won / total) : 0)
    })
  }),

  periods: Object.freeze({
    current_month: Object.freeze({ title: "Текущий месяц", startMonth: (month) => month, months: 1 }),
    current_quarter: Object.freeze({ title: "Текущий квартал", startMonth: (month) => Math.floor(month / 3) * 3, months: 3 }),
    current_year: Object.freeze({ title: "Текущий год", startMonth: () => 0, months: 12 })
  })
});

export const dimensionKeys = Object.freeze(Object.keys(datasetCapabilities.dimensions));
export const metricKeys = Object.freeze(Object.keys(datasetCapabilities.metrics));
export const periodKeys = Object.freeze(Object.keys(datasetCapabilities.periods));

export function periodTitles() {
  return Object.fromEntries(periodKeys.map((key) => [key, datasetCapabilities.periods[key].title]));
}

// Сериализуемый срез каталога: только то, что можно отдать наружу.
export function getDatasetCapabilities() {
  return {
    entity: datasetCapabilities.entity,
    dimensions: Object.fromEntries(dimensionKeys.map((key) => [key, {
      title: datasetCapabilities.dimensions[key].title,
      fields: datasetCapabilities.dimensions[key].fields.map((field) => ({ ...field }))
    }])),
    metrics: Object.fromEntries(metricKeys.map((key) => [key, {
      title: datasetCapabilities.metrics[key].title,
      field: { ...datasetCapabilities.metrics[key].field },
      formula: datasetCapabilities.metrics[key].formula
    }])),
    periods: periodTitles()
  };
}
