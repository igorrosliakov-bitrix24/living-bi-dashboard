import { validateDatasetDraft } from "./dataset-draft.js";

const connectorTitle = "VibeCode AI Dataset Connector";
const sourceTitle = "VibeCode AI Dataset Source";
const logo = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iOCIgZmlsbD0iIzE1NmZlZiIvPjx0ZXh0IHg9IjI0IiB5PSIzMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE4IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Qkk8L3RleHQ+PC9zdmc+";
const bitrixFieldTypes = new Map([["integer", "int"], ["string", "string"], ["float", "double"], ["date", "date"], ["datetime", "datetime"]]);

export function getPublisherReadiness({ connectorBaseUrl, hasOauthState, hasClientId, hasClientSecret, adapterReachable, usesAdapterControl = false }) {
  const missing = [];
  try {
    normalizeConnectorBaseUrl(connectorBaseUrl);
  } catch {
    missing.push("публичный HTTPS-адрес adapter-сервиса (BI_CONNECTOR_BASE_URL)");
  }
  if (!usesAdapterControl && !hasOauthState) missing.push("сохранённое OAuth-состояние локального приложения");
  if (!usesAdapterControl && (!hasClientId || !hasClientSecret)) missing.push("client ID и client secret локального OAuth-приложения");
  if (adapterReachable === false) missing.push("публичный adapter, который отдаёт JSON без Gateway");

  return {
    ready: missing.length === 0,
    missing,
    message: missing.length === 0
      ? "Контур готов. Публикация создаст либо найдёт коннектор, источник и датасет с префиксом vibecode_ai_."
      : `До публикации настройте: ${missing.join(", ")}.`
  };
}

export async function publishDatasetDraft({ draft, client, connectorBaseUrl }) {
  const validation = validateDatasetDraft(draft);
  if (!validation.valid) throw new DatasetPublisherError("invalid_dataset_draft", validation.errors.join(" "));
  const baseUrl = normalizeConnectorBaseUrl(connectorBaseUrl);

  const datasets = normalizeList(await client.call("biconnector.dataset.list", {
    select: ["id", "name", "externalName", "externalCode", "sourceId"]
  }));
  const existingDataset = datasets.find((item) => item.name === draft.datasetName);
  if (existingDataset) {
    return { status: "already_published", datasetId: getCreatedId(existingDataset), datasetName: draft.datasetName };
  }

  const connectorId = await findOrCreateConnector(client, baseUrl);
  const sourceId = await findOrCreateSource(client, connectorId);
  const datasetId = getCreatedId(await client.call("biconnector.dataset.add", {
    fields: {
      sourceId,
      name: draft.datasetName,
      externalName: draft.title,
      externalCode: draft.datasetName,
      description: "Расчётный набор VibeCode AI: новые сделки по менеджерам и неделям за текущий квартал. Повторные сделки и воронки «Тест» исключены.",
      fields: draft.fields.map((field) => ({
        type: bitrixFieldTypes.get(field.type),
        name: field.code,
        externalCode: field.code
      }))
    }
  }));

  return { status: "published", datasetId, datasetName: draft.datasetName };
}

export function buildDatasetSchemaDiff(existingFields, desiredFields) {
  const existing = new Map(normalizeExistingFields(existingFields).map((field) => [field.name, field]));
  const desired = new Map(desiredFields.map((field) => [field.code, { name: field.code, type: bitrixFieldTypes.get(field.type) }]));
  const add = [...desired.values()].filter((field) => !existing.has(field.name));
  const remove = [...existing.values()].filter((field) => !desired.has(field.name));
  const incompatible = [...desired.values()].filter((field) => existing.has(field.name) && normalizeBitrixType(existing.get(field.name).type) !== field.type)
    .map((field) => ({ name: field.name, from: normalizeBitrixType(existing.get(field.name).type), to: field.type }));
  return { add, remove, incompatible, compatible: remove.length === 0 && incompatible.length === 0, changed: add.length > 0 || remove.length > 0 || incompatible.length > 0 };
}

