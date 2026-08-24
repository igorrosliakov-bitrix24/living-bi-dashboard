import { createExistingDemoCalls } from "./demo-seed.js";

export const intakeSeedNamespace = "VIBECODE_INTAKE_BI";
export const minIntakeDealCount = 12;
export const maxIntakeDealCount = 1_000;
export const minIntakeWeeks = 1;
export const maxIntakeWeeks = 13;

const companyNames = ["Ампер", "Базальт", "Вершина", "Гранит", "Дельта", "Ересь", "Жёлудь", "Заря"];
const stages = ["NEW", "PREPARATION", "WON", "LOSE"];

export function parseIntakeSeedOptions(args) {
  const options = { confirmed: false, dealCount: 360, managerIds: [], weeks: 8, resume: false, repair: false, spread: false, namespace: intakeSeedNamespace };

  for (const argument of args) {
    if (argument === "--confirm") {
      options.confirmed = true;
      continue;
    }

    if (argument === "--resume") {
      options.resume = true;
      continue;
    }

    if (argument === "--repair") {
      options.repair = true;
      continue;
    }

    if (argument === "--spread") {
      options.spread = true;
      continue;
    }

    if (argument.startsWith("--namespace=")) {
      options.namespace = argument.slice("--namespace=".length);
      continue;
    }

    if (argument.startsWith("--deals=")) {
      options.dealCount = Number(argument.slice("--deals=".length));
      continue;
    }

    if (argument.startsWith("--weeks=")) {
      options.weeks = Number(argument.slice("--weeks=".length));
      continue;
    }

    if (argument.startsWith("--manager-ids=")) {
      options.managerIds = argument.slice("--manager-ids=".length)
        .split(",")
        .filter(Boolean)
        .map((value) => Number(value));
      continue;
    }

    throw new Error(`Неизвестный параметр: ${argument}`);
  }

  if (!Number.isInteger(options.dealCount) || options.dealCount < minIntakeDealCount || options.dealCount > maxIntakeDealCount) {
    throw new Error(`Количество сделок задаётся целым числом от ${minIntakeDealCount} до ${maxIntakeDealCount}.`);
  }

  if (!Number.isInteger(options.weeks) || options.weeks < minIntakeWeeks || options.weeks > maxIntakeWeeks) {
    throw new Error(`Количество недель задаётся целым числом от ${minIntakeWeeks} до ${maxIntakeWeeks}.`);
  }

  if (!options.repair && !options.spread && options.managerIds.length === 0) {
    throw new Error("Укажите --manager-ids: без ответственных датасет не разложит сделки по менеджерам.");
  }

  if (!/^VIBECODE_[A-Z_]{1,32}$/.test(options.namespace)) {
    throw new Error("--namespace должен начинаться с VIBECODE_ и содержать только заглавные латинские буквы и подчёркивание.");
  }

  if (options.managerIds.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new Error("--manager-ids должен содержать положительные числовые идентификаторы через запятую.");
  }

  return options;
}

export function createIntakeCompanyCalls(namespace = intakeSeedNamespace, count = companyNames.length, startIndex = 0) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Количество компаний должно быть целым положительным числом.");
  }

  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const name = `${companyNames[index % companyNames.length]}-${index + 1}`;
    return {
      id: `company-${offset + 1}`,
      entity: "companies",
      action: "create",
      params: {
        title: `${namespace}: ${name}`,
        comments: "Отдельный клиент под одну новую сделку.",
        xmlId: `${namespace}:company:${index + 1}`
      }
    };
  });
}

