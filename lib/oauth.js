import { randomBytes } from "node:crypto";

const STATE_MIN_LENGTH = 16;
const STATE_MAX_LENGTH = 512;

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function isValidState(value) {
  return typeof value === "string" && value.length >= STATE_MIN_LENGTH && value.length <= STATE_MAX_LENGTH;
}

export function buildAuthorizationUrl({ apiBase, appKey, state }) {
  if (!apiBase || !appKey || !isValidState(state)) {
    throw new Error("OAuth authorization URL requires apiBase, appKey, and a valid state.");
  }

  const url = new URL("/v1/oauth/authorize", apiBase);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("state", state);
  return url.toString();
}

export function parseCookies(header) {
  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, item) => {
    const separator = item.indexOf("=");

    if (separator < 1) {
      return cookies;
    }

    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }

    return cookies;
  }, {});
}

export function serializeCookie(name, value, options = {}) {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || /[;\r\n]/.test(value)) {
    throw new Error("Invalid cookie name or value.");
  }

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || "/"}`, "HttpOnly"];

  if (Number.isInteger(options.maxAge) && options.maxAge >= 0) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  parts.push(`SameSite=${options.sameSite || "Lax"}`);

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function toSafeUser(user) {
  if (!user || typeof user !== "object" || typeof user.id !== "string") {
    return null;
  }

  return {
    id: user.id,
    name: typeof user.name === "string" ? user.name : "Пользователь Битрикс24"
  };
}
