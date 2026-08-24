export class AdapterControlClient {
  constructor({ baseUrl, controlKey, fetchImpl = fetch }) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.pathname !== "/") throw new Error("Адрес adapter должен быть HTTPS URL без пути.");
    if (!String(controlKey || "").trim()) throw new Error("ADAPTER_CONTROL_KEY обязателен.");
    this.baseUrl = url.toString().replace(/\/$/, ""); this.controlKey = controlKey; this.fetchImpl = fetchImpl;
  }
  stage(datasetName, spec) { return this.#call("/control/datasets", { action: "stage", datasetName, spec }); }
  activate(datasetName) { return this.#call("/control/datasets", { action: "activate", datasetName }); }
  fail(datasetName, error) { return this.#call("/control/datasets", { action: "fail", datasetName, error }); }
  remove(datasetName) { return this.#call("/control/datasets", { action: "remove", datasetName }); }
  list() { return this.#call("/control/datasets", { action: "list" }); }
  refresh(datasetName) { return this.#call("/control/refresh", { datasetName }); }
  call(method, params = {}) { return this.#call("/control/bitrix", { method, params }).then((payload) => payload.result); }
  listCategories() { return this.#call("/control/categories", {}); }
  async #call(path, body) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Adapter-Control-Key": this.controlKey }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) { const error = new Error(payload.message || payload.error || `Adapter HTTP ${response.status}`); error.code = payload.error || "adapter_control_failed"; throw error; }
    return payload;
  }
}
