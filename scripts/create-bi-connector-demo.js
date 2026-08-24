import { createBitrixRestClient } from "../lib/bitrix-rest.js";
import { biConnectorDemo } from "../lib/bi-connector-demo.js";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

await loadEnv(new URL("../.env", import.meta.url));

const options = parseArguments(process.argv.slice(2));
if (!options.confirm) {
  throw new Error("Команда создаёт коннектор, источник и датасет. Повторите с --confirm.");
}

const connectorBaseUrl = normalizeConnectorBaseUrl(process.env.BI_CONNECTOR_BASE_URL);
const client = createBitrixRestClient({
  portalUrl: process.env.BITRIX24_PORTAL_URL,
  accessToken: process.env.BITRIX24_OAUTH_ACCESS_TOKEN,
  webhookUrl: process.env.BITRIX24_REST_WEBHOOK_URL
});
const suffix = Date.now().toString(36);
const title = `VibeCode BI API demo ${suffix}`;
const logo = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iOCIgZmlsbD0iIzE1NmZlZiIvPjx0ZXh0IHg9IjI0IiB5PSIzMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE4IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Qkk8L3RleHQ+PC9zdmc+";

let connectorId;
let sourceId;
let datasetId;

try {
  connectorId = getCreatedId(await client.call("biconnector.connector.add", {
    fields: {
      title,
      logo,
      description: "Временный коннектор для проверки API BI-конструктора. Скрипт удалит его автоматически.",
      urlCheck: `${connectorBaseUrl}/bi-connector/check`,
      urlTableList: `${connectorBaseUrl}/bi-connector/tables`,
      urlTableDescription: `${connectorBaseUrl}/bi-connector/table-description`,
      urlData: `${connectorBaseUrl}/bi-connector/data`,
      settings: []
    }
  }));
  console.log(`Коннектор создан: id=${connectorId}.`);

  sourceId = getCreatedId(await client.call("biconnector.source.add", {
    fields: {
      title: `${title} source`,
      description: "Временный источник VibeCode BI API demo.",
      connectorId,
      settings: {}
    }
  }));
  console.log(`Источник создан: id=${sourceId}.`);

  datasetId = getCreatedId(await client.call("biconnector.dataset.add", {
    fields: {
      sourceId,
      name: `vibecode_bi_demo_${suffix}`,
      externalName: biConnectorDemo.table.title,
      externalCode: biConnectorDemo.table.code,
      description: "Временный датасет для проверки REST API BI-конструктора.",
      fields: biConnectorDemo.fields.map((field) => ({ type: field.type, name: field.code, externalCode: field.code }))
    }
  }));
  console.log(`Датасет создан: id=${datasetId}.`);
  console.log(`Откройте BI-конструктор: объекты будут доступны ещё ${options.holdSeconds} с.`);
  await delay(options.holdSeconds * 1_000);
} finally {
  await remove("biconnector.dataset.delete", datasetId, "Датасет");
  await remove("biconnector.source.delete", sourceId, "Источник");
  await remove("biconnector.connector.delete", connectorId, "Коннектор");
}

async function remove(method, id, label) {
  if (!id) {
    return;
  }
  await client.call(method, { id });
  console.log(`${label} id=${id} удалён.`);
}

function getCreatedId(result) {
  const id = typeof result === "object" && result !== null ? result.id : result;
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
    throw new Error("Bitrix24 не вернул идентификатор созданного объекта.");
  }
  return Number(id);
}

function normalizeConnectorBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Добавьте BI_CONNECTOR_BASE_URL в .env. Это публичный HTTPS-адрес callback-сервера BI-коннектора.");
  }
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BI_CONNECTOR_BASE_URL должен быть публичным HTTPS-адресом без пути и параметров.");
  }
  if (url.hostname.endsWith(".vibecode.bitrix24.tech")) {
    throw new Error("Galaxy Black Hole закрывает этот адрес авторизацией. Для callback BI-коннектора нужен отдельный публичный HTTPS-адрес, доступный Битрикс24 без Gateway.");
  }
  return url.toString().replace(/\/$/, "");
}

function parseArguments(args) {
  const holdArgument = args.find((argument) => argument.startsWith("--hold-seconds="));
  const holdSeconds = holdArgument ? Number(holdArgument.slice("--hold-seconds=".length)) : 120;
  if (!Number.isInteger(holdSeconds) || holdSeconds < 30 || holdSeconds > 300) {
    throw new Error("--hold-seconds должен быть целым числом от 30 до 300.");
  }
  return { confirm: args.includes("--confirm"), holdSeconds };
}

async function loadEnv(url) {
  try {
    const source = await readFile(url, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // The client produces the actionable missing-key message below.
  }
}
