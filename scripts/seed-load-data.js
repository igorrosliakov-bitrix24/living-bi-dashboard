import { existsSync, readFileSync } from "node:fs";
import { createLoadSeedPlan, parseLoadSeedOptions } from "../lib/load-seed.js";
import { hasExistingDemoRecords, listExistingDemoEntities } from "../lib/demo-seed.js";

loadEnv(new URL("../.env", import.meta.url));

const apiBase = process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech";
const apiKey = process.env.VIBECODE_API_KEY;

if (!apiKey) {
  throw new Error("Добавьте VIBECODE_API_KEY в .env перед запуском нагрузочного seed.");
}

const options = parseLoadSeedOptions(process.argv.slice(2));

if (!options.confirmed) {
  throw new Error("Нагрузочный seed создаёт записи в портале. Повторите команду с --confirm.");
}

const plan = createLoadSeedPlan(options);
const existing = await batch(plan.existingCalls);

if (hasExistingDemoRecords(existing.results)) {
  const entities = listExistingDemoEntities(existing.results).join(", ");
  throw new Error(`${plan.namespace} уже содержит данные (${entities}). Скрипт остановлен, чтобы не создавать дубликаты.`);
}

const companies = await batch(plan.companyCalls);
ensureSucceeded(companies, "компаний");

const managerIds = options.managerIds.length > 0 ? options.managerIds : [await getOwnerId()];
const deals = plan.createDeals(companies.results);

for (const calls of chunk(deals, 50)) {
  const result = await batch(calls);
  ensureSucceeded(result, "сделок");
}

console.log(`Нагрузочные данные ${plan.namespace} готовы: ${options.dealCount} сделок, 3 компании, менеджеров: ${managerIds.join(", ")}.`);

async function batch(calls) {
  const response = await fetch(`${apiBase}/v1/batch`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ calls })
  });
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message || "Batch API не выполнил запрос.");
  }

  return payload.data;
}

async function getOwnerId() {
  const response = await fetch(`${apiBase}/v1/me`, {
    headers: { "X-Api-Key": apiKey, "Accept": "application/json" }
  });
  const payload = await response.json();
  const id = Number(payload.data?.owner?.userId);

  if (!response.ok || !Number.isInteger(id)) {
    throw new Error("Не удалось определить владельца портала для нагрузочных сделок.");
  }

  return id;
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function ensureSucceeded(result, label) {
  if (result.summary?.failed > 0) {
    const errors = Object.values(result.errors || {}).map((error) => error.message).join("; ");
    throw new Error(`Не удалось создать часть ${label}: ${errors || "неизвестная ошибка"}`);
  }
}

function loadEnv(url) {
  const path = url.pathname;

  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");

    if (!trimmed || trimmed.startsWith("#") || separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
