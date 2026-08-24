export const dealIntakeTable = {
  code: "vibecode_ai_deal_intake_weekly",
  title: "Новые сделки по менеджерам и неделям"
};

export const dealIntakeFields = [
  { code: "WEEK_START", name: "Начало недели", type: "date" },
  { code: "MANAGER_ID", name: "ID менеджера", type: "int" },
  { code: "MANAGER_NAME", name: "Менеджер", type: "string" },
  { code: "CURRENCY_ID", name: "Валюта", type: "string" },
  { code: "NEW_DEALS", name: "Новые сделки", type: "int" },
  { code: "PIPELINE_AMOUNT", name: "Сумма сделок", type: "double" },
  { code: "AVERAGE_AMOUNT", name: "Средняя сумма", type: "double" },
  { code: "WEEKLY_SHARE_PERCENT", name: "Доля недельного потока, %", type: "double" }
];

const dealSelect = [
  "ID",
  "CATEGORY_ID",
  "ASSIGNED_BY_ID",
  "DATE_CREATE",
  "BEGINDATE",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "IS_RETURN_CUSTOMER"
];

export async function loadDealIntakeDataset({
  clientEndpoint,
  accessToken,
  fetchImpl = fetch,
  now = new Date(),
  maxDeals = 5_000
}) {
  validateConnection(clientEndpoint, accessToken);
  if (!Number.isInteger(maxDeals) || maxDeals < 1 || maxDeals > 5_000) {
    throw new Error("maxDeals должен быть целым числом от 1 до 5000.");
  }

  const period = getCurrentQuarterRange(now);
  const [categories, users, deals] = await Promise.all([
    fetchCategories({ clientEndpoint, accessToken, fetchImpl }),
    fetchUsers({ clientEndpoint, accessToken, fetchImpl }),
    fetchDeals({ clientEndpoint, accessToken, fetchImpl, period, maxDeals })
  ]);
  const excludedCategoryIds = categories
    .filter((category) => /test|тест/i.test(String(category.name || "")))
    .map((category) => String(category.id));
  const rows = aggregateDealIntakeRows({ deals, users, excludedCategoryIds });

  return {
    rows,
    meta: {
      period,
      sourceDeals: deals.length,
      excludedCategoryIds,
      outputRows: rows.length
    }
  };
}

export function aggregateDealIntakeRows({ deals, users, excludedCategoryIds = [] }) {
  if (!Array.isArray(deals) || !Array.isArray(users) || !Array.isArray(excludedCategoryIds)) {
    throw new Error("Для расчёта нужны массивы deals, users и excludedCategoryIds.");
  }

  const excluded = new Set(excludedCategoryIds.map(String));
  const userNames = new Map(users.map((user) => [
    String(user.ID),
    [user.NAME, user.LAST_NAME].filter(Boolean).join(" ").trim() || `Менеджер ${user.ID}`
  ]));
  const groups = new Map();
  const weeklyTotals = new Map();

  for (const deal of deals) {
    if (deal.IS_RETURN_CUSTOMER !== "N" || excluded.has(String(deal.CATEGORY_ID))) {
      continue;
    }
    const managerId = parsePositiveInteger(deal.ASSIGNED_BY_ID);
    const weekStart = getMonday(deal.BEGINDATE || deal.DATE_CREATE);
    const currencyId = normalizeCurrency(deal.CURRENCY_ID);
    if (!managerId || !weekStart || !currencyId) {
      continue;
    }

    const key = `${weekStart}|${managerId}|${currencyId}`;
    const row = groups.get(key) || {
      WEEK_START: weekStart,
      MANAGER_ID: managerId,
      MANAGER_NAME: userNames.get(String(managerId)) || `Менеджер ${managerId}`,
      CURRENCY_ID: currencyId,
      NEW_DEALS: 0,
      PIPELINE_AMOUNT: 0,
      AVERAGE_AMOUNT: 0,
      WEEKLY_SHARE_PERCENT: 0
    };
    row.NEW_DEALS += 1;
    row.PIPELINE_AMOUNT += normalizeAmount(deal.OPPORTUNITY);
    groups.set(key, row);

    const totalKey = `${weekStart}|${currencyId}`;
    weeklyTotals.set(totalKey, (weeklyTotals.get(totalKey) || 0) + 1);
  }

  return [...groups.values()]
    .map((row) => ({
      ...row,
      PIPELINE_AMOUNT: round(row.PIPELINE_AMOUNT),
      AVERAGE_AMOUNT: round(row.PIPELINE_AMOUNT / row.NEW_DEALS),
      WEEKLY_SHARE_PERCENT: round(100 * row.NEW_DEALS / weeklyTotals.get(`${row.WEEK_START}|${row.CURRENCY_ID}`))
    }))
    .sort((left, right) => left.WEEK_START.localeCompare(right.WEEK_START)
      || left.MANAGER_NAME.localeCompare(right.MANAGER_NAME, "ru")
      || left.CURRENCY_ID.localeCompare(right.CURRENCY_ID));
}

