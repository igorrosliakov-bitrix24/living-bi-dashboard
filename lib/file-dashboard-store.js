import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DashboardStore } from "./dashboard-store.js";

export class FileDashboardStore extends DashboardStore {
  constructor({ initialSpec, statePath }) {
    super(initialSpec);
    this.statePath = statePath;
  }

  async load() {
    try {
      const content = await readFile(this.statePath, "utf8");
      const snapshot = JSON.parse(content);

      if (snapshot?.format !== 1 && snapshot?.format !== 2) {
        throw new Error("Unsupported dashboard state format.");
      }

      this.replaceVersions(snapshot.versions);
      this.setOwnerId(snapshot.ownerId);
    } catch (error) {
      if (error.code === "ENOENT") {
        await this.writeSnapshot(this.getSnapshot());
        return;
      }

      throw error;
    }
  }

  async save(nextSpec, expectedVersion) {
    return this.persistAfterChange(() => super.save(nextSpec, expectedVersion));
  }

  async restore(version, expectedVersion) {
    return this.persistAfterChange(() => super.restore(version, expectedVersion));
  }

  async persistAfterChange(change) {
    const before = this.getSnapshot();
    const result = change();

    if (!result.saved) {
      return result;
    }

    try {
      await this.writeSnapshot(this.getSnapshot());
      return result;
    } catch {
      this.replaceVersions(before.versions);
      return { saved: false, error: "storage_unavailable" };
    }
  }

  async writeSnapshot(snapshot) {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.statePath);
  }
}
