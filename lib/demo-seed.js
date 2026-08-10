export const demoNamespace = "VIBECODE_DEMO_BI";

export function createCompanyCalls(namespace = demoNamespace) {
  return ["Альфа", "Вектор", "Север"].map((name, index) => ({
    id: `company-${index + 1}`,
    entity: "companies",
    action: "create",
    params: {
      title: `${namespace}: ${name}`,
      comments: "Тестовая компания для демонстрации AI-дашборда.",
      xmlId: `${namespace}:company:${index + 1}`
    }
  }));
}

export function createDealCalls(companyResults, now = new Date(), { count = 28, managerIds = [], managerSequence = [], namespace = demoNamespace, startIndex = 0 } = {}) {
  const companies = Object.values(companyResults || {});

  if (companies.length < 3 || companies.some((company) => !Number.isInteger(Number(company?.id)))) {
    throw new Error("Seed не получил идентификаторы созданных компаний.");
  }

  const stages = ["NEW", "PREPARATION", "WON", "LOSE"];

  return Array.from({ length: count }, (_, index) => {
    const sequenceIndex = startIndex + index;
    const createdAt = new Date(now);
    createdAt.setMonth(createdAt.getMonth() - 6 - Math.floor(sequenceIndex / 4));
    const stageId = stages[sequenceIndex % stages.length];

    return {
      id: `deal-${index + 1}`,
      entity: "deals",
      action: "create",
      params: {
        title: `${namespace}: сделка ${sequenceIndex + 1}`,
        companyId: Number(companies[sequenceIndex % companies.length].id),
        ...(managerSequence.length > 0
          ? { assignedById: Number(managerSequence[index]) }
          : managerIds.length > 0 ? { assignedById: Number(managerIds[sequenceIndex % managerIds.length]) } : {}),
        amount: (sequenceIndex + 1) * 50_000,
        stageId,
        closedAt: createdAt.toISOString(),
        comments: "Тестовая сделка для демонстрации AI-дашборда.",
        xmlId: `${namespace}:deal:${sequenceIndex + 1}`
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

export function createExistingDemoCalls(namespace = demoNamespace) {
  return ["companies", "deals", "tasks"].map((entity) => ({
    id: `existing-${entity}`,
    entity,
    action: "list",
    params: {
      filter: { title: { "$contains": namespace } },
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
