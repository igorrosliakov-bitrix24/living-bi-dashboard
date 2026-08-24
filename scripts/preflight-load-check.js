import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { createBitrixWebhookClient } from "../lib/bitrix-rest.js";

await loadEnv(new URL("../.env", import.meta.url));

const client = createBitrixWebhookClient({
  webhookUrl: process.env.BITRIX24_REST_WEBHOOK_URL,
  allowedMethods: ["crm.deal.list", "biconnector.dataset.list"]
});
const now = new Date();
const periods = [
  { name: "30 дней", from: subtractDays(now, 30) },
  { name: "90 дней", from: subtractDays(now, 90) },
  { name: "текущий квартал", from: currentQuarterStart(now) }
];

const measurements = [];
for (const period of periods) {
  measurements.push(await measureDealCount(client, period));
}
const datasets = await measureDatasetList(client);

console.log(JSON.stringify({
  mode: "read-only",
  checkedAt: now.toISOString(),
  dealCounts: measurements,
  biDatasets: datasets
}, null, 2));

async function measureDealCount(restClient, period) {
  const started = performance.now();
  const payload = await restClient.callWithMeta("crm.deal.list", {
    order: { ID: "ASC" },
    filter: { ">=DATE_CREATE": `${period.from}T00:00:00` },
    select: ["ID"],
    start: 0
  });
  return {
    period: period.name,
    deals: Number(payload.total ?? (Array.isArray(payload.result) ? payload.result.length : 0)),
    durationMs: Math.round(performance.now() - started)
  };
}

async function measureDatasetList(restClient) {
  const started = performance.now();
  try {
    const result = await restClient.call("biconnector.dataset.list", { select: ["id"] });
    return {
      status: "available",
      count: Array.isArray(result) ? result.length : 0,
      durationMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    return {
      status: "unavailable",
      code: typeof error?.code === "string" ? error.code : "request_failed",
      durationMs: Math.round(performance.now() - started)
    };
  }
}

function subtractDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function currentQuarterStart(value) {
  const month = Math.floor(value.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(value.getUTCFullYear(), month, 1)).toISOString().slice(0, 10);
}

async function loadEnv(url) {
  try {
    const source = await readFile(url, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // The client reports the missing webhook value below.
  }
}
