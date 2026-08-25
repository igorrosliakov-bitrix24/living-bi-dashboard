import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConnectorStatusStore } from "../lib/connector-status.js";

test("connector status persists a successful BI request without row values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "living-bi-status-"));
  const statusPath = join(directory, "status.json");
  const store = await ConnectorStatusStore.open({ statusPath });
  await store.recordSuccess({ table: "vibecode_ai_deal_intake_weekly" });
  const restored = await ConnectorStatusStore.open({ statusPath });
  assert.equal(restored.snapshot().lastTable, "vibecode_ai_deal_intake_weekly");
  assert.equal(restored.snapshot().requests, 1);
  assert.ok(restored.snapshot().lastSuccessAt);
});

test("отказ по таблице записывается рядом с её успехами", async () => {
  const directory = await mkdtemp(join(tmpdir(), "living-bi-status-"));
  const store = await ConnectorStatusStore.open({ statusPath: join(directory, "status.json") });
  await store.recordSuccess({ table: "vibecode_ai_deal_won_weekly" });
  await store.recordError("dataset_not_available", { table: "vibecode_ai_deal_won_weekly" });

  const snapshot = store.snapshot();
  assert.equal(snapshot.lastErrorCode, "dataset_not_available");
  assert.equal(snapshot.lastTable, "vibecode_ai_deal_won_weekly");
  assert.equal(snapshot.datasets.vibecode_ai_deal_won_weekly.lastErrorCode, "dataset_not_available");
  assert.equal(snapshot.datasets.vibecode_ai_deal_won_weekly.requests, 2);
});
