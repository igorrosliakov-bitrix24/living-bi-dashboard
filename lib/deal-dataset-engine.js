import { buildDatasetDraftFromSpec, normalizeDatasetSpec } from "./dataset-spec.js";

const dealSelect = ["ID", "CATEGORY_ID", "ASSIGNED_BY_ID", "DATE_CREATE", "BEGINDATE", "STAGE_SEMANTIC_ID"];

export async function loadDealDataset({ clientEndpoint, accessToken, spec: input, fetchImpl = fetch, now = new Date(), maxDeals = 5_000 }) {
  validateConnection(clientEndpoint, accessToken);
  const spec = normalizeDatasetSpec(input, { request: input.request });
  const period = getPeriodRange(spec.period, now);
  const [categories, users, deals] = await Promise.all([
    callRest({ clientEndpoint, accessToken, fetchImpl }, "crm.category.list", { entityTypeId: 2 }).then((value) => value.categories || []),
    fetchAllPages({ clientEndpoint, accessToken, fetchImpl }, "user.get", { "FILTER[ACTIVE]": "Y" }),
    fetchAllPages({ clientEndpoint, accessToken, fetchImpl }, "crm.deal.list", {
      "order[ID]": "ASC", "filter[>BEGINDATE]": period.lowerBoundary,
      "filter[<BEGINDATE]": `${period.endExclusive}T00:00:00`, "select[]": dealSelect
    }, maxDeals)
  ]);
  const rows = aggregateDealDataset({ deals, users, categories, spec });
  return { rows, meta: { period, sourceDeals: deals.length, outputRows: rows.length } };
}

export function aggregateDealDataset({ deals, users, categories, spec: input }) {
  if (!Array.isArray(deals) || !Array.isArray(users) || !Array.isArray(categories)) throw new Error("Для расчёта нужны массивы deals, users и categories.");
  const spec = normalizeDatasetSpec(input, { request: input.request });
  const categoryById = new Map(categories.map((item) => [String(item.id ?? item.ID), String(item.name ?? item.NAME ?? "").trim()]));
  const categoryByName = new Map([...categoryById].map(([id, name]) => [name.toLocaleLowerCase("ru"), id]));
  validateCategoryNames(spec.filters, categoryByName);
  const included = new Set(spec.filters.includeCategoryNames.map((name) => categoryByName.get(name.toLocaleLowerCase("ru"))));
  const excluded = new Set(spec.filters.excludeCategoryNames.map((name) => categoryByName.get(name.toLocaleLowerCase("ru"))));
  const userNames = new Map(users.map((user) => [String(user.ID), [user.NAME, user.LAST_NAME].filter(Boolean).join(" ").trim() || `Менеджер ${user.ID}`]));
  const groups = new Map();

  for (const deal of deals) {
    const categoryId = String(deal.CATEGORY_ID ?? "0");
    if ((included.size && !included.has(categoryId)) || excluded.has(categoryId)) continue;
    const dimensions = dimensionValues(deal, spec.dimensions, userNames, categoryById);
    if (!dimensions) continue;
    const key = spec.dimensions.map((dimension) => dimensions[dimension]).join("|");
    const group = groups.get(key) || { ...dimensions, __total: 0, __won: 0 };
    group.__total += 1;
    if (String(deal.STAGE_SEMANTIC_ID).toUpperCase() === "S") group.__won += 1;
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => materialize(group, spec)).sort(compareRows(spec.dimensions));
}

export function selectDealDatasetRows(rows, draft, { select, limit } = {}) {
  const known = draft.fields.map((field) => field.code);
  const requested = Array.isArray(select) && select.length ? select.filter((field) => known.includes(field)) : known;
  const parsed = Number(limit);
  const safeLimit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, rows.length) : rows.length;
  return [requested, ...rows.slice(0, safeLimit).map((row) => requested.map((field) => row[field]))];
}

export function getPeriodRange(period, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("now должен содержать корректную дату.");
  let startMonth = 0;
  let duration = 12;
  if (period === "current_month") { startMonth = date.getUTCMonth(); duration = 1; }
  else if (period === "current_quarter") { startMonth = Math.floor(date.getUTCMonth() / 3) * 3; duration = 3; }
  else if (period !== "current_year") throw new Error("Период не поддерживается.");
  const start = new Date(Date.UTC(date.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), startMonth + duration, 1));
  return { start: formatDate(start), endExclusive: formatDate(end), lowerBoundary: formatDateTime(new Date(start.getTime() - 1000)) };
}

