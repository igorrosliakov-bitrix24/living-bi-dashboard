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
