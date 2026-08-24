import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createDateSpreadCalls, createIntakeRepairCalls, createIntakeSeedPlan, intakeSeedNamespace, parseIntakeSeedOptions } from "../lib/intake-seed.js";
import { hasExistingDemoRecords, listExistingDemoEntities } from "../lib/demo-seed.js";

loadEnv(new URL("../.env", import.meta.url));

const apiBase = process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech";
const apiKey = process.env.VIBECODE_API_KEY;
const maxRepairDeals = 5_000;

if (!apiKey) {
  throw new Error("Добавьте VIBECODE_API_KEY в .env перед запуском seed новых сделок.");
}

const options = parseIntakeSeedOptions(process.argv.slice(2));

if (!options.confirmed) {
  throw new Error("Seed создаёт записи в портале. Повторите команду с --confirm.");
}

const plan = createIntakeSeedPlan(options);

if (options.spread) {
  const ids = await listDealIds(options.namespace);

  if (ids.length === 0) {
    console.log(`В ${options.namespace} нет сделок. Раскладывать нечего.`);
    process.exit(0);
  }

  const spreadBatches = chunk(createDateSpreadCalls(ids, { weeks: options.weeks }), 50);

  for (const [index, calls] of spreadBatches.entries()) {
    const result = await batch(calls);
    ensureSucceeded(result, "сделок");
    console.log(`Раскладка ${index + 1} из ${spreadBatches.length}: обновлено ${calls.length} сделок.`);

    if (index < spreadBatches.length - 1) {
      await delay(150);
    }
  }

  console.log(`Готово: у ${ids.length} сделок ${options.namespace} даты начала разложены по ${options.weeks} неделям текущего квартала.`);
  process.exit(0);
}

if (options.repair) {
  const returningIds = await listReturningDealIds();

  if (returningIds.length === 0) {
    console.log(`В ${intakeSeedNamespace} нет сделок с признаком «повторная». Чинить нечего.`);
    process.exit(0);
  }

  const repairBatches = chunk(createIntakeRepairCalls(returningIds), 50);

  for (const [index, calls] of repairBatches.entries()) {
    const result = await batch(calls);
    ensureSucceeded(result, "сделок");
    console.log(`Починка ${index + 1} из ${repairBatches.length}: обновлено ${calls.length} сделок.`);

    if (index < repairBatches.length - 1) {
      await delay(150);
    }
  }

  console.log(`Готово: у ${returningIds.length} сделок снят клиент и признак повторной. Битрикс24 пересчитывает признак фоново, проверьте через минуту.`);
  process.exit(0);
}

const existing = await batch(plan.existingCalls);
const existingDealCount = await countExistingDeals();

if (hasExistingDemoRecords(existing.results) && !options.resume) {
  const entities = listExistingDemoEntities(existing.results).join(", ");
  throw new Error(`${plan.namespace} уже содержит данные (${entities}). Для безопасного продолжения используйте --resume вместе с --confirm.`);
}

if (existingDealCount >= options.dealCount) {
  console.log(`В ${plan.namespace} уже ${existingDealCount} сделок при запрошенных ${options.dealCount}. Создавать нечего.`);
  process.exit(0);
}

const companies = hasExistingDemoRecords(existing.results)
  ? { results: await getExistingCompanies() }
  : await batch(plan.companyCalls);
ensureSucceeded(companies, "компаний");

const pendingDealCount = options.dealCount - existingDealCount;
const resumePlan = createIntakeSeedPlan({ ...options, dealCount: pendingDealCount, startIndex: existingDealCount });
const deals = resumePlan.createDeals(companies.results);
const batches = chunk(deals, 50);

for (const [index, calls] of batches.entries()) {
  const result = await batch(calls);
  ensureSucceeded(result, "сделок");
  console.log(`Пакет ${index + 1} из ${batches.length}: создано ${calls.length} сделок.`);

  if (index < batches.length - 1) {
    await delay(150);
  }
}

console.log(`Набор ${plan.namespace} готов: ${pendingDealCount} новых сделок, недель: ${options.weeks}, менеджеров: ${options.managerIds.join(", ")}.`);
console.log("Все сделки созданы с признаком «повторная: нет», поэтому попадают в расчётный датасет новых сделок.");

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

async function listDealIds(namespace, extraFilter = {}) {
  const ids = [];
  let offset = 0;

  while (offset < maxRepairDeals) {
    const url = new URL(`${apiBase}/v1/deals`);
    url.searchParams.set("filter[title][$contains]", namespace);
    for (const [key, value] of Object.entries(extraFilter)) url.searchParams.set(key, String(value));
    url.searchParams.set("limit", "50");
    url.searchParams.set("offset", String(offset));
    url.searchParams.append("select[]", "id");
    const response = await fetch(url, { headers: { "X-Api-Key": apiKey, "Accept": "application/json" } });
    const payload = await response.json();
    const page = Array.isArray(payload.data) ? payload.data : [];

    if (!response.ok) {
      throw new Error(payload.error?.message || "Не удалось получить список сделок.");
    }

    if (page.length === 0) {
      break;
    }

    ids.push(...page.map((deal) => deal.id));
    offset += page.length;
  }

  return ids;
}

async function listReturningDealIds() {
  return listDealIds(intakeSeedNamespace, { "filter[isReturning]": "true" });
}

async function countExistingDeals() {
  const response = await fetch(`${apiBase}/v1/deals/aggregate`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      filter: { title: { "$contains": plan.namespace } },
      aggregate: [{ field: "*", function: "count" }]
    })
  });
  const payload = await response.json();

  if (!response.ok || !Number.isInteger(payload.data?.count)) {
    throw new Error("Не удалось посчитать уже созданные тестовые сделки.");
  }

  return payload.data.count;
}

async function getExistingCompanies() {
  const url = new URL(`${apiBase}/v1/companies`);
  url.searchParams.set("filter[title][$contains]", plan.namespace);
  url.searchParams.set("limit", "20");
  url.searchParams.append("select[]", "id");
  url.searchParams.append("select[]", "title");
  const response = await fetch(url, { headers: { "X-Api-Key": apiKey, "Accept": "application/json" } });
  const payload = await response.json();
  const companies = Array.isArray(payload.data) ? payload.data : [];

  if (!response.ok || companies.length === 0) {
    throw new Error("Для продолжения seed нужны ранее созданные тестовые компании.");
  }

  return Object.fromEntries(companies.map((company, index) => [`company-${index + 1}`, company]));
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
