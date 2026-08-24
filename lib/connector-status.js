import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const emptyStatus = Object.freeze({ lastRequestAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null, lastTable: null, requests: 0, datasets: {} });

export class ConnectorStatusStore {
  constructor({ state = emptyStatus, statusPath }) {
    this.state = { ...emptyStatus, ...state, datasets: { ...(state.datasets || {}) } };
    this.statusPath = statusPath;
  }

  static async open({ statusPath }) {
    try {
      const state = JSON.parse(await readFile(statusPath, "utf8"));
      return new ConnectorStatusStore({ state, statusPath });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return new ConnectorStatusStore({ statusPath });
    }
  }

  snapshot() {
    return { ...this.state };
  }

  async recordSuccess({ table } = {}) {
    const now = new Date().toISOString();
    const datasets = { ...this.state.datasets };
    if (table) datasets[table] = { ...(datasets[table] || {}), lastRequestAt: now, lastSuccessAt: now, lastErrorCode: null, requests: (datasets[table]?.requests || 0) + 1 };
    this.state = { ...this.state, lastRequestAt: now, lastSuccessAt: now, lastErrorCode: null, lastTable: table || null, requests: this.state.requests + 1, datasets };
    await this.save();
  }

  async recordError(code = "request_failed") {
    const now = new Date().toISOString();
    this.state = { ...this.state, lastRequestAt: now, lastErrorAt: now, lastErrorCode: code, requests: this.state.requests + 1 };
    await this.save();
  }

  async save() {
    await mkdir(dirname(this.statusPath), { recursive: true });
    const temporaryPath = `${this.statusPath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.statusPath);
  }
}
