import { readFile } from "node:fs/promises";
import { loadDealIntakeDataset } from "../lib/deal-intake-dataset.js";
import { getValidOauthState } from "../lib/oauth-state.js";

await loadEnv(new URL("../.env", import.meta.url));

const statePath = process.env.OAUTH_ADAPTER_STATE_PATH || "/tmp/living-bi-chepyuk-auth.json";
const auth = await getValidOauthState({
  statePath,
  clientId: process.env.BITRIX24_OAUTH_CLIENT_ID,
  clientSecret: process.env.BITRIX24_OAUTH_CLIENT_SECRET
});
const snapshot = await loadDealIntakeDataset({
  clientEndpoint: auth.clientEndpoint,
  accessToken: auth.accessToken
});
const managerAliases = new Map();
const rows = snapshot.rows.slice(0, 8).map((row) => ({
  week: row.WEEK_START,
  manager: getAlias(row.MANAGER_ID),
  currency: row.CURRENCY_ID,
  deals: row.NEW_DEALS,
  amount: row.PIPELINE_AMOUNT,
  share: row.WEEKLY_SHARE_PERCENT
}));

console.log(JSON.stringify({
  table: "vibecode_ai_deal_intake_weekly",
  period: snapshot.meta.period,
  sourceDeals: snapshot.meta.sourceDeals,
  excludedFunnels: snapshot.meta.excludedCategoryIds.length,
  managers: new Set(snapshot.rows.map((row) => row.MANAGER_ID)).size,
  outputRows: snapshot.meta.outputRows,
  sample: rows
}, null, 2));

function getAlias(id) {
  if (!managerAliases.has(id)) {
    managerAliases.set(id, `Менеджер ${String.fromCharCode(65 + managerAliases.size)}`);
  }
  return managerAliases.get(id);
}

async function loadEnv(url) {
  try {
    const source = await readFile(url, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // Missing values are reported by the OAuth helpers.
  }
}