export function createDateSpreadCalls(dealIds, { weeks = 8, now = new Date() } = {}) {
  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    throw new Error("Для раскладки дат нужен непустой список идентификаторов сделок.");
  }

  const weekStarts = buildWeekStarts(now, weeks);
  const reference = now instanceof Date ? now : new Date(now);
  const today = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));

  return dealIds.map((id, index) => {
    const dealId = Number(id);

    if (!Number.isInteger(dealId) || dealId < 1) {
      throw new Error("Идентификатор сделки должен быть целым положительным числом.");
    }

    const beginDate = new Date(weekStarts[index % weekStarts.length]);
    beginDate.setUTCDate(beginDate.getUTCDate() + (index % 5));

    if (beginDate.getTime() > today.getTime()) {
      beginDate.setTime(today.getTime());
    }

    return {
      id: `spread-${index + 1}`,
      entity: "deals",
      action: "update",
      entityId: dealId,
      params: { begindate: beginDate.toISOString() }
    };
  });
}

export function createIntakeRepairCalls(dealIds) {
  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    throw new Error("Для починки нужен непустой список идентификаторов сделок.");
  }

  return dealIds.map((id, index) => {
    const dealId = Number(id);

    if (!Number.isInteger(dealId) || dealId < 1) {
      throw new Error("Идентификатор сделки должен быть целым положительным числом.");
    }

    return {
      id: `repair-${index + 1}`,
      entity: "deals",
      action: "update",
      entityId: dealId,
      params: { companyId: 0, isReturning: false }
    };
  });
}

export function createIntakeDealCalls(companyResults, now = new Date(), {
  count = 360,
  managerIds = [],
  weeks = 8,
  namespace = intakeSeedNamespace,
  startIndex = 0
} = {}) {
  const companies = Object.values(companyResults || {});

  if (companies.length === 0 || companies.some((company) => !Number.isInteger(Number(company?.id)))) {
    throw new Error("Seed не получил идентификаторы созданных компаний.");
  }

  if (managerIds.length === 0) {
    throw new Error("Seed не получил идентификаторы ответственных.");
  }

  const weekStarts = buildWeekStarts(now, weeks);

  return Array.from({ length: count }, (_, index) => {
    const sequenceIndex = startIndex + index;
    const weekStart = weekStarts[sequenceIndex % weekStarts.length];
    const beginDate = new Date(weekStart);
    beginDate.setUTCDate(beginDate.getUTCDate() + (sequenceIndex % 5));

    return {
      id: `deal-${index + 1}`,
      entity: "deals",
      action: "create",
      params: {
        title: `${namespace}: сделка ${sequenceIndex + 1}`,
        companyId: Number(companies[index % companies.length].id),
        assignedById: Number(managerIds[sequenceIndex % managerIds.length]),
        amount: 40_000 + (sequenceIndex % 12) * 15_000,
        isManualOpportunity: true,
        currency: "RUB",
        stageId: stages[sequenceIndex % stages.length],
        begindate: beginDate.toISOString(),
        isReturning: false,
        comments: "Тестовая новая сделка для расчётного BI-датасета.",
        xmlId: `${namespace}:deal:${sequenceIndex + 1}`
      }
    };
  });
}

export function createIntakeSeedPlan({ dealCount, managerIds = [], weeks = 8, now = new Date(), startIndex = 0 }) {
  return {
    namespace: intakeSeedNamespace,
    companyCalls: createIntakeCompanyCalls(intakeSeedNamespace, dealCount, startIndex),
    existingCalls: createExistingDemoCalls(intakeSeedNamespace),
    createDeals: (companyResults) => createIntakeDealCalls(companyResults, now, {
      count: dealCount,
      managerIds,
      weeks,
      namespace: intakeSeedNamespace,
      startIndex
    })
  };
}

export function buildWeekStarts(now = new Date(), weeks = 8) {
  const date = now instanceof Date ? new Date(now) : new Date(now);

  if (Number.isNaN(date.getTime())) {
    throw new Error("now должен содержать корректную дату.");
  }

  const quarterStart = new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
  const currentMonday = getMonday(date);
  const starts = [];

  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    const candidate = new Date(currentMonday);
    candidate.setUTCDate(candidate.getUTCDate() - offset * 7);

    if (candidate.getTime() >= quarterStart.getTime()) {
      starts.push(candidate);
    }
  }

  return starts.length > 0 ? starts : [currentMonday];
}

function getMonday(value) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date;
}
