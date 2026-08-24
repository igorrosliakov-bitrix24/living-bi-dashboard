import { dealIntakeFields, dealIntakeTable } from "./deal-intake-dataset.js";

const demoTable = {
  code: "vibecode_bi_demo",
  title: "VibeCode BI Demo"
};

const demoFields = [
  { code: "ID", name: "ID", type: "int" },
  { code: "TITLE", name: "Название", type: "string" },
  { code: "AMOUNT", name: "Сумма", type: "double" },
  { code: "CREATED_AT", name: "Дата", type: "date" }
];

const demoRows = [
  [1, "Демонстрационная сделка A", 120000, "2026-08-01"],
  [2, "Демонстрационная сделка B", 86000, "2026-08-02"],
  [3, "Демонстрационная сделка C", 45000, "2026-08-03"]
];

export function getBiConnectorTables(searchString = "") {
  const query = String(searchString).trim().toLowerCase();
  return [demoTable, dealIntakeTable].filter((table) => !query
    || table.code.includes(query)
    || table.title.toLowerCase().includes(query));
}

export function getBiConnectorDescription(table) {
  if (table === demoTable.code) return demoFields;
  if (table === dealIntakeTable.code) return dealIntakeFields;
  return [];
}

export function getBiConnectorData({ table, select, limit }) {
  if (table !== demoTable.code) {
    return [];
  }

  const requested = Array.isArray(select) && select.length > 0
    ? select.filter((field) => demoFields.some((item) => item.code === field))
    : demoFields.map((field) => field.code);
  const indexes = requested.map((field) => demoFields.findIndex((item) => item.code === field));
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, demoRows.length) : demoRows.length;

  return [requested, ...demoRows.slice(0, safeLimit).map((row) => indexes.map((index) => row[index]))];
}

export const biConnectorDemo = { table: demoTable, fields: demoFields };
