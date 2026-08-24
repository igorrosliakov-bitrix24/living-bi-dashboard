const methodPattern = /^biconnector\.(?:dataset|source|connector)(?:\.fields)?\.(?:list|get|add|update|delete)$/;

export function createBitrixRestClient({ portalUrl, accessToken, webhookUrl, fetchImpl = fetch }) {
  const transport = webhookUrl
    ? createBitrixWebhookClient({ webhookUrl, allowedMethods: methodPattern, fetchImpl })
    : createOauthTransport({ portalUrl, accessToken, fetchImpl });

  return {
    async call(method, params = {}) {
      if (!methodPattern.test(method)) {
        throw new Error("Поддерживаются только методы модуля biconnector.");
      }
      return transport.call(method, params);
    }
  };
}

export function createBitrixWebhookClient({ webhookUrl, allowedMethods, fetchImpl = fetch }) {
  const baseUrl = normalizeWebhookUrl(webhookUrl);
  const isAllowed = toMethodMatcher(allowedMethods);

  return {
    async call(method, params = {}) {
      if (!isAllowed(method)) {
        throw new Error("Этот метод не разрешён для входящего вебхука.");
      }
      const payload = await callRest({
        url: `${baseUrl}${method}.json`,
        body: params,
        fetchImpl
      });
      return payload.result;
    },
    async callWithMeta(method, params = {}) {
      if (!isAllowed(method)) {
        throw new Error("Этот метод не разрешён для входящего вебхука.");
      }
      return callRest({
        url: `${baseUrl}${method}.json`,
        body: params,
        fetchImpl
      });
    }
  };
}

function createOauthTransport({ portalUrl, accessToken, fetchImpl }) {
  const baseUrl = normalizePortalUrl(portalUrl);
  const token = normalizeAccessToken(accessToken);

  return {
    async call(method, params = {}) {
      const payload = await callRest({
        url: `${baseUrl}/rest/${method}.json`,
        body: { ...params, auth: token },
        fetchImpl
      });
      return payload.result;
    }
  };
}

async function callRest({ url, body, fetchImpl }) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await readJson(response);
  const nestedError = payload.result?.error;
  const apiError = payload.error || (typeof nestedError === "object" ? nestedError.error : nestedError);
  const apiMessage = payload.error_description
    || payload.result?.error_description
    || (typeof nestedError === "object" ? nestedError.error_description : undefined);

  if (!response.ok || apiError) {
    throw new BitrixRestError(apiMessage || apiError || `HTTP ${response.status}`, {
      code: apiError || "bitrix_rest_failed",
      status: response.status
    });
  }

  return {
    result: payload.result,
    total: payload.total
  };
}

export class BitrixRestError extends Error {
  constructor(message, { code, status }) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normalizePortalUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Добавьте BITRIX24_PORTAL_URL в .env.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("BITRIX24_PORTAL_URL должен быть HTTPS URL портала Битрикс24.");
  }

  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BITRIX24_PORTAL_URL должен быть HTTPS URL портала Битрикс24 без пути и параметров.");
  }

  return url.toString().replace(/\/+$/, "");
}

function normalizeAccessToken(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Добавьте BITRIX24_OAUTH_ACCESS_TOKEN в .env.");
  }
  return value.trim();
}

function normalizeWebhookUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Добавьте BITRIX24_REST_WEBHOOK_URL в .env.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("BITRIX24_REST_WEBHOOK_URL должен быть HTTPS URL входящего вебхука.");
  }

  if (url.protocol !== "https:" || url.search || url.hash || !url.pathname.startsWith("/rest/")) {
    throw new Error("BITRIX24_REST_WEBHOOK_URL должен быть HTTPS URL входящего вебхука без параметров.");
  }

  return url.toString().replace(/\/+$/, "") + "/";
}

function toMethodMatcher(allowedMethods) {
  if (allowedMethods instanceof RegExp) {
    return (method) => allowedMethods.test(method);
  }
  if (Array.isArray(allowedMethods) && allowedMethods.every((method) => typeof method === "string" && method)) {
    const known = new Set(allowedMethods);
    return (method) => known.has(method);
  }
  throw new Error("Для входящего вебхука нужен непустой список разрешённых REST-методов.");
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
