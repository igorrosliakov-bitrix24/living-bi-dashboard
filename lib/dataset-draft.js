const datasetNamePattern = /^[a-z][a-z0-9_]{0,229}$/;
const fieldNamePattern = /^[A-Z][A-Z0-9_]{0,31}$/;
const allowedFieldTypes = new Set(["integer", "string", "float", "date", "datetime"]);
const maxRequestLength = 500;

const draftFields = [
  { code: "WEEK_START", title: "Начало недели", type: "date" },
  { code: "MANAGER_ID", title: "ID менеджера", type: "integer" },
  { code: "MANAGER_NAME", title: "Менеджер", type: "string" },
  { code: "CURRENCY_ID", title: "Валюта", type: "string" },
  { code: "NEW_DEALS", title: "Новые сделки", type: "integer" },
  { code: "PIPELINE_AMOUNT", title: "Сумма сделок", type: "float" },
  { code: "AVERAGE_AMOUNT", title: "Средняя сумма", type: "float" },
  { code: "WEEKLY_SHARE_PERCENT", title: "Доля недельного потока, %", type: "float" }
];

export function buildDatasetDraft({ request }) {
  const normalizedRequest = validateRequest(request);
  const draft = {
    template: "manager_weekly_new_deals",
    datasetName: "vibecode_ai_deal_intake_weekly",
    title: "Новые сделки по менеджерам и неделям",
    request: normalizedRequest,
    source: {
      entity: "crm.deal",
      description: "Сделки CRM с группировкой по неделям, менеджерам и валюте."
    },
    period: "current_quarter",
    filters: [
      "исключить повторные сделки",
      "исключить воронки с названием «Тест»"
    ],
    formula: "Новые сделки = количество сделок по неделе, менеджеру и валюте; сумма и средняя сумма считаются по OPPORTUNITY.",
    fields: draftFields.map((field) => ({ ...field })),
    sampleRows: [
      { WEEK_START: "2026-08-03", MANAGER_ID: 101, MANAGER_NAME: "Менеджер A", CURRENCY_ID: "RUB", NEW_DEALS: 4, PIPELINE_AMOUNT: 420000, AVERAGE_AMOUNT: 105000, WEEKLY_SHARE_PERCENT: 40 },
      { WEEK_START: "2026-08-03", MANAGER_ID: 102, MANAGER_NAME: "Менеджер B", CURRENCY_ID: "RUB", NEW_DEALS: 6, PIPELINE_AMOUNT: 630000, AVERAGE_AMOUNT: 105000, WEEKLY_SHARE_PERCENT: 60 }
    ],
    publication: {
      status: "draft",
      message: "Черновик сохранён только в приложении. Датасет в Битрикс24 пока не создан."
    }
  };

  const validation = validateDatasetDraft(draft);
  if (!validation.valid) {
    throw new DatasetDraftError("invalid_dataset_draft", validation.errors.join(" "));
  }

  return draft;
}

export function confirmDatasetDraft(draft) {
  const validation = validateDatasetDraft(draft);
  if (!validation.valid) {
    throw new DatasetDraftError("invalid_dataset_draft", validation.errors.join(" "));
  }

  return {
    id: `draft-${Date.now().toString(36)}`,
    datasetName: draft.datasetName,
    title: draft.title,
    status: "draft_confirmed",
    confirmedAt: new Date().toISOString(),
    message: "Черновик подтверждён внутри приложения и готов к безопасному сравнению с Битрикс24."
  };
}

export function validateDatasetDraft(draft) {
  const errors = [];

  if (!isRecord(draft)) {
    return { valid: false, errors: ["Черновик должен быть объектом."] };
  }
  if (typeof draft.datasetName !== "string" || !datasetNamePattern.test(draft.datasetName)) {
    errors.push("Имя датасета должно начинаться со строчной латинской буквы и содержать только строчные буквы, цифры и _ (до 230 символов).");
  }
  if (typeof draft.title !== "string" || draft.title.trim().length === 0 || draft.title.length > 120) {
    errors.push("Название датасета должно быть непустой строкой до 120 символов.");
  }
  if (!Array.isArray(draft.fields) || draft.fields.length === 0) {
    errors.push("Датасет должен содержать хотя бы одно поле.");
  } else {
    const names = new Set();
    for (const field of draft.fields) {
      if (!isRecord(field) || typeof field.code !== "string" || !fieldNamePattern.test(field.code)) {
        errors.push("Имя поля должно начинаться с заглавной латинской буквы и содержать только A-Z, цифры и _ (до 32 символов).");
      } else if (names.has(field.code)) {
        errors.push(`Поле ${field.code} повторяется.`);
      } else {
        names.add(field.code);
      }
      if (!isRecord(field) || !allowedFieldTypes.has(field.type)) {
        errors.push(`Тип поля ${field?.code || "без имени"} не поддерживается.`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export class DatasetDraftError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DatasetDraftError";
    this.code = code;
  }
}

function validateRequest(request) {
  if (typeof request !== "string" || request.trim().length === 0 || request.length > maxRequestLength) {
    throw new DatasetDraftError("invalid_dataset_request", `Опишите задачу одной фразой длиной от 1 до ${maxRequestLength} символов.`);
  }
  return request.trim();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
