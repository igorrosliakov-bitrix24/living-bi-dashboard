import { existsSync, readFileSync } from "node:fs";
import {
  createCompanyCalls,
  createDealCalls,
  createExistingDemoCalls,
  createTaskCalls,
  demoNamespace,
  hasExistingDemoRecords,
  listExistingDemoEntities
} from "../lib/demo-seed.js";

loadEnv(new URL("../.env", import.meta.url));

const apiBase = process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech";
const apiKey = process.env.VIBECODE_API_KEY;

if (!apiKey) {
  throw new Error("Добавьте VIBECODE_API_KEY в .env перед запуском seed.");
}

const existing = await batch(createExistingDemoCalls());
const existingEntities = listExistingDemoEntities(existing.results);

if (existingEntities.length === 0) {
  const companies = await batch(createCompanyCalls());
  ensureSucceeded(companies, "компаний");

  const deals = await batch(createDealCalls(companies.results));
  ensureSucceeded(deals, "сделок");
}

const hasCompleteSalesDemo = existingEntities.length === 2
  && existingEntities.includes("companies")
  && existingEntities.includes("deals");

if (existingEntities.length > 0 && !hasCompleteSalesDemo) {
  throw new Error(`${demoNamespace} уже есть на портале. Скрипт остановлен, чтобы не создавать дубликаты.`);
}

if (!hasExistingDemoRecords(existing.results) || hasCompleteSalesDemo) {
  const owner = await getOwner();
  const tasks = await batch(createTaskCalls(owner.userId));
  ensureSucceeded(tasks, "задач");
}

console.log(`Демо-данные ${demoNamespace} готовы.`);

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

async function getOwner() {
  const response = await fetch(`${apiBase}/v1/me`, {
    headers: { "X-Api-Key": apiKey, "Accept": "application/json" }
  });
  const payload = await response.json();

  if (!response.ok || !Number.isInteger(Number(payload.data?.owner?.userId))) {
    throw new Error("Не удалось определить исполнителя тестовых задач.");
  }

  return payload.data.owner;
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
