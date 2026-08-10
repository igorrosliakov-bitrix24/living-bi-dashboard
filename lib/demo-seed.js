export const demoNamespace = "VIBECODE_DEMO_BI";

export function createCompanyCalls() {
  return ["Альфа", "Вектор", "Север"].map((name, index) => ({
    id: `company-${index + 1}`,
    entity: "companies",
    action: "create",
    params: {
      title: `${demoNamespace}: ${name}`,
      comments: "Тестовая компания для демонстрации AI-дашборда.",
      xmlId: `${demoNamespace}:company:${index + 1}`
    }
  }));
}

export function createDealCalls(companyResults, now = new Date()) {
  const companies = Object.values(companyResults || {});

  if (companies.length < 3 || companies.some((company) => !Number.isInteger(Number(company?.id)))) {
    throw new Error("Seed не получил идентификаторы созданных компаний.");
  }

  const stages = ["NEW", "PREPARATION", "WON", "LOSE"];

  return Array.from({ length: 28 }, (_, index) => {
    const createdAt = new Date(now);
    createdAt.setMonth(createdAt.getMonth() - 6 - Math.floor(index / 4));
    const stageId = stages[index % stages.length];

    return {
      id: `deal-${index + 1}`,
      entity: "deals",
      action: "create",
      params: {
        title: `${demoNamespace}: сделка ${index + 1}`,
        companyId: Number(companies[index % companies.length].id),
        amount: (index + 1) * 50_000,
        stageId,
        closedAt: createdAt.toISOString(),
        comments: "Тестовая сделка для демонстрации AI-дашборда.",
        xmlId: `${demoNamespace}:deal:${index + 1}`
      }
    };
  });
}

export function createTaskCalls(responsibleId, now = new Date()) {
  if (!Number.isInteger(Number(responsibleId))) {
    throw new Error("Seed не получил идентификатор исполнителя задач.");
  }

  return Array.from({ length: 8 }, (_, index) => {
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + index - 3);

    return {
      id: `task-${index + 1}`,
      entity: "tasks",
      action: "create",
      params: {
        title: `${demoNamespace}: задача ${index + 1}`,
        description: "Тестовая задача для демонстрации AI-дашборда.",
        responsibleId: Number(responsibleId),
        deadline: deadline.toISOString(),
        priority: index % 2 === 0 ? 1 : 0,
        xmlId: `${demoNamespace}:task:${index + 1}`
      }
    };
  });
}

export function createExistingDemoCalls() {
  return ["companies", "deals", "tasks"].map((entity) => ({
    id: `existing-${entity}`,
    entity,
    action: "list",
    params: {
      filter: { title: { "$contains": demoNamespace } },
      select: ["id", "title"],
      limit: 1,
      withTotal: false
    }
  }));
}

export function hasExistingDemoRecords(results) {
  return Object.values(results || {}).some((records) => Array.isArray(records) && records.length > 0);
}

export function listExistingDemoEntities(results) {
  return Object.entries(results || {})
    .filter(([, records]) => Array.isArray(records) && records.length > 0)
    .map(([id]) => id.replace("existing-", ""));
}
