import assert from "node:assert/strict";
import test from "node:test";
import { createLoadSeedPlan, loadSeedNamespace, parseLoadSeedOptions } from "../lib/load-seed.js";

test("parses an explicit load seed confirmation and limits record count", () => {
  assert.deepEqual(parseLoadSeedOptions(["--deals=2000", "--manager-ids=1,4", "--confirm"]), {
    confirmed: true,
    dealCount: 2000,
    managerIds: [1, 4]
  });
  assert.throws(() => parseLoadSeedOptions(["--deals=2001"]), /от 100 до 2000/);
  assert.throws(() => parseLoadSeedOptions(["--unknown"]), /Неизвестный параметр/);
});

test("creates isolated load records and distributes them across supplied managers", () => {
  const plan = createLoadSeedPlan({ dealCount: 100, managerIds: [1, 2], now: new Date("2026-08-10T12:00:00Z") });
  const calls = plan.createDeals({ "company-1": { id: 10 }, "company-2": { id: 11 }, "company-3": { id: 12 } });

  assert.equal(plan.namespace, loadSeedNamespace);
  assert.equal(calls.length, 100);
  assert.equal(calls[0].params.title.startsWith(loadSeedNamespace), true);
  assert.deepEqual(calls.slice(0, 4).map((call) => call.params.assignedById), [1, 2, 1, 2]);
});
