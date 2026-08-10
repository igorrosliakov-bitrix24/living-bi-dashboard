import { randomUUID } from "node:crypto";

const sessionCookieName = "dashboard_session";

export class GatewaySessionStore {
  constructor({ ttlMs = 30 * 60 * 1_000, now = () => Date.now(), createId = randomUUID } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.createId = createId;
    this.sessions = new Map();
  }

  create({ authorization, user }) {
    this.removeExpired();
    const id = this.createId();
    this.sessions.set(id, { authorization, user, expiresAt: this.now() + this.ttlMs });
    return id;
  }

  get(cookieHeader) {
    const id = readCookie(cookieHeader, sessionCookieName);
    const session = id ? this.sessions.get(id) : null;

    if (!session || session.expiresAt <= this.now()) {
      if (id) {
        this.sessions.delete(id);
      }
      return null;
    }

    return session;
  }

  cookie(sessionId, secure) {
    return `${sessionCookieName}=${sessionId}; Path=/; HttpOnly; SameSite=None; Max-Age=${Math.floor(this.ttlMs / 1_000)}${secure ? "; Secure" : ""}`;
  }

  removeExpired() {
    const currentTime = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= currentTime) {
        this.sessions.delete(id);
      }
    }
  }
}

function readCookie(cookieHeader, name) {
  if (typeof cookieHeader !== "string") {
    return null;
  }

  const prefix = `${name}=`;
  return cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || null;
}
