export const managedDatasetPrefix = "vibecode_ai_";

// Управляющий прокси открыт наружу, поэтому список методов задан поимённо:
// всё, чего нет в этом наборе, приложению не нужно и через него не проходит.
export const allowedControlMethods = Object.freeze(new Set([
  "biconnector.connector.list",
  "biconnector.connector.add",
  "biconnector.source.list",
  "biconnector.source.add",
  "biconnector.dataset.list",
  "biconnector.dataset.get",
  "biconnector.dataset.fields",
  "biconnector.dataset.add",
  "biconnector.dataset.update",
  "biconnector.dataset.fields.update",
  "biconnector.dataset.delete"
]));

export class ControlGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ControlGuardError";
    this.code = code;
  }
}

export function assertControlMethodAllowed(method) {
  if (typeof method !== "string" || !allowedControlMethods.has(method)) {
    throw new ControlGuardError("unsupported_bitrix_method", `Метод ${String(method)} не разрешён управляющему маршруту.`);
  }
  return method;
}

export function assertManagedDatasetName(name) {
  const value = String(name || "");
  if (!value.startsWith(managedDatasetPrefix)) {
    throw new ControlGuardError("foreign_dataset", `Датасет ${value || "без имени"} не принадлежит приложению: нужен префикс ${managedDatasetPrefix}.`);
  }
  return value;
}

// Изменяющие вызовы разрешены только над собственными датасетами. Имя нового
// набора видно прямо в запросе, для существующего его надо сверить в портале.
export function describeOwnershipCheck(method, params = {}) {
  if (method === "biconnector.dataset.add") {
    return { kind: "name", name: params?.fields?.name };
  }

  if (["biconnector.dataset.update", "biconnector.dataset.delete", "biconnector.dataset.fields.update"].includes(method)) {
    const id = Number(params?.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new ControlGuardError("invalid_dataset_id", "Для изменения датасета нужен его числовой идентификатор.");
    }
    return { kind: "id", id };
  }

  return null;
}
