import { createBitrixRestClient } from "../lib/bitrix-rest.js";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

await loadEnv(new URL("../.env", import.meta.url));

const options = parseArguments(process.argv.slice(2));
const client = createBitrixRestClient({
  portalUrl: process.env.BITRIX24_PORTAL_URL,
  accessToken: process.env.BITRIX24_OAUTH_ACCESS_TOKEN,
  webhookUrl: process.env.BITRIX24_REST_WEBHOOK_URL
});

const [datasets, sources] = await Promise.all([
  client.call("biconnector.dataset.list", { select: ["id", "name", "externalName", "sourceId"] }),
  client.call("biconnector.source.list", { select: ["id", "title", "connectorId"] })
]);

printList("Датасеты", datasets);
printList("Источники", sources);

if (!options.confirm) {
  console.log("Проверка чтения завершена. Для теста создания укажите --source-id=<ID> --confirm.");
  process.exit(0);
}

if (!options.sourceId) {
  throw new Error("Для создания тестового датасета укажите --source-id=<ID> --confirm.");
}

const source = Array.isArray(sources) ? sources.find((item) => Number(item.id) === options.sourceId) : null;
if (!source) {
  throw new Error(`Источник с id ${options.sourceId} не найден. Выберите id из списка выше.`);
}

const suffix = Date.now().toString(36);
const fields = {
  sourceId: options.sourceId,
  name: `vibecode_demo_${suffix}`,
  externalName: `VibeCode Demo ${suffix}`,
  externalCode: `vibecode_demo_${suffix}`,
  description: "Временный датасет для проверки API; скрипт удалит его автоматически.",
  fields: [
    { type: "int", name: "ID", externalCode: "ID" },
    { type: "string", name: "TITLE", externalCode: "TITLE" }
  ]
};

let datasetId;
try {
  datasetId = getCreatedId(await client.call("biconnector.dataset.add", { fields }));
  const dataset = await client.call("biconnector.dataset.get", { id: datasetId });
  console.log(`Тестовый датасет создан и прочитан: id=${dataset.item?.id ?? datasetId}, name=${dataset.item?.name ?? fields.name}.`);
  if (options.holdSeconds > 0) {
    console.log(`Откройте BI-конструктор: источник и датасет будут видны ещё ${options.holdSeconds} с.`);
    await delay(options.holdSeconds * 1_000);
  }
} finally {
  if (datasetId) {
    await client.call("biconnector.dataset.delete", { id: datasetId });
    console.log(`Тестовый датасет id=${datasetId} удалён.`);
  }
}

function getCreatedId(result) {
  const id = typeof result === "object" && result !== null ? result.id : result;
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
    throw new Error("Bitrix24 не вернул идентификатор созданного объекта.");
  }
  return Number(id);
}

function parseArguments(args) {
  const sourceArgument = args.find((argument) => argument.startsWith("--source-id="));
  const holdArgument = args.find((argument) => argument.startsWith("--hold-seconds="));
  const sourceId = sourceArgument ? Number(sourceArgument.slice("--source-id=".length)) : null;
  const holdSeconds = holdArgument ? Number(holdArgument.slice("--hold-seconds=".length)) : 60;

  if (sourceArgument && (!Number.isInteger(sourceId) || sourceId <= 0)) {
    throw new Error("--source-id должен быть положительным целым числом.");
  }
  if (!Number.isInteger(holdSeconds) || holdSeconds < 0 || holdSeconds > 300) {
    throw new Error("--hold-seconds должен быть целым числом от 0 до 300.");
  }

  return {
    confirm: args.includes("--confirm"),
    holdSeconds,
    sourceId
  };
}

function printList(title, items) {
  const list = Array.isArray(items) ? items : [];
  console.log(`${title}: ${list.length}`);
  for (const item of list) {
    const name = item.title || item.name || item.externalName || "Без названия";
    console.log(`- id=${item.id}; ${name}`);
  }
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
