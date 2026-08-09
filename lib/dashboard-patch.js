import { validateDashboardSpec } from "./dashboard-spec.js";

const allowedOperations = new Set(["add", "replace", "remove"]);

export class DashboardPatchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function applyDashboardPatch(dashboard, patch) {
  if (!Array.isArray(patch) || patch.length < 1 || patch.length > 20) {
    throw new DashboardPatchError("invalid_patch", "Изменение должно содержать от 1 до 20 операций.");
  }

  const candidate = structuredClone(dashboard);

  for (const operation of patch) {
    applyOperation(candidate, operation);
  }

  candidate.version = dashboard.version;
  const validation = validateDashboardSpec(candidate);

  if (!validation.valid) {
    throw new DashboardPatchError("invalid_patch_result", `Изменение не прошло проверку: ${validation.errors.join(" ")}`);
  }

  return candidate;
}

function applyOperation(target, operation) {
  if (!operation || typeof operation !== "object" || !allowedOperations.has(operation.op) || typeof operation.path !== "string") {
    throw new DashboardPatchError("invalid_patch_operation", "Разрешены только операции add, replace и remove с путём.");
  }

  const parts = parsePath(operation.path);

  if (parts[0] === "version") {
    throw new DashboardPatchError("protected_patch_path", "Версию отчёта изменять нельзя.");
  }

  const key = parts.at(-1);
  const parent = parts.slice(0, -1).reduce((value, part) => readChild(value, part), target);

  if (Array.isArray(parent)) {
    const index = key === "-" ? parent.length : Number(key);

    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new DashboardPatchError("invalid_patch_path", "Путь изменения указывает за пределы массива.");
    }

    if (operation.op === "remove") {
      if (index >= parent.length) {
        throw new DashboardPatchError("invalid_patch_path", "Нельзя удалить отсутствующий элемент.");
      }
      parent.splice(index, 1);
    } else if (operation.op === "replace") {
      if (index >= parent.length) {
        throw new DashboardPatchError("invalid_patch_path", "Нельзя заменить отсутствующий элемент.");
      }
      parent[index] = structuredClone(operation.value);
    } else {
      parent.splice(index, 0, structuredClone(operation.value));
    }

    return;
  }

  if (!parent || typeof parent !== "object" || key === "__proto__" || key === "constructor" || key === "prototype") {
    throw new DashboardPatchError("invalid_patch_path", "Недопустимый путь изменения.");
  }

  if (operation.op === "remove") {
    if (!(key in parent)) {
      throw new DashboardPatchError("invalid_patch_path", "Нельзя удалить отсутствующее поле.");
    }
    delete parent[key];
  } else if (operation.op === "replace") {
    if (!(key in parent)) {
      throw new DashboardPatchError("invalid_patch_path", "Нельзя заменить отсутствующее поле.");
    }
    parent[key] = structuredClone(operation.value);
  } else {
    parent[key] = structuredClone(operation.value);
  }
}

function parsePath(path) {
  if (!path.startsWith("/") || path.length > 240) {
    throw new DashboardPatchError("invalid_patch_path", "Путь изменения должен начинаться с /.");
  }

  const parts = path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));

  if (!new Set(["title", "period", "widgets"]).has(parts[0]) || parts.some((part) => !part || part.length > 80)) {
    throw new DashboardPatchError("invalid_patch_path", "Изменять можно только title, period и widgets.");
  }

  return parts;
}

function readChild(value, key) {
  if (Array.isArray(value)) {
    const index = Number(key);

    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      throw new DashboardPatchError("invalid_patch_path", "Путь изменения указывает за пределы массива.");
    }

    return value[index];
  }

  if (!value || typeof value !== "object" || !(key in value)) {
    throw new DashboardPatchError("invalid_patch_path", "Путь изменения не существует.");
  }

  return value[key];
}
