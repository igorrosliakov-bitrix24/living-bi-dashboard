import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatasetRegistry } from "../lib/dataset-registry.js";

const spec = { request: "Конверсия", title: "Конверсия", dimensions: ["week", "manager"], metrics: ["conversion_percent"], period: "current_quarter", filters: {} };
test("persists staged and active specs atomically", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "registry-")), "datasets.json");
  const registry = await DatasetRegistry.open({ registryPath: path });
  await registry.stage({ datasetName: "vibecode_ai_deal_conversion_weekly", spec });
  await registry.activate("vibecode_ai_deal_conversion_weekly");
  const reopened = await DatasetRegistry.open({ registryPath: path });
  assert.equal(reopened.get("vibecode_ai_deal_conversion_weekly").status, "active");
});

test("does not allow foreign dataset names", async () => {
  const registry = await DatasetRegistry.open({ registryPath: join(await mkdtemp(join(tmpdir(), "registry-")), "datasets.json") });
  await assert.rejects(registry.stage({ datasetName: "crm_deal", spec }), /vibecode_ai_/);
});
