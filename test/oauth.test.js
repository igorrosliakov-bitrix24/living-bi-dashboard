import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthorizationUrl,
  createOpaqueToken,
  isValidState,
  parseCookies,
  serializeCookie,
  toSafeUser
} from "../lib/oauth.js";

test("creates an opaque OAuth state of valid length", () => {
  const state = createOpaqueToken();

  assert.equal(isValidState(state), true);
  assert.equal(createOpaqueToken() === state, false);
});

test("builds a Vibecode OAuth authorization URL", () => {
  const url = new URL(
    buildAuthorizationUrl({
      apiBase: "https://vibecode.bitrix24.tech",
      appKey: "vibe_app_test",
      state: "a".repeat(16)
    })
  );

  assert.equal(url.pathname, "/v1/oauth/authorize");
  assert.equal(url.searchParams.get("app_key"), "vibe_app_test");
  assert.equal(url.searchParams.get("state"), "a".repeat(16));
  assert.throws(() => buildAuthorizationUrl({ apiBase: "", appKey: "key", state: "short" }));
});

test("parses cookies and preserves malformed encoded values", () => {
  assert.deepEqual(parseCookies("oauth_state=abc%20123; session=xyz"), {
    oauth_state: "abc 123",
    session: "xyz"
  });
  assert.deepEqual(parseCookies("bad; broken=%E0%A4%A"), { broken: "%E0%A4%A" });
  assert.deepEqual(parseCookies(), {});
});

test("serializes secure HTTP-only cookies and rejects unsafe values", () => {
  const cookie = serializeCookie("dashboard_session", "session value", {
    maxAge: 3600,
    secure: true
  });

  assert.match(cookie, /^dashboard_session=session%20value;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.throws(() => serializeCookie("bad;name", "value"));
  assert.throws(() => serializeCookie("name", "bad\nvalue"));
});

test("exposes only the dashboard-safe user fields", () => {
  assert.deepEqual(toSafeUser({ id: "42", name: "Иван", email: "ivan@example.com" }), {
    id: "42",
    name: "Иван"
  });
  assert.deepEqual(toSafeUser({ id: "42" }), {
    id: "42",
    name: "Пользователь Битрикс24"
  });
  assert.equal(toSafeUser({ id: 42 }), null);
});
