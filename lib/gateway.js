const bearerPattern = /^Bearer\s+(vibe_session_[A-Za-z0-9_-]+)$/;

export function getGatewayAuthorization(headers) {
  const value = headers?.["x-vibe-authorization"];
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== "string" || !bearerPattern.test(raw)) {
    return null;
  }

  return raw;
}

export function buildVibeHeaders({ appKey, apiKey, gatewayAuthorization }) {
  if (gatewayAuthorization && typeof appKey === "string" && appKey) {
    return {
      "X-Api-Key": appKey,
      "Authorization": gatewayAuthorization,
      "Accept": "application/json"
    };
  }

  if (typeof apiKey === "string" && apiKey) {
    return {
      "X-Api-Key": apiKey,
      "Accept": "application/json"
    };
  }

  return null;
}

export function getGatewayUser(headers) {
  const id = readHeader(headers, "x-vibe-user-id");
  const encodedName = readHeader(headers, "x-vibe-user-name-encoded");
  const role = readHeader(headers, "x-vibe-user-role");

  if (!id) {
    return null;
  }

  let name = "Пользователь Битрикс24";

  if (encodedName) {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      // Gateway name is optional; keep a safe fallback if a proxy damaged the header.
    }
  }

  return {
    id,
    name,
    role: role === "ADMIN" || role === "MEMBER" ? role : null
  };
}

function readHeader(headers, name) {
  const value = headers?.[name];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw ? raw : null;
}
