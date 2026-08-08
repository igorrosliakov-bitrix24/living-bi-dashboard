import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { createInitialDashboard } from "../lib/dashboard-spec.js";
import { FileDashboardStore } from "../lib/file-dashboard-store.js";

test("persists and restores dashboard versions across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "living-bi-dashboard-"));
  const statePath = join(directory, "state.json");

  try {
    const first = new FileDashboardStore({ initialSpec: createInitialDashboard(), statePath });
    await first.load();
    const changed = first.getCurrent();
    changed.title = "Продажи за квартал";
    assert.equal((await first.save(changed, 1)).saved, true);

    const second = new FileDashboardStore({ initialSpec: createInitialDashboard(), statePath });
    await second.load();
    assert.equal(second.getCurrent().title, "Продажи за квартал");
    assert.equal(second.listVersions().length, 2);
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).format, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