export async function previewDynamicDatasetPublication({ draft, client }) {
  const validation = validateDatasetDraft(draft);
  if (!validation.valid) throw new DatasetPublisherError("invalid_dataset_draft", validation.errors.join(" "));
  const datasets = normalizeList(await client.call("biconnector.dataset.list", { select: ["id", "name", "externalName", "externalCode", "sourceId"] }));
  const existing = datasets.find((item) => item.name === draft.datasetName);
  if (!existing) return { action: "create", datasetName: draft.datasetName, diff: { add: draft.fields.map((field) => field.code), remove: [], incompatible: [] } };
  const details = await client.call("biconnector.dataset.get", { id: getCreatedId(existing) });
  const detailItem = details?.item || details;
  const diff = buildDatasetSchemaDiff(detailItem?.fields || existing.fields || [], draft.fields);
  return {
    action: diff.compatible ? (diff.changed ? "update" : "reuse") : "create_version",
    datasetName: draft.datasetName,
    datasetId: getCreatedId(existing),
    nextDatasetName: diff.compatible ? draft.datasetName : await findVersionName(draft.datasetName, datasets),
    diff: { add: diff.add.map((item) => item.name), remove: diff.remove.map((item) => item.name), incompatible: diff.incompatible }
  };
}

export async function publishDynamicDataset({ draft, client, connectorBaseUrl, adapterClient }) {
  if (!adapterClient) throw new DatasetPublisherError("missing_adapter_client", "Не настроена защищённая связь с adapter-сервисом.");
  const preview = await previewDynamicDatasetPublication({ draft, client });
  const datasetName = preview.nextDatasetName || preview.datasetName;
  const previous = await readRegistryRecord(adapterClient, datasetName);

  // Схема уже совпадает: ни один REST-вызов не нужен. Обновление датасета без
  // изменений Битрикс24 отклоняет как попытку тронуть неизменяемое поле.
  if (preview.action === "reuse") {
    await adapterClient.stage(datasetName, draft.spec);
    await adapterClient.activate(datasetName);
    return { status: "unchanged", datasetId: preview.datasetId, datasetName, action: preview.action, diff: preview.diff };
  }

  await adapterClient.stage(datasetName, draft.spec);
  try {
    let datasetId = preview.datasetId;
    if (preview.action === "create" || preview.action === "create_version") {
      const baseUrl = normalizeConnectorBaseUrl(connectorBaseUrl);
      const connectorId = await findOrCreateConnector(client, baseUrl);
      const sourceId = await findOrCreateSource(client, connectorId);
      datasetId = getCreatedId(await client.call("biconnector.dataset.add", { fields: datasetFields({ ...draft, datasetName }, sourceId) }));
    } else {
      if (preview.diff.add.length) {
        const additions = draft.fields.filter((field) => preview.diff.add.includes(field.code)).map(toBitrixField);
        await client.call("biconnector.dataset.fields.update", { id: datasetId, add: additions });
      }
      // externalName после создания менять нельзя: портал отвечает VALIDATION_IMMUTABLE_FIELD.
      await client.call("biconnector.dataset.update", { id: datasetId, fields: { description: buildDescription(draft) } });
    }
    await adapterClient.activate(datasetName);
    return { status: preview.action === "create" || preview.action === "create_version" ? "published" : "updated", datasetId, datasetName, action: preview.action, diff: preview.diff };
  } catch (error) {
    await rollbackRegistry(adapterClient, datasetName, previous, error).catch(() => {});
    throw error;
  }
}

export async function readRegistryRecord(adapterClient, datasetName) {
  try {
    const payload = await adapterClient.list();
    return (payload?.result || []).find((item) => item.datasetName === datasetName) || null;
  } catch {
    return null;
  }
}

// Неудачная публикация не должна ломать уже работающий набор: восстанавливаем
// предыдущую версию, а запись, которой раньше не было, убираем целиком.
export async function rollbackRegistry(adapterClient, datasetName, previous, error) {
  if (previous?.status === "active") {
    if (previous.spec) await adapterClient.stage(datasetName, previous.spec);
    await adapterClient.activate(datasetName);
    return { restored: "active" };
  }
  if (!previous) {
    await adapterClient.remove(datasetName);
    return { restored: "removed" };
  }
  await adapterClient.fail(datasetName, error?.code || "publication_failed");
  return { restored: "failed" };
}

export async function deleteDatasetDraft({ draft, client }) {
  const validation = validateDatasetDraft(draft);
  if (!validation.valid) throw new DatasetPublisherError("invalid_dataset_draft", validation.errors.join(" "));
  if (!draft.datasetName.startsWith("vibecode_ai_")) {
    throw new DatasetPublisherError("unsafe_dataset_name", "Удалять можно только датасеты с префиксом vibecode_ai_.");
  }
  const datasets = normalizeList(await client.call("biconnector.dataset.list", { select: ["id", "name"] }));
  const existing = datasets.find((item) => item.name === draft.datasetName);
  if (!existing) return { status: "not_found", datasetName: draft.datasetName };
  const datasetId = getCreatedId(existing);
  await client.call("biconnector.dataset.delete", { id: datasetId });
  return { status: "deleted", datasetId, datasetName: draft.datasetName };
}

