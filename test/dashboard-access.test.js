import test from "node:test";
import assert from "node:assert/strict";
import { resolveDashboardEditAccess } from "../lib/dashboard-access.js";

test("lets an administrator claim an unowned dashboard and only its owner edit it", () => {
  assert.deepEqual(resolveDashboardEditAccess({ ownerId: null, user: { id: "u1", role: "ADMIN" } }), { allowed: true, claimOwner: true });
  assert.deepEqual(resolveDashboardEditAccess({ ownerId: "u1", user: { id: "u1", role: "MEMBER" } }), { allowed: true, claimOwner: false });
  assert.deepEqual(resolveDashboardEditAccess({ ownerId: "u1", user: { id: "u2", role: "ADMIN" } }), { allowed: false, claimOwner: false });
});
