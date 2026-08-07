import assert from "node:assert/strict";
import test from "node:test";
import { buildVibeHeaders, getGatewayAuthorization, getGatewayUser } from "../lib/gateway.js";

test("accepts only a Gateway session token in the expected header", () => {
  const authorization = getGatewayAuthorization({
    "x-vibe-authorization": "Bearer vibe_session_abc-123_xyz"
  });

  assert.equal(authorization, "Bearer vibe_session_abc-123_xyz");
  assert.equal(getGatewayAuthorization({ "x-vibe-authorization": "Bearer vibe_api_secret" }), null);
  assert.equal(getGatewayAuthorization({ "x-vibe-authorization": "vibe_session_missing_bearer" }), null);
  assert.equal(getGatewayAuthorization({}), null);
});

test("uses the app key with a Gateway session and falls back to local API key", () => {
  assert.deepEqual(
    buildVibeHeaders({
      appKey: "vibe_app_test",
      apiKey: "vibe_api_local",
      gatewayAuthorization: "Bearer vibe_session_abc"
    }),
    {
      "X-Api-Key": "vibe_app_test",
      "Authorization": "Bearer vibe_session_abc",
      "Accept": "application/json"
    }
  );

  assert.deepEqual(buildVibeHeaders({ appKey: "", apiKey: "vibe_api_local", gatewayAuthorization: null }), {
    "X-Api-Key": "vibe_api_local",
    "Accept": "application/json"
  });
  assert.equal(buildVibeHeaders({ appKey: "", apiKey: "", gatewayAuthorization: null }), null);
});

test("reads only safe Gateway identity headers", () => {
  assert.deepEqual(
    getGatewayUser({
      "x-vibe-user-id": "42",
      "x-vibe-user-name-encoded": "%D0%98%D0%B2%D0%B0%D0%BD%20%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2",
      "x-vibe-user-role": "ADMIN"
    }),
    { id: "42", name: "Иван Иванов", role: "ADMIN" }
  );
  assert.deepEqual(getGatewayUser({ "x-vibe-user-id": "net_1", "x-vibe-user-name-encoded": "%E0%A4%A" }), {
    id: "net_1",
    name: "Пользователь Битрикс24",
    role: null
  });
  assert.equal(getGatewayUser({}), null);
});
