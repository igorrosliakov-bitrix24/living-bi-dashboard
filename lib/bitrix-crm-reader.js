export async function listDealCategories({ portalUrl, accessToken, fetchImpl = fetch }) {
  const portal = new URL(portalUrl);
  if (portal.protocol !== "https:" || portal.pathname !== "/") throw new Error("Нужен HTTPS-адрес портала без пути.");
  if (!String(accessToken || "").trim()) throw new Error("OAuth access token обязателен.");
  const response = await fetchImpl(new URL("/rest/crm.category.list.json", portal), {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ entityTypeId: 2, auth: accessToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) { const error = new Error(payload.error_description || payload.error || `HTTP ${response.status}`); error.code = payload.error || "category_list_failed"; throw error; }
  return Array.isArray(payload.result?.categories) ? payload.result.categories.map((item) => ({ id: item.id, name: item.name })) : [];
}

export function validateSpecCategoryNames(spec, categories) {
  const known = new Set(categories.map((item) => String(item.name || "").trim().toLocaleLowerCase("ru")));
  const unknown = [...(spec.filters?.includeCategoryNames || []), ...(spec.filters?.excludeCategoryNames || [])].filter((name) => !known.has(name.toLocaleLowerCase("ru")));
  if (unknown.length) { const error = new Error(`Воронки не найдены в портале: ${unknown.join(", ")}.`); error.code = "unknown_category"; throw error; }
  return true;
}