function dimensionValues(deal, dimensions, users, categories) {
  const result = {};
  for (const dimension of dimensions) {
    if (dimension === "week") {
      const value = getMonday(deal.BEGINDATE || deal.DATE_CREATE);
      if (!value) return null;
      result.week = value;
    } else if (dimension === "manager") {
      const id = Number(deal.ASSIGNED_BY_ID);
      if (!Number.isInteger(id) || id <= 0) return null;
      result.manager = id;
      result.managerName = users.get(String(id)) || `Менеджер ${id}`;
    } else if (dimension === "category") {
      const id = Number(deal.CATEGORY_ID ?? 0);
      if (!Number.isInteger(id) || id < 0) return null;
      result.category = id;
      result.categoryName = categories.get(String(id)) || `Воронка ${id}`;
    }
  }
  return result;
}

function materialize(group, spec) {
  const row = {};
  if (spec.dimensions.includes("week")) row.WEEK_START = group.week;
  if (spec.dimensions.includes("manager")) { row.MANAGER_ID = group.manager; row.MANAGER_NAME = group.managerName; }
  if (spec.dimensions.includes("category")) { row.CATEGORY_ID = group.category; row.CATEGORY_NAME = group.categoryName; }
  if (spec.metrics.includes("total_deals")) row.TOTAL_DEALS = group.__total;
  if (spec.metrics.includes("won_deals")) row.WON_DEALS = group.__won;
  if (spec.metrics.includes("conversion_percent")) row.CONVERSION_PERCENT = group.__total ? round(100 * group.__won / group.__total) : 0;
  return row;
}

function compareRows(dimensions) {
  const draft = buildDatasetDraftFromSpec({ dimensions, metrics: ["total_deals"], period: "current_month", filters: {}, title: "Сортировка" }, { request: "Сортировка" });
  const keys = draft.fields.filter((field) => !field.code.endsWith("DEALS")).map((field) => field.code);
  return (left, right) => keys.map((key) => String(left[key]).localeCompare(String(right[key]), "ru")).find((value) => value) || 0;
}

function validateCategoryNames(filters, categoryByName) {
  for (const name of [...filters.includeCategoryNames, ...filters.excludeCategoryNames]) {
    if (!categoryByName.has(name.toLocaleLowerCase("ru"))) {
      const error = new Error(`Воронка «${name}» не найдена.`); error.code = "unknown_category"; throw error;
    }
  }
}

async function fetchAllPages(options, method, params, maxItems = 5_000) {
  const items = []; let start = 0;
  do {
    const payload = await callRest(options, method, { ...params, start });
    if (!Array.isArray(payload.result)) throw new Error(`Метод ${method} вернул некорректный список.`);
    items.push(...payload.result);
    if (items.length > maxItems) throw new Error(`Метод ${method} вернул больше ${maxItems} записей.`);
    start = payload.next === undefined || payload.next === null ? null : Number(payload.next);
  } while (Number.isInteger(start));
  return items;
}

async function callRest({ clientEndpoint, accessToken, fetchImpl }, method, params) {
  const url = new URL(`${method}.json`, clientEndpoint.endsWith("/") ? clientEndpoint : `${clientEndpoint}/`);
  url.searchParams.set("auth", accessToken);
  for (const [key, value] of Object.entries(params)) Array.isArray(value) ? value.forEach((item) => url.searchParams.append(key, String(item))) : url.searchParams.set(key, String(value));
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) { const error = new Error(payload.error_description || payload.error || `HTTP ${response.status}`); error.code = payload.error || "bitrix_rest_failed"; throw error; }
  return method === "crm.category.list" ? payload.result || {} : payload;
}

function getMonday(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return formatDate(date);
}
function round(value) { return Number(value.toFixed(2)); }
function formatDate(date) { return date.toISOString().slice(0, 10); }
function formatDateTime(date) { return date.toISOString().slice(0, 19); }
function validateConnection(endpoint, token) { const url = new URL(endpoint); if (url.protocol !== "https:" || !String(token || "").trim()) throw new Error("Для чтения CRM нужны HTTPS clientEndpoint и accessToken."); }
