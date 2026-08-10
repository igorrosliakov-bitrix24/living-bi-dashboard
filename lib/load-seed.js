import { createCompanyCalls, createDealCalls, createExistingDemoCalls } from "./demo-seed.js";

export const loadSeedNamespace = "VIBECODE_LOAD_BI";
export const minLoadDealCount = 100;
export const maxLoadDealCount = 2_000;

export function parseLoadSeedOptions(args) {
  const options = { confirmed: false, dealCount: 1_000, managerIds: [] };

  for (const argument of args) {
    if (argument === "--confirm") {
      options.confirmed = true;
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

    throw new Error(`Неизвестный параметр: ${argument}`);
  }

  if (!Number.isInteger(options.dealCount) || options.dealCount < minLoadDealCount || options.dealCount > maxLoadDealCount) {
    throw new Error(`Количество сделок задаётся целым числом от ${minLoadDealCount} до ${maxLoadDealCount}.`);
  }

  if (options.managerIds.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new Error("--manager-ids должен содержать положительные числовые идентификаторы через запятую.");
  }

  return options;
}

export function createLoadSeedPlan({ dealCount, managerIds = [], now = new Date() }) {
  return {
    namespace: loadSeedNamespace,
    companyCalls: createCompanyCalls(loadSeedNamespace),
    existingCalls: createExistingDemoCalls(loadSeedNamespace),
    createDeals: (companyResults) => createDealCalls(companyResults, now, {
      count: dealCount,
      managerIds,
      namespace: loadSeedNamespace
    })
  };
}
