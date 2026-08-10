import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
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
const existingDistribution = await getExistingDealDistribution();
const existingDealCount = [...existingDistribution.values()].reduce((sum, count) => sum + count, 0);

if (hasExistingDemoRecords(existing.results) && !options.resume) {
  const entities = listExistingDemoEntities(existing.results).join(", ");
  throw new Error(`${plan.namespace} уже содержит данные (${entities}). Для безопасного продолжения используйте --resume вместе с --confirm.`);
}

if (existingDealCount > options.dealCount) {
  throw new Error(`В ${plan.namespace} уже больше сделок (${existingDealCount}), чем запрошено (${options.dealCount}).`);
}

const companies = hasExistingDemoRecords(existing.results)
  ? { results: await getExistingCompanies() }
  : await batch(plan.companyCalls);
ensureSucceeded(companies, "компаний");

const managerIds = options.managerDistribution.length > 0
  ? options.managerDistribution.map(({ id }) => id)
  : options.managerIds.length > 0 ? options.managerIds : [await getOwnerId()];
const pendingDealCount = options.dealCount - existingDealCount;
const managerSequence = buildPendingManagerSequence(options.managerDistribution, existingDistribution, pendingDealCount);
const resumePlan = createLoadSeedPlan({
  ...options,
  dealCount: pendingDealCount,
  managerIds,
  managerSequence,
  startIndex: existingDealCount
});
const deals = resumePlan.createDeals(companies.results);

for (const [index, calls] of chunk(deals, 50).entries()) {
  const result = await batch(calls);
  ensureSucceeded(result, "сделок");

  if (index < Math.ceil(deals.length / 50) - 1) {
    await delay(150);
  }
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

async function getExistingDealDistribution() {
  const response = await fetch(`${apiBase}/v1/deals/aggregate`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      filter: { title: { "$contains": plan.namespace } },
      aggregate: [{ field: "*", function: "count" }],
      groupBy: ["assignedById"]
    })
  });
  const payload = await response.json();

  if (!response.ok || !Array.isArray(payload.data?.groups)) {
    throw new Error("Не удалось посчитать существующие нагрузочные сделки.");
  }

  return new Map(payload.data.groups
    .filter((group) => Number.isInteger(Number(group.assignedById)) && Number.isInteger(group.count))
    .map((group) => [Number(group.assignedById), group.count]));
}

async function getExistingCompanies() {
  const url = new URL(`${apiBase}/v1/companies`);
  url.searchParams.set("filter[title][$contains]", plan.namespace);
  url.searchParams.set("limit", "10");
  url.searchParams.append("select[]", "id");
  url.searchParams.append("select[]", "title");
  const response = await fetch(url, { headers: { "X-Api-Key": apiKey, "Accept": "application/json" } });
  const payload = await response.json();
  const companies = Array.isArray(payload.data) ? payload.data : [];

  if (!response.ok || companies.length < 3) {
    throw new Error("Для продолжения нагрузочного seed нужны три ранее созданные тестовые компании.");
  }

  return Object.fromEntries(companies.slice(0, 3).map((company, index) => [`company-${index + 1}`, company]));
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function buildPendingManagerSequence(distribution, existingDistribution, pendingDealCount) {
  if (distribution.length === 0) {
    return [];
  }

  const sequence = distribution.flatMap(({ id, count }) => {
    const existingCount = existingDistribution.get(id) || 0;
    const pendingCount = count - existingCount;

    if (pendingCount < 0) {
      throw new Error(`У менеджера ${id} уже ${existingCount} тестовых сделок, что больше заданного количества ${count}.`);
    }

    return Array.from({ length: pendingCount }, () => id);
  });

  if (sequence.length !== pendingDealCount) {
    throw new Error("Распределение менеджеров не совпадает с количеством сделок, которые нужно создать.");
  }

  return sequence;
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
