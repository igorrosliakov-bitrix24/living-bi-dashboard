import { readFile } from "node:fs/promises";
import { createBitrixRestClient } from "../lib/bitrix-rest.js";
import { dealIntakeFields, dealIntakeTable } from "../lib/deal-intake-dataset.js";
import { getValidOauthState } from "../lib/oauth-state.js";

await loadEnv(new URL("../.env", import.meta.url));

if (!process.argv.includes("--confirm")) {
  throw new Error("Команда создаёт постоянный BI-датасет. Повторите с --confirm после проверки preview.");
}

const statePath = process.env.OAUTH_ADAPTER_STATE_PATH || "/tmp/living-bi-chepyuk-auth.json";
const connectorBaseUrl = normalizeConnectorBaseUrl(process.env.BI_CONNECTOR_BASE_URL);
const auth = await getValidOauthState({
  statePath,
  clientId: process.env.BITRIX24_OAUTH_CLIENT_ID,
  clientSecret: process.env.BITRIX24_OAUTH_CLIENT_SECRET
});
const client = createBitrixRestClient({
  portalUrl: `https://${auth.domain}`,
  accessToken: auth.accessToken
});
const connectorTitle = "VibeCode AI Dataset Connector";
const sourceTitle = "VibeCode AI Dataset Source";
const logo = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iOCIgZmlsbD0iIzE1NmZlZiIvPjx0ZXh0IHg9IjI0IiB5PSIzMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE4IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Qkk8L3RleHQ+PC9zdmc+";

const datasets = normalizeList(await client.call("biconnector.dataset.list", {
  select: ["id", "name", "externalName", "externalCode", "sourceId"]
}));
const existingDataset = datasets.find((item) => item.name === dealIntakeTable.code);
if (existingDataset) {
  console.log(`Датасет уже существует: id=${existingDataset.id}, name=${existingDataset.name}. Изменения не вносились.`);
  process.exit(0);
}

const connectorId = await findOrCreateConnector();
const sourceId = await findOrCreateSource(connectorId);
const datasetId = getCreatedId(await client.call("biconnector.dataset.add", {
  fields: {
    sourceId,
    name: dealIntakeTable.code,
    externalName: dealIntakeTable.title,
    externalCode: dealIntakeTable.code,
    description: "Новые сделки по менеджерам и неделям за текущий квартал. Тестовые воронки и повторные сделки исключены.",
    fields: dealIntakeFields.map((field) => ({
      type: field.type,
      name: field.code,
      externalCode: field.code
    }))
  }
}));

console.log(`Датасет опубликован: id=${datasetId}, name=${dealIntakeTable.code}.`);
console.log("Следующий шаг: откройте BI-конструктор → Рабочее место аналитика → Таблицы и найдите vibecode_ai_deal_intake_weekly.");

async function findOrCreateConnector() {
  const connectors = normalizeList(await client.call("biconnector.connector.list", {
    select: ["id", "title"]
  }));
  const existing = connectors.find((item) => item.title === connectorTitle);
  if (existing) return getCreatedId(existing.id);

  return getCreatedId(await client.call("biconnector.connector.add", {
    fields: {
      title: connectorTitle,
      logo,
      description: "Коннектор расчётных датасетов VibeCode AI.",
      urlCheck: `${connectorBaseUrl}/bi-connector/check`,
      urlTableList: `${connectorBaseUrl}/bi-connector/tables`,
      urlTableDescription: `${connectorBaseUrl}/bi-connector/table-description`,
      urlData: `${connectorBaseUrl}/bi-connector/data`,
      settings: []
    }
  }));
}

async function findOrCreateSource(connectorId) {
  const sources = normalizeList(await client.call("biconnector.source.list", {
    select: ["id", "title", "connectorId"]
  }));
  const existing = sources.find((item) => item.title === sourceTitle
    && Number(item.connectorId) === Number(connectorId));
  if (existing) return getCreatedId(existing.id);

  return getCreatedId(await client.call("biconnector.source.add", {
    fields: {
      title: sourceTitle,
      description: "Источник проверенных расчётных наборов для BI-конструктора.",
      connectorId,
      settings: {}
    }
  }));
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function getCreatedId(result) {
  const id = typeof result === "object" && result !== null ? result.id : result;
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
    throw new Error("Bitrix24 не вернул идентификатор объекта.");
  }
  return Number(id);
}

function normalizeConnectorBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Добавьте BI_CONNECTOR_BASE_URL: публичный HTTPS-адрес adapter-сервиса.");
  }
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BI_CONNECTOR_BASE_URL должен быть HTTPS-адресом без пути и параметров.");
  }
  return url.toString().replace(/\/$/, "");
}

async function loadEnv(url) {
  try {
    const source = await readFile(url, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // Missing values are reported by the helpers above.
  }
}