// Реестр адаптера ведёт само приложение, но набор могут удалить вручную в портале.
// Без сверки такой набор остаётся в списке управляемых и в выборе «Куда применить запрос».
export function reconcileManagedDatasets(records, portalDatasetNames) {
  const present = new Set(normalizeList(portalDatasetNames));
  const active = normalizeList(records).filter((item) => item?.status === "active");
  return {
    datasets: active.filter((item) => present.has(item.datasetName)),
    missing: active.filter((item) => !present.has(item.datasetName)).map((item) => item.datasetName)
  };
}

export async function listPortalDatasetNames(client) {
  const datasets = normalizeList(await client.call("biconnector.dataset.list", { select: ["id", "name"] }));
  return datasets.map((item) => item?.name).filter(Boolean);
}

export class DatasetPublisherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DatasetPublisherError";
    this.code = code;
  }
}

async function findOrCreateConnector(client, connectorBaseUrl) {
  const connectors = normalizeList(await client.call("biconnector.connector.list", { select: ["id", "title"] }));
  const existing = connectors.find((item) => item.title === connectorTitle);
  if (existing) return getCreatedId(existing);
  return getCreatedId(await client.call("biconnector.connector.add", {
    fields: {
      title: connectorTitle,
      logo,
      description: "Коннектор расчётных датасетов VibeCode AI.",
      urlCheck: `${connectorBaseUrl}/bi-connector/check`,
      urlTableList: `${connectorBaseUrl}/bi-connector/tables`,
      urlTableDescription: `${connectorBaseUrl}/bi-connector/table-description`,
      urlData: `${connectorBaseUrl}/bi-connector/data`,
      settings: []
    }
  }));
}

async function findOrCreateSource(client, connectorId) {
  const sources = normalizeList(await client.call("biconnector.source.list", { select: ["id", "title", "connectorId"] }));
  const existing = sources.find((item) => item.title === sourceTitle && Number(item.connectorId) === Number(connectorId));
  if (existing) return getCreatedId(existing);
  return getCreatedId(await client.call("biconnector.source.add", {
    fields: {
      title: sourceTitle,
      description: "Источник проверенных расчётных наборов для BI-конструктора.",
      connectorId,
      settings: {}
    }
  }));
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function datasetFields(draft, sourceId) {
  return { sourceId, name: draft.datasetName, externalName: draft.title, externalCode: draft.datasetName, description: buildDescription(draft), fields: draft.fields.map(toBitrixField) };
}
function toBitrixField(field) { return { type: bitrixFieldTypes.get(field.type), name: field.code, externalCode: field.code }; }
function buildDescription(draft) { return `Расчётный набор VibeCode AI. ${draft.formula} Период: ${draft.period}. Фильтры: ${draft.filters.join("; ")}.`; }
function normalizeExistingFields(value) {
  const fields = Array.isArray(value) ? value : Object.values(value || {});
  return fields.map((field) => ({ name: field.name || field.externalCode || field.code, type: field.type })).filter((field) => field.name);
}
function normalizeBitrixType(value) {
  const type = String(value || "").toLowerCase();
  if (["int", "integer"].includes(type)) return "int";
  if (["double", "float", "number"].includes(type)) return "double";
  return type;
}
async function findVersionName(base, datasets) {
  const names = new Set(datasets.map((item) => item.name));
  for (let version = 2; version < 100; version += 1) {
    const candidate = `${base}_v${version}`;
    if (!names.has(candidate)) return candidate;
  }
  throw new DatasetPublisherError("dataset_version_limit", "Не удалось подобрать безопасное имя новой версии датасета.");
}

function getCreatedId(result) {
  const unwrapped = result?.result ?? result;
  const id = typeof unwrapped === "object" && unwrapped !== null ? unwrapped.id : unwrapped;
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
    throw new DatasetPublisherError("invalid_bitrix_id", "Битрикс24 не вернул идентификатор объекта.");
  }
  return Number(id);
}

function normalizeConnectorBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new DatasetPublisherError("missing_connector_url", "Добавьте BI_CONNECTOR_BASE_URL: публичный HTTPS-адрес adapter-сервиса.");
  }
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new DatasetPublisherError("invalid_connector_url", "BI_CONNECTOR_BASE_URL должен быть HTTPS-адресом без пути и параметров.");
  }
  return url.toString().replace(/\/$/, "");
}
