import { readFile } from "node:fs/promises";
import { buildDatasetDraftFromSpec } from "../lib/dataset-spec.js";

const path = process.argv[2];
const input = path ? JSON.parse(await readFile(path, "utf8")) : {
  entity: "crm.deal", title: "Конверсия по менеджерам по неделям",
  dimensions: ["week", "manager"], metrics: ["total_deals", "won_deals", "conversion_percent"],
  period: "current_quarter", filters: { excludeCategoryNames: ["Тест"] },
  request: "Конверсия по менеджерам по неделям без тестовой воронки"
};
const draft = buildDatasetDraftFromSpec(input, { request: input.request });
process.stdout.write(`${JSON.stringify({ datasetName: draft.datasetName, title: draft.title, fields: draft.fields, formula: draft.formula, filters: draft.filters, sampleRows: draft.sampleRows }, null, 2)}\n`);
