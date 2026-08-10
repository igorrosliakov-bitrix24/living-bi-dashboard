import { createCompanyCalls, createDealCalls, createExistingDemoCalls } from "./demo-seed.js";

export const loadSeedNamespace = "VIBECODE_LOAD_BI";
export const minLoadDealCount = 100;
export const maxLoadDealCount = 2_000;

export function parseLoadSeedOptions(args) {
  const options = { confirmed: false, dealCount: 1_000, managerIds: [], managerDistribution: [], resume: false };

  for (const argument of args) {
    if (argument === "--confirm") {
      options.confirmed = true;
      continue;
    }

    if (argument === "--resume") {
      options.resume = true;
      continue;
    }

    if (argument.startsWith("--deals=")) {
      options.dealCount = Number(argument.slice("--deals=".length));
      continue;
    }

    if (argument.startsWith("--manager-ids=")) {
      options.managerIds = argument.slice("--manager-ids=".length)
        .split(",")
        .filter(Boolean)
        .map((value) => Number(value));
      continue;
    }

    if (argument.startsWith("--manager-distribution=")) {
      options.managerDistribution = argument.slice("--manager-distribution=".length)
        .split(",")
        .filter(Boolean)
        .map(parseManagerDistribution);
      continue;
    }

    throw new Error(`Неизвестный параметр: ${argument}`);
  }

  if (!Number.isInteger(options.dealCount) || options.dealCount < minLoadDealCount || options.dealCount > maxLoadDealCount) {
    throw new Error(`Количество сделок задаётся целым числом от ${minLoadDealCount} до ${maxLoadDealCount}.`);
  }

  if (options.managerIds.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new Error("--manager-ids должен содержать положительные числовые идентификаторы через запятую.");
  }

  if (options.managerDistribution.some(({ id, count }) => !Number.isInteger(id) || id < 1 || !Number.isInteger(count) || count < 0)) {
    throw new Error("--manager-distribution должен содержать пары id:количество через запятую.");
  }

  if (options.managerDistribution.length > 0 && options.managerDistribution.reduce((sum, item) => sum + item.count, 0) !== options.dealCount) {
    throw new Error("Сумма --manager-distribution должна совпадать с --deals.");
  }

  return options;
}

export function createLoadSeedPlan({ dealCount, managerIds = [], managerSequence = [], now = new Date(), startIndex = 0 }) {
  return {
    namespace: loadSeedNamespace,
    companyCalls: createCompanyCalls(loadSeedNamespace),
    existingCalls: createExistingDemoCalls(loadSeedNamespace),
    createDeals: (companyResults) => createDealCalls(companyResults, now, {
      count: dealCount,
      managerIds,
      managerSequence,
      namespace: loadSeedNamespace,
      startIndex
    })
  };
}

function parseManagerDistribution(value) {
  const [id, count, extra] = value.split(":");

  if (extra !== undefined || !id || !count) {
    return { id: Number.NaN, count: Number.NaN };
  }

  return { id: Number(id), count: Number(count) };
}