export function selectDealIntakeRows(rows, { select, limit } = {}) {
  if (!Array.isArray(rows)) {
    throw new Error("rows должен быть массивом.");
  }
  const knownFields = new Set(dealIntakeFields.map((field) => field.code));
  const requested = Array.isArray(select) && select.length > 0
    ? select.filter((field) => knownFields.has(field))
    : [...knownFields];
  const parsedLimit = Number(limit);
  const safeLimit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, rows.length)
    : rows.length;

  return [requested, ...rows.slice(0, safeLimit).map((row) => requested.map((field) => row[field]))];
}

export function getCurrentQuarterRange(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error("now должен содержать корректную дату.");
  }
  const startMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(date.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), startMonth + 3, 1));
  const lowerBoundary = new Date(start.getTime() - 1_000);
  return {
    start: formatDate(start),
    endExclusive: formatDate(end),
    lowerBoundary: formatDateTime(lowerBoundary)
  };
}

async function fetchCategories(options) {
  const payload = await callRest(options, "crm.category.list", { entityTypeId: 2 });
  return Array.isArray(payload.categories) ? payload.categories : [];
}

async function fetchUsers(options) {
  return fetchAllPages(options, "user.get", {
    "FILTER[ACTIVE]": "Y"
  });
}

async function fetchDeals({ period, maxDeals, ...options }) {
  return fetchAllPages(options, "crm.deal.list", {
    "order[ID]": "ASC",
    "filter[>BEGINDATE]": period.lowerBoundary,
    "filter[<BEGINDATE]": `${period.endExclusive}T00:00:00`,
    "select[]": dealSelect
  }, maxDeals);
}

async function fetchAllPages(options, method, params, maxItems = 5_000) {
  const items = [];
  let start = 0;

  do {
    const payload = await callRest(options, method, { ...params, start });
    if (!Array.isArray(payload.result)) {
      throw new Error(`Метод ${method} вернул некорректный список.`);
    }
    items.push(...payload.result);
    if (items.length > maxItems) {
      throw new Error(`Метод ${method} вернул больше ${maxItems} записей. Уточните период или фильтры.`);
    }
    start = payload.next !== undefined
      && payload.next !== null
      && Number.isInteger(Number(payload.next))
      ? Number(payload.next)
      : null;
  } while (start !== null);

  return items;
}

async function callRest({ clientEndpoint, accessToken, fetchImpl }, method, params) {
  const url = new URL(`${method}.json`, ensureTrailingSlash(clientEndpoint));
  url.searchParams.set("auth", accessToken);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const payload = await readJson(response);
  if (!response.ok || payload.error) {
    const error = new Error(payload.error_description || payload.error || `Bitrix24 REST вернул HTTP ${response.status}.`);
    error.code = payload.error || "bitrix_rest_failed";
    error.status = response.status;
    throw error;
  }
  return method === "crm.category.list" ? payload.result || {} : payload;
}

function getMonday(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return null;
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return formatDate(date);
}

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeCurrency(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function round(value) {
  return Number(value.toFixed(2));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date) {
  return date.toISOString().slice(0, 19);
}

function validateConnection(clientEndpoint, accessToken) {
  let url;
  try {
    url = new URL(clientEndpoint);
  } catch {
    throw new Error("clientEndpoint должен быть HTTPS URL.");
  }
  if (url.protocol !== "https:" || typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("Для чтения CRM нужны HTTPS clientEndpoint и accessToken.");
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
