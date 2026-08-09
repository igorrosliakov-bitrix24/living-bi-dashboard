import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { mapWithConcurrency, TtlCache } from "../lib/ttl-cache.js";

test("returns cache values only before expiration and keeps copies isolated", () => {
  let now = 100;
  const cache = new TtlCache({ ttlMs: 50, now: () => now });
  cache.set("dashboard", { values: [1] });
  const received = cache.get("dashboard");
  received.values.push(2);

  assert.deepEqual(cache.get("dashboard"), { values: [1] });
  now = 150;
  assert.equal(cache.get("dashboard"), undefined);
});

test("limits concurrent asynchronous work", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await setTimeout(1);
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});
