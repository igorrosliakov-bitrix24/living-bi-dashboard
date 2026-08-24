import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildDatasetDraftFromSpec } from "./dataset-spec.js";

export class DatasetRegistry {
  static async open({ registryPath }) {
    if (!registryPath) throw new Error("registryPath обязателен.");
    const registry = new DatasetRegistry(registryPath);
    await registry.#load();
    return registry;
  }

  #path;
  #records = new Map();
  constructor(registryPath) { this.#path = registryPath; }

  list({ includePending = true } = {}) {
    return [...this.#records.values()].filter((item) => includePending || item.status === "active").map(clone);
  }
  get(datasetName) { const item = this.#records.get(datasetName); return item ? clone(item) : null; }

  async stage({ datasetName, spec }) {
    assertSafeName(datasetName);
    const draft = buildDatasetDraftFromSpec(spec, { request: spec.request });
    const now = new Date().toISOString();
    const previous = this.#records.get(datasetName);
    const record = { datasetName, title: draft.title, fields: draft.fields, spec: draft.spec, status: "pending", createdAt: previous?.createdAt || now, updatedAt: now, error: null };
    this.#records.set(datasetName, record); await this.#save(); return clone(record);
  }
  async activate(datasetName) { return this.#setStatus(datasetName, "active", null); }
  async fail(datasetName, error) { return this.#setStatus(datasetName, "failed", String(error || "publication_failed").slice(0, 300)); }
  async remove(datasetName) { assertSafeName(datasetName); const existed = this.#records.delete(datasetName); await this.#save(); return existed; }

  async #setStatus(datasetName, status, error) {
    assertSafeName(datasetName); const record = this.#records.get(datasetName);
    if (!record) throw new Error(`Датасет ${datasetName} не найден в реестре.`);
    Object.assign(record, { status, error, updatedAt: new Date().toISOString() }); await this.#save(); return clone(record);
  }
  async #load() {
    try {
      const payload = JSON.parse(await readFile(this.#path, "utf8"));
      for (const item of Array.isArray(payload.datasets) ? payload.datasets : []) if (item?.datasetName?.startsWith("vibecode_ai_")) this.#records.set(item.datasetName, item);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  async #save() {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, datasets: this.list() }, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#path);
  }
}

function assertSafeName(value) {
  if (typeof value !== "string" || !/^vibecode_ai_[a-z0-9_]{1,210}$/.test(value)) throw new Error("Разрешены только безопасные имена с префиксом vibecode_ai_.");
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
