import assert from "node:assert/strict";
import test from "node:test";
import { GatewaySessionStore } from "../lib/gateway-session.js";

test("keeps the Gateway token on the server and retrieves it by an opaque cookie", () => {
  const store = new GatewaySessionStore({ now: () => 0, createId: () => "session-id" });
  store.create({ authorization: "Bearer vibe_session_test", user: { id: "1", name: "Ирина", role: "ADMIN" } });

  assert.deepEqual(store.get("dashboard_session=session-id"), {
    authorization: "Bearer vibe_session_test",
    user: { id: "1", name: "Ирина", role: "ADMIN" },
    expiresAt: 30 * 60 * 1_000
  });
  assert.equal(store.cookie("session-id", true), "dashboard_session=session-id; Path=/; HttpOnly; SameSite=None; Max-Age=1800; Secure");
});

test("expires sessions and rejects a missing cookie", () => {
  let clock = 0;
  const store = new GatewaySessionStore({ ttlMs: 100, now: () => clock, createId: () => "expired" });
  store.create({ authorization: "Bearer vibe_session_test", user: null });
  clock = 100;

  assert.equal(store.get("dashboard_session=expired"), null);
  assert.equal(store.get("another_cookie=value"), null);
});
