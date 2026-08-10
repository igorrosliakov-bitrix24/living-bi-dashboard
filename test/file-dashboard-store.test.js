import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { createInitialDashboard } from "../lib/dashboard-spec.js";
import { FileDashboardStore } from "../lib/file-dashboard-store.js";

test("persists dashboard versions and the selected current version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "living-bi-dashboard-"));
  const statePath = join(directory, "state.json");

  try {
    const first = new FileDashboardStore({ initialSpec: createInitialDashboard(), statePath });
    await first.load();
    const changed = first.getCurrent();
    changed.title = "Продажи за квартал";
    assert.equal((await first.save(changed, 1)).saved, true);
    assert.equal((await first.restore(1, 2)).saved, true);

    const second = new FileDashboardStore({ initialSpec: createInitialDashboard(), statePath });
    await second.load();
    assert.equal(second.getCurrent().title, "Продажи: обзор");
    assert.equal(second.listVersions().length, 2);
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).format, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
