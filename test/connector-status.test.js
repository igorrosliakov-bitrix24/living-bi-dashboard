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
