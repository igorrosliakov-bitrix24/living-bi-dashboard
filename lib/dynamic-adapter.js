const connectorTypes = new Map([["integer", "int"], ["string", "string"], ["float", "double"], ["date", "date"], ["datetime", "datetime"]]);

export function mergeDynamicTables(staticTables, records, searchString = "") {
  const dynamic = records.filter((item) => item.status === "active" || item.status === "pending").map((item) => ({ code: item.datasetName, title: item.title }));
  const unique = new Map([...staticTables, ...dynamic].map((item) => [item.code, item]));
  const query = String(searchString).trim().toLocaleLowerCase("ru");
  return [...unique.values()].filter((item) => !query || item.code.includes(query) || item.title.toLocaleLowerCase("ru").includes(query));
}

export function getDynamicDescription(record) {
  if (!record || !["active", "pending"].includes(record.status)) return [];
  return record.fields.map((field) => ({ code: field.code, name: field.title, type: connectorTypes.get(field.type) }));
}

// Неизвестная или неработающая таблица не должна выглядеть как пустая:
// BI-конструктор покажет пустой график вместо ошибки, и причину не найти.
export function resolveTableAvailability(table, record, staticTableCodes = []) {
  if (typeof table !== "string" || !table.trim()) {
    return { available: false, code: "table_not_specified", message: "Битрикс24 не передал имя таблицы." };
  }
  if (staticTableCodes.includes(table)) return { available: true, kind: "static" };
  if (!record) {
    return { available: false, code: "unknown_table", message: `Таблица ${table} не обслуживается этим адаптером.` };
  }
  if (!["active", "pending"].includes(record.status)) {
    return { available: false, code: "dataset_not_available", message: `Набор ${table} есть в реестре, но не обслуживается: состояние ${record.status}.` };
  }
  return { available: true, kind: "dynamic" };
}
