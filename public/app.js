const form = document.querySelector("#aiCommandForm");
const textarea = document.querySelector("#aiCommand");
const reportList = document.querySelector("#reportList");
const sourceTitle = document.querySelector("#sourceTitle");
const sourceDescription = document.querySelector("#sourceDescription");
const sourceExamples = document.querySelector("#sourceExamples");
const metricRow = document.querySelector("#metricRow");
const chartBars = document.querySelector("#chartBars");
const dashboardName = document.querySelector("#dashboardName");
const dashboardScope = document.querySelector("#dashboardScope");
const chartTitle = document.querySelector("#chartTitle");
const refreshDataButton = document.querySelector("#refreshData");
const refreshStatus = document.querySelector("#refreshStatus");
const visualEditor = document.querySelector("#visualEditor");
const dashboardTitleInput = document.querySelector("#dashboardTitleInput");
const chartTitleInput = document.querySelector("#chartTitleInput");
const chartSortInput = document.querySelector("#chartSortInput");
const chartGroupByInput = document.querySelector("#chartGroupByInput");
const chartOrientationInput = document.querySelector("#chartOrientationInput");
const chartPaletteInput = document.querySelector("#chartPaletteInput");
const dashboardPeriodInput = document.querySelector("#dashboardPeriodInput");
const resetDashboardButton = document.querySelector("#resetDashboard");
const editorStatus = document.querySelector("#editorStatus");
const editorMessage = document.querySelector("#editorMessage");
const unsavedChanges = document.querySelector("#unsavedChanges");
const aiStatus = document.querySelector("#aiStatus");
const aiProposalPanel = document.querySelector("#aiProposal");
const aiSummary = document.querySelector("#aiSummary");
const aiChanges = document.querySelector("#aiChanges");
const applyAiProposal = document.querySelector("#applyAiProposal");
const developmentRequestPanel = document.querySelector("#developmentRequest");
const developmentReason = document.querySelector("#developmentReason");
const developmentRequestText = document.querySelector("#developmentRequestText");
const copyDevelopmentRequest = document.querySelector("#copyDevelopmentRequest");
const developmentCopyStatus = document.querySelector("#developmentCopyStatus");
const versionCount = document.querySelector("#versionCount");
const versionList = document.querySelector("#versionList");
const versionMessage = document.querySelector("#versionMessage");
const datasetDraftForm = document.querySelector("#datasetDraftForm");
const datasetRequest = document.querySelector("#datasetRequest");
const datasetTarget = document.querySelector("#datasetTarget");
const datasetDraftStatus = document.querySelector("#datasetDraftStatus");
const datasetDraftMessage = document.querySelector("#datasetDraftMessage");
const datasetDraftPreview = document.querySelector("#datasetDraftPreview");
const datasetDraftTitle = document.querySelector("#datasetDraftTitle");
const datasetDraftDescription = document.querySelector("#datasetDraftDescription");
const datasetPlannerSummary = document.querySelector("#datasetPlannerSummary");
const datasetDraftSource = document.querySelector("#datasetDraftSource");
const datasetDraftPeriod = document.querySelector("#datasetDraftPeriod");
const datasetDraftFilters = document.querySelector("#datasetDraftFilters");
const datasetDraftFormula = document.querySelector("#datasetDraftFormula");
const datasetDraftFields = document.querySelector("#datasetDraftFields");
const confirmDatasetDraft = document.querySelector("#confirmDatasetDraft");
const datasetConfirmMessage = document.querySelector("#datasetConfirmMessage");
const datasetPublishPanel = document.querySelector("#datasetPublishPanel");
const datasetPublishReadiness = document.querySelector("#datasetPublishReadiness");
const datasetPublicationPreview = document.querySelector("#datasetPublicationPreview");
const publishDataset = document.querySelector("#publishDataset");
const datasetPublishMessage = document.querySelector("#datasetPublishMessage");
const datasetSynchronization = document.querySelector("#datasetSynchronization");
const refreshDatasetSynchronization = document.querySelector("#refreshDatasetSynchronization");
const refreshDatasetData = document.querySelector("#refreshDatasetData");
const deleteDataset = document.querySelector("#deleteDataset");
const datasetDeleteMessage = document.querySelector("#datasetDeleteMessage");
let dashboardSpec;
let aiProposal;
let developmentRequest;
let selectedEntity = "deals";
let availableEntities = [];
let demoSources = {};
let currentDatasetDraft;
const placementMemberId = new URLSearchParams(window.location.search).get("member_id");

function apiFetch(input, init = {}) {
  const headers = placementMemberId
    ? { ...init.headers, "X-Dashboard-Member-Id": placementMemberId }
    : init.headers;
  return fetch(input, { ...init, headers });
}

loadAvailableEntities();
loadDashboardSpec();
loadDashboardData();
loadManagedDatasets();

async function loadAvailableEntities() {
  try {
    const response = await apiFetch("/api/entities");
    const payload = await response.json();

    if (!response.ok || !Array.isArray(payload.entities)) {
      throw new Error("Не удалось получить список сущностей.");
    }

    availableEntities = payload.entities;
    renderEntityList();
    await loadDemoData();
  } catch (error) {
    reportList.textContent = `Ошибка загрузки: ${error.message}`;
  }
}

function renderEntityList() {
  reportList.replaceChildren(...availableEntities.map((entity) => {
    const button = document.createElement("button");
    button.className = `report${entity.code === selectedEntity ? " active" : ""}`;
    button.type = "button";

    const title = document.createElement("span");
    title.textContent = entity.title;
    const description = document.createElement("small");
    description.textContent = entity.code === "deals" ? "Используется в текущем отчёте" : "Доступно для нового виджета";

    button.append(title, description);
    button.addEventListener("click", () => {
      selectedEntity = entity.code;
      renderEntityList();
      renderSourceContext();
    });
    return button;
  }));
}

async function loadDemoData() {
  try {
    const response = await apiFetch("/api/demo-data");
    const payload = await response.json();

    if (!response.ok || !payload.sources) {
      throw new Error(payload.message || "Не удалось получить тестовые данные.");
    }

    demoSources = payload.sources;
    renderSourceContext();
  } catch (error) {
    sourceDescription.textContent = error.message;
  }
}

function renderSourceContext() {
  const entity = availableEntities.find((item) => item.code === selectedEntity);
  const records = demoSources[selectedEntity] || [];
  const usesEntity = dashboardSpec?.widgets.some((widget) => widget.entity === selectedEntity);

  sourceTitle.textContent = entity?.title || "Данные";
  sourceDescription.textContent = usesEntity
    ? "Текущий отчёт строится по этой сущности. Ниже показаны созданные тестовые записи."
    : "Эта сущность доступна для следующего виджета. Ниже показаны созданные тестовые записи.";
  sourceExamples.replaceChildren(...records.slice(0, 4).map((record) => {
    const item = document.createElement("li");
    const details = [record.stageId, record.amount ? `${formatNumber(record.amount)} руб.` : null, record.deadline ? formatDate(record.deadline) : null]
      .filter(Boolean)
      .join(" · ");
    item.textContent = details ? `${record.title} (${details})` : record.title;
    return item;
  }));

  if (records.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Для этой сущности тестовые записи пока не созданы.";
    sourceExamples.append(item);
  }
}

async function loadDashboardData(refresh = false) {
  if (refresh) {
    refreshDataButton.disabled = true;
    refreshStatus.textContent = "Обновляем показатели из портала...";
  }

  try {
    const response = await apiFetch(`/api/dashboard/data${refresh ? "?refresh=1" : ""}`);
    const payload = await response.json();

    if (!response.ok || !Array.isArray(payload.widgets)) {
      throw new Error(payload.message || "Не удалось получить агрегаты.");
    }

    renderDashboardData(payload.widgets, payload.warnings);
    if (refresh) {
      refreshStatus.textContent = "Показатели обновлены.";
    }
  } catch (error) {
    chartBars.textContent = `Данные пока недоступны: ${error.message}`;
    if (refresh) {
      refreshStatus.textContent = "Не удалось обновить показатели.";
    }
  } finally {
    if (refresh) {
      refreshDataButton.disabled = false;
    }
  }
}

refreshDataButton.addEventListener("click", () => loadDashboardData(true));

function renderDashboardData(widgets, warnings = []) {
  if (dashboardSpec) {
    dashboardScope.textContent = `В отчёте: ${dashboardSpec.widgets.length} виджета · период: ${formatPeriod(dashboardSpec.period?.preset)} · данные: ${[...new Set(dashboardSpec.widgets.filter((widget) => widget.entity).map((widget) => widget.entity))].join(", ")}`;
  }

  const kpis = widgets.filter((widget) => widget.type === "kpi");

  metricRow.replaceChildren(
    ...kpis.map((widget) => {
      const card = document.createElement("article");
      const title = document.createElement("span");
      title.textContent = widget.title;
      const value = document.createElement("strong");
      value.textContent = formatWidgetValue(widget);
      card.append(title, value);
      return card;
    })
  );

  const visuals = widgets.filter((widget) => widget.type !== "kpi");
  chartTitle.textContent = visuals.length > 0 ? "Виджеты отчёта" : "Графики отсутствуют";
  chartBars.replaceChildren(...visuals.map(renderWidget));

  if (widgets.some((widget) => widget.truncated)) {
    dashboardScope.textContent = `${dashboardScope.textContent} · данные ограничены выборкой`;
  }

  if (Array.isArray(warnings) && warnings.length > 0) {
    dashboardScope.textContent = `${dashboardScope.textContent} · ${warnings.join(" ")}`;
  }
}

function renderWidget(widget) {
  const panel = document.createElement("article");
  panel.className = "visual-widget";
  const title = document.createElement("h3");
  title.textContent = widget.title;
  panel.append(title);

  if (widget.type === "bar") {
    panel.append(renderBar(widget));
  } else if (widget.type === "line") {
    panel.append(renderLine(widget));
  } else if (widget.type === "pie" || widget.type === "donut") {
    panel.append(renderPie(widget));
  } else if (widget.type === "table") {
    panel.append(renderTable(widget));
  } else {
    const message = document.createElement("p");
    message.className = "editor-message";
    message.textContent = "Для этого типа виджета пока нет данных.";
    panel.append(message);
  }

  return panel;
}

function renderBar(widget) {
  const container = document.createElement("div");
  const horizontal = widget.options?.orientation === "horizontal";
  container.className = `bars ${horizontal ? "bars-horizontal" : "bars-vertical"}`;
  const maxValue = Math.max(...widget.groups.map((group) => group.value), 1);

  for (const [index, group] of widget.groups.entries()) {
    const item = document.createElement("div");
    item.className = "bar-item";
    const barValue = document.createElement("span");
    const value = Math.max((group.value / maxValue) * 100, 3);
    if (horizontal) {
      barValue.style.width = `${value}%`;
    } else {
      barValue.style.height = `${Math.max(value, 8)}%`;
    }
    barValue.style.background = getWidgetColor(widget, index);
    barValue.title = `${group.label}: ${formatNumber(group.value)}`;
    const label = document.createElement("small");
    label.textContent = `${group.label} (${formatNumber(group.value)})`;
    item.append(label, barValue);
    container.append(item);
  }

  return container;
}

function renderLine(widget) {
  const wrapper = document.createElement("div");
  wrapper.className = "line-chart";
  const maxValue = Math.max(...widget.groups.map((group) => group.value), 1);
  const points = widget.groups.map((group, index) => {
    const x = widget.groups.length === 1 ? 50 : (index / (widget.groups.length - 1)) * 100;
    const y = 100 - ((group.value / maxValue) * 84 + 8);
    return `${x},${y}`;
  }).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", points);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", getWidgetColor(widget, 0));
  line.setAttribute("stroke-width", "3");
  svg.append(line);
  wrapper.append(svg, createLegend(widget));
  return wrapper;
}

function renderPie(widget) {
  const wrapper = document.createElement("div");
  wrapper.className = "pie-layout";
  const total = widget.groups.reduce((sum, group) => sum + group.value, 0) || 1;
  let current = 0;
  const stops = widget.groups.map((group, index) => {
    const start = current;
    current += (group.value / total) * 100;
    const color = getWidgetColor(widget, index);
    return `${color} ${start}% ${current}%`;
  });
  const pie = document.createElement("div");
  pie.className = `pie-chart ${widget.type === "donut" ? "pie-donut" : ""}`;
  pie.style.background = `conic-gradient(${stops.join(", ")})`;
  wrapper.append(pie, createLegend(widget));
  return wrapper;
}

function renderTable(widget) {
  const table = document.createElement("table");
  table.className = "data-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Группа</th><th>Значение</th></tr>";
  const body = document.createElement("tbody");
  for (const group of widget.groups) {
    const row = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = group.label;
    const value = document.createElement("td");
    value.textContent = formatNumber(group.value);
    row.append(label, value);
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function createLegend(widget) {
  const legend = document.createElement("ul");
  legend.className = "chart-legend";
  for (const [index, group] of widget.groups.entries()) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.style.background = getWidgetColor(widget, index);
    item.append(swatch, document.createTextNode(`${group.label}: ${formatNumber(group.value)}`));
    legend.append(item);
  }
  return legend;
}

function getWidgetColor(widget, index) {
  const colors = widget.colors?.length ? widget.colors : ["#2fc6f6"];
  return colors[index % colors.length];
}

function formatWidgetValue(widget) {
  if (widget.format === "percent") {
    return `${(widget.value * 100).toFixed(1)}%`;
  }

  return formatNumber(widget.value);
}

async function loadDashboardSpec() {
  try {
    const response = await apiFetch("/api/dashboard");
    const payload = await response.json();

    if (!response.ok || !payload.dashboard) {
      throw new Error(payload.message || "Не удалось загрузить настройки отчёта.");
    }

    dashboardSpec = payload.dashboard;
    renderDashboardEditor();
    await loadVersionHistory();
  } catch (error) {
    editorStatus.textContent = "Ошибка загрузки";
    editorStatus.className = "status status-error";
    editorMessage.textContent = error.message;
  }
}

async function loadVersionHistory() {
  try {
    const response = await apiFetch("/api/dashboard/versions");
    const payload = await response.json();

    if (!response.ok || !Array.isArray(payload.versions)) {
      throw new Error(payload.message || "Не удалось загрузить историю версий.");
    }

    renderVersionHistory(payload.versions);
  } catch (error) {
    versionCount.textContent = "Ошибка";
    versionCount.className = "status status-error";
    versionMessage.textContent = error.message;
  }
}

function renderVersionHistory(versions) {
  versionCount.textContent = `${versions.length} ${pluralizeVersion(versions.length)}`;
  versionCount.className = "status status-neutral";
  versionList.replaceChildren(...versions.map((version) => {
    const item = document.createElement("li");
    item.className = "version-item";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `Версия ${version.version}${version.current ? " (текущая)" : ""}`;
    const description = document.createElement("small");
    description.textContent = `${version.title}; виджетов: ${version.widgetCount}`;
    details.append(title, description);
    item.append(details);

    if (!version.current) {
      const restoreButton = document.createElement("button");
      restoreButton.type = "button";
      restoreButton.className = "secondary-button";
      restoreButton.textContent = `Вернуться к версии ${version.version}`;
      restoreButton.addEventListener("click", () => restoreDashboard(version.version));
      item.append(restoreButton);
    }

    return item;
  }));
}

async function restoreDashboard(version) {
  if (!dashboardSpec) {
    return;
  }

  versionMessage.textContent = `Восстанавливаем версию ${version}...`;

  try {
    const response = await apiFetch("/api/dashboard/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, expectedVersion: dashboardSpec.version })
    });
    const payload = await response.json();

    if (response.status === 409) {
      await loadDashboardSpec();
      versionMessage.textContent = "Отчёт уже изменился. Загружена актуальная история.";
      return;
    }

    if (!response.ok || !payload.saved) {
      throw new Error(payload.message || "Не удалось восстановить версию.");
    }

    dashboardSpec = payload.dashboard;
    renderDashboardEditor();
    await Promise.all([loadDashboardData(), loadVersionHistory()]);
    versionMessage.textContent = `Текущей стала версия ${version}. История изменений сохранена.`;
  } catch (error) {
    versionMessage.textContent = error.message;
  }
}

function renderDashboardEditor() {
  const bar = dashboardSpec.widgets.find((widget) => widget.type === "bar");
  dashboardName.textContent = dashboardSpec.title;
  dashboardScope.textContent = `В отчёте: ${dashboardSpec.widgets.length} виджета · период: ${formatPeriod(dashboardSpec.period?.preset)} · данные: ${[...new Set(dashboardSpec.widgets.map((widget) => widget.entity))].join(", ")}`;
  dashboardTitleInput.value = dashboardSpec.title;
  chartTitleInput.value = bar?.title || "";
  chartSortInput.value = bar?.options?.sort || "desc";
  chartGroupByInput.value = bar?.groupBy?.[0] || "stageId";
  chartOrientationInput.value = bar?.options?.orientation || "vertical";
  chartPaletteInput.value = bar?.options?.palette || "bitrix24";
  dashboardPeriodInput.value = dashboardSpec.period?.preset || "all_time";
  editorStatus.textContent = `Версия ${dashboardSpec.version}`;
  editorStatus.className = "status status-success";
  editorMessage.textContent = "";
  updateUnsavedChanges();
  renderEntityList();
  renderSourceContext();
}

for (const input of visualEditor.querySelectorAll("input, select")) {
  input.addEventListener("input", updateUnsavedChanges);
  input.addEventListener("change", updateUnsavedChanges);
}

function updateUnsavedChanges() {
  if (!dashboardSpec) {
    unsavedChanges.hidden = true;
    return;
  }

  const bar = dashboardSpec.widgets.find((widget) => widget.type === "bar");
  const hasChanges = dashboardTitleInput.value.trim() !== dashboardSpec.title
    || chartTitleInput.value.trim() !== (bar?.title || "")
    || chartSortInput.value !== (bar?.options?.sort || "desc")
    || chartGroupByInput.value !== (bar?.groupBy?.[0] || "stageId")
    || chartOrientationInput.value !== (bar?.options?.orientation || "vertical")
    || chartPaletteInput.value !== (bar?.options?.palette || "bitrix24")
    || dashboardPeriodInput.value !== (dashboardSpec.period?.preset || "all_time");

  unsavedChanges.hidden = !hasChanges;
}

visualEditor.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!dashboardSpec) {
    return;
  }

  const nextDashboard = structuredClone(dashboardSpec);
  const bar = nextDashboard.widgets.find((widget) => widget.type === "bar");
  nextDashboard.title = dashboardTitleInput.value.trim();
  nextDashboard.period = { ...nextDashboard.period, preset: dashboardPeriodInput.value };

  if (bar) {
    bar.title = chartTitleInput.value.trim();
    bar.groupBy = [chartGroupByInput.value];
    bar.options = {
      ...bar.options,
      sort: chartSortInput.value,
      orientation: chartOrientationInput.value,
      palette: chartPaletteInput.value
    };
  }

  try {
    await persistDashboard(nextDashboard, editorMessage);
  } catch (error) {
    editorStatus.textContent = "Ошибка сохранения";
    editorStatus.className = "status status-error";
    editorMessage.textContent = error.message;
  }
});

resetDashboardButton.addEventListener("click", async () => {
  if (!dashboardSpec || !window.confirm("Начать новый дашборд? История версий будет очищена.")) {
    return;
  }

  try {
    const response = await apiFetch("/api/dashboard/reset", { method: "POST" });
    const payload = await response.json();

    if (!response.ok || !payload.saved) {
      throw new Error(payload.message || "Не удалось создать новый дашборд.");
    }

    dashboardSpec = payload.dashboard;
    renderDashboardEditor();
    await Promise.all([loadDashboardData(), loadVersionHistory()]);
    editorMessage.textContent = "Создан новый дашборд с первой версией.";
  } catch (error) {
    editorMessage.textContent = error.message;
  }
});

async function persistDashboard(nextDashboard, messageTarget) {
  editorStatus.textContent = "Сохраняем";
  editorStatus.className = "status status-neutral";
  messageTarget.textContent = "";
  const response = await apiFetch("/api/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dashboard: nextDashboard, expectedVersion: dashboardSpec.version })
  });
  const payload = await response.json();

  if (response.status === 409) {
    await loadDashboardSpec();
    throw new Error("Кто-то уже сохранил другую версию. Загружены актуальные настройки.");
  }

  if (!response.ok || !payload.saved) {
    throw new Error(payload.message || "Изменение не сохранено.");
  }

  dashboardSpec = payload.dashboard;
  renderDashboardEditor();
  await Promise.all([loadDashboardData(), loadVersionHistory()]);
}

function pluralizeVersion(count) {
  if (count % 10 === 1 && count % 100 !== 11) {
    return "версия";
  }

  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) {
    return "версии";
  }

  return "версий";
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

const resizeObserver = new ResizeObserver(() => {
  window.parent.postMessage({ type: "vibe:resize", height: document.documentElement.scrollHeight }, "*");
});

resizeObserver.observe(document.documentElement);

function formatPeriod(preset) {
  return {
    all_time: "за всё время",
    this_month: "этот месяц",
    this_quarter: "этот квартал",
    this_year: "этот год"
  }[preset] || "не задан";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const command = textarea.value.trim();

  if (!command) {
    aiStatus.textContent = "Введите команду для ИИ.";
    return;
  }

  if (!dashboardSpec) {
    aiStatus.textContent = "Настройки отчёта ещё загружаются.";
    return;
  }

  aiStatus.textContent = "BitrixGPT готовит черновик...";
  aiProposalPanel.hidden = true;
  developmentRequestPanel.hidden = true;
  aiProposal = undefined;
  developmentRequest = undefined;
  developmentCopyStatus.textContent = "";

  try {
    const response = await apiFetch("/api/dashboard/ai-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, expectedVersion: dashboardSpec.version })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "ИИ не подготовил изменение.");
    }

    if (payload.developmentRequest) {
      developmentRequest = payload.developmentRequest;
      developmentReason.textContent = developmentRequest.reason;
      developmentRequestText.value = developmentRequest.markdown;
      developmentRequestPanel.hidden = false;
      aiStatus.textContent = "Для этого запроса нужна доработка приложения. Заявка готова к передаче агенту разработки.";
      return;
    }

    if (!payload.proposal) {
      throw new Error(payload.message || "ИИ не подготовил изменение.");
    }

    aiProposal = payload.proposal;
    aiSummary.textContent = aiProposal.summary;
    aiChanges.replaceChildren(...aiProposal.changes.map((change) => {
      const item = document.createElement("li");
      item.textContent = change;
      return item;
    }));
    aiStatus.textContent = "Черновик готов. Проверьте изменения перед применением.";
    aiProposalPanel.hidden = false;
  } catch (error) {
    aiStatus.textContent = error.message;
  }
});

copyDevelopmentRequest.addEventListener("click", async () => {
  if (!developmentRequest?.markdown) {
    return;
  }

  try {
    await navigator.clipboard.writeText(developmentRequest.markdown);
    developmentCopyStatus.textContent = "Заявка скопирована. Её можно передать агенту разработки.";
  } catch {
    developmentRequestText.focus();
    developmentRequestText.select();
    const copied = document.execCommand("copy");
    developmentCopyStatus.textContent = copied
      ? "Заявка скопирована. Её можно передать агенту разработки."
      : "Выделите текст заявки и скопируйте его вручную.";
  }
});

applyAiProposal.addEventListener("click", async () => {
  if (!aiProposal) {
    return;
  }

  if (aiProposal.dashboard.version !== dashboardSpec.version) {
    aiStatus.textContent = "Настройки отчёта уже изменились. Подготовьте предложение ИИ заново.";
    aiProposalPanel.hidden = true;
    aiProposal = undefined;
    return;
  }

  try {
    await persistDashboard(aiProposal.dashboard, aiStatus);
    aiStatus.textContent = "Предложение ИИ применено как новая версия.";
    aiProposalPanel.hidden = true;
    textarea.value = "";
    aiProposal = undefined;
  } catch (error) {
    aiStatus.textContent = error.message;
  }
});

datasetDraftForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const request = datasetRequest.value.trim();
  currentDatasetDraft = undefined;
  datasetDraftMessage.textContent = "BitrixGPT анализирует запрос и готовит разрешённый рецепт...";
  datasetDraftPreview.hidden = true;
  datasetPublishPanel.hidden = true;
  datasetPublishMessage.textContent = "";
  datasetPublicationPreview.textContent = "Сначала будет выполнено безопасное сравнение схемы с Битрикс24.";
  datasetDraftStatus.textContent = "Подготавливаем";
  try {
    const response = await apiFetch("/api/datasets/ai-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request, targetDatasetName: datasetTarget.value || undefined })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "BitrixGPT не подготовил черновик.");
    if (payload.development) {
      datasetDraftStatus.textContent = "Нужна доработка";
      datasetDraftMessage.textContent = payload.development.reason;
      return;
    }
    currentDatasetDraft = payload.draft;
    renderDatasetDraft(currentDatasetDraft);
    datasetDraftStatus.textContent = "Preview готов";
    datasetDraftMessage.textContent = "BitrixGPT подготовил спецификацию. Сервер проверил её по разрешённому каталогу возможностей.";
    datasetConfirmMessage.textContent = "";
    datasetDraftPreview.hidden = false;
  } catch (error) {
    datasetDraftStatus.textContent = "Ошибка";
    datasetDraftMessage.textContent = error.message;
  }
});

confirmDatasetDraft.addEventListener("click", async () => {
  if (!currentDatasetDraft) return;
  confirmDatasetDraft.disabled = true;
  datasetConfirmMessage.textContent = "Сохраняем черновик...";
  try {
    const response = await apiFetch("/api/datasets/draft/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: currentDatasetDraft })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Не удалось подтвердить черновик.");
    datasetDraftStatus.textContent = "Черновик подтверждён";
    datasetConfirmMessage.textContent = `${payload.record.message} ID: ${payload.record.id}.`;
    await loadDatasetPublisherReadiness();
    await loadDatasetPublicationPreview();
    await loadDatasetSynchronization();
    await loadManagedDatasets();
    datasetPublishPanel.hidden = false;
  } catch (error) {
    datasetConfirmMessage.textContent = error.message;
  } finally {
    confirmDatasetDraft.disabled = false;
  }
});

publishDataset.addEventListener("click", async () => {
  if (!currentDatasetDraft) return;
  if (!window.confirm(`Опубликовать датасет ${currentDatasetDraft.datasetName} в BI-конструкторе?`)) return;
  publishDataset.disabled = true;
  datasetPublishMessage.textContent = "Публикуем датасет в Битрикс24...";
  try {
    const response = await apiFetch("/api/datasets/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: currentDatasetDraft, confirmed: true })
    });
    const payload = await readApiPayload(response);
    if (!response.ok) throw new Error(payload.message || "Не удалось опубликовать датасет.");
    currentDatasetDraft.datasetName = payload.result.datasetName;
    renderDatasetDraft(currentDatasetDraft);
    const publicationStatuses = {
      published: "Датасет опубликован",
      updated: "Схема датасета обновлена",
      already_published: "Датасет уже опубликован"
    };
    datasetDraftStatus.textContent = publicationStatuses[payload.result.status] || "Публикация завершена";
    datasetPublishMessage.textContent = `Готово: ${payload.result.datasetName}, ID ${payload.result.datasetId}. Откройте Рабочее место аналитика.`;
    await loadDatasetSynchronization();
  } catch (error) {
    datasetPublishMessage.textContent = error.message;
    publishDataset.disabled = false;
  }
});

refreshDatasetSynchronization.addEventListener("click", () => loadDatasetSynchronization());
refreshDatasetData.addEventListener("click", async () => {
  if (!currentDatasetDraft) return;
  refreshDatasetData.disabled = true;
  datasetSynchronization.textContent = "Adapter пересчитывает данные из CRM...";
  try {
    const response = await apiFetch("/api/datasets/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ datasetName: currentDatasetDraft.datasetName }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Не удалось обновить данные.");
    datasetSynchronization.textContent = `Данные обновлены: ${payload.result.rowCount} строк, ${formatDateTime(payload.result.refreshedAt)}.`;
  } catch (error) { datasetSynchronization.textContent = error.message; }
  finally { refreshDatasetData.disabled = false; }
});

deleteDataset.addEventListener("click", async () => {
  if (!currentDatasetDraft || !window.confirm(`Удалить только датасет ${currentDatasetDraft.datasetName}? Графики на нём перестанут работать.`)) return;
  deleteDataset.disabled = true;
  datasetDeleteMessage.textContent = "Удаляем только опубликованный датасет...";
  try {
    const response = await apiFetch("/api/datasets/publish/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: currentDatasetDraft, confirmed: true })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Не удалось удалить датасет.");
    datasetDraftStatus.textContent = payload.result.status === "deleted" ? "Датасет удалён" : "Датасет не найден";
    datasetDeleteMessage.textContent = payload.result.status === "deleted"
      ? `Удалён ${payload.result.datasetName}, ID ${payload.result.datasetId}.`
      : "Датасет уже отсутствует — ничего не менялось.";
    // Список управляемых наборов заполняется при загрузке, после удаления его
    // надо перечитать, иначе исчезнувший набор остаётся в выпадающем списке.
    currentDatasetDraft = undefined;
    datasetPublishPanel.hidden = true;
    datasetDraftPreview.hidden = true;
    await loadManagedDatasets();
    datasetTarget.value = "";
    await loadDatasetSynchronization();
  } catch (error) {
    datasetDeleteMessage.textContent = error.message;
    deleteDataset.disabled = false;
  }
});

async function loadDatasetPublisherReadiness() {
  datasetPublishReadiness.textContent = "Проверяем готовность контура публикации...";
  datasetPublishMessage.textContent = "";
  publishDataset.disabled = true;
  try {
    const response = await apiFetch("/api/datasets/publish/readiness");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Не удалось проверить готовность публикации.");
    datasetPublishReadiness.textContent = payload.readiness.message;
    publishDataset.disabled = !payload.readiness.ready;
  } catch (error) {
    datasetPublishReadiness.textContent = error.message;
    publishDataset.disabled = true;
  }
}

const managedDatasets = new Map();

async function loadManagedDatasets() {
  try {
    const response = await apiFetch("/api/datasets/managed");
    const payload = await response.json();
    if (!response.ok) return;
    const selected = datasetTarget.value;
    managedDatasets.clear();
    for (const item of payload.datasets || []) managedDatasets.set(item.datasetName, item);
    const options = [createSelectOption("Создать новый датасет", ""), ...(payload.datasets || []).map((item) => createSelectOption(`${item.title} · ${item.datasetName}`, item.datasetName))];
    datasetTarget.replaceChildren(...options);
    if ([...datasetTarget.options].some((option) => option.value === selected)) datasetTarget.value = selected;
  } catch { /* Список необязателен для создания нового датасета. */ }
}

// Выбор уже опубликованного набора открывает управление им без обращения к
// модели: иначе после перезагрузки страницы до кнопок было не добраться.
async function selectManagedDataset() {
  const record = managedDatasets.get(datasetTarget.value);

  if (!record) {
    currentDatasetDraft = undefined;
    datasetDraftPreview.hidden = true;
    datasetPublishPanel.hidden = true;
    datasetDraftStatus.textContent = "Черновик не подготовлен";
    datasetDraftMessage.textContent = "";
    return;
  }

  if (!record.draft) {
    datasetDraftMessage.textContent = "Сохранённую спецификацию этого набора прочитать не удалось. Подготовьте запрос заново.";
    return;
  }

  currentDatasetDraft = record.draft;
  renderDatasetDraft(currentDatasetDraft);
  datasetDraftPreview.hidden = false;
  datasetDraftStatus.textContent = "Опубликованный набор";
  datasetDraftMessage.textContent = `Управление набором ${record.datasetName}. Спецификация восстановлена из реестра, обращение к BitrixGPT не требуется.`;
  datasetConfirmMessage.textContent = "";
  datasetPublishPanel.hidden = false;
  await loadDatasetPublisherReadiness();
  await loadDatasetPublicationPreview();
  await loadDatasetSynchronization();
}

datasetTarget.addEventListener("change", () => { selectManagedDataset(); });

function createSelectOption(label, value) {
  const option = document.createElement("option");
  option.textContent = label;
  option.value = value;
  return option;
}

async function loadDatasetPublicationPreview() {
  datasetPublicationPreview.textContent = "Сравниваем схему с опубликованными датасетами...";
  try {
    const response = await apiFetch("/api/datasets/publish/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: currentDatasetDraft }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Не удалось сравнить схему.");
    const labels = { create: "будет создан новый датасет", update: "будут добавлены совместимые поля", reuse: "схема уже совпадает", create_version: `будет создана новая версия ${payload.preview.nextDatasetName}` };
    const removed = payload.preview.diff.remove.join(", ") || "нет";
    const incompatible = payload.preview.diff.incompatible
      .map((item) => `${item.name}: ${item.from} → ${item.to}`)
      .join(", ") || "нет";
    datasetPublicationPreview.textContent = `План публикации: ${labels[payload.preview.action]}. Добавить: ${payload.preview.diff.add.join(", ") || "нет"}; удалить: ${removed}; изменить тип: ${incompatible}.`;
  } catch (error) { datasetPublicationPreview.textContent = error.message; }
}

async function readApiPayload(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return { message: response.ok ? "Сервер вернул ответ в неожиданном формате." : `Сервер публикации недоступен (HTTP ${response.status}).` };
}

async function loadDatasetSynchronization() {
  refreshDatasetSynchronization.disabled = true;
  datasetSynchronization.textContent = "Проверяем публичный adapter...";
  try {
    const response = await apiFetch("/api/datasets/publish/status");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Не удалось получить статус синхронизации.");
    const status = payload.synchronization;
    if (!status?.lastSuccessAt) {
      datasetSynchronization.textContent = `Adapter доступен. Последнего запроса BI-конструктора пока нет. OAuth-хранилище: ${payload.oauthStorage === "encrypted" ? "зашифровано" : "режим разработки"}.`;
      return;
    }
    datasetSynchronization.textContent = `Последнее успешное обращение BI-конструктора: ${formatDateTime(status.lastSuccessAt)}. Запросов после запуска: ${status.requests}.`;
  } catch (error) {
    datasetSynchronization.textContent = error.message;
  } finally {
    refreshDatasetSynchronization.disabled = false;
  }
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function renderDatasetDraft(draft) {
  datasetDraftTitle.textContent = `${draft.title} · ${draft.datasetName}`;
  datasetDraftDescription.textContent = draft.publication.message;
  datasetPlannerSummary.hidden = !draft.planner?.summary;
  datasetPlannerSummary.textContent = draft.planner?.summary ? `BitrixGPT: ${draft.planner.summary}` : "";
  datasetDraftSource.textContent = `${draft.source.entity}: ${draft.source.description}`;
  datasetDraftPeriod.textContent = ({ current_month: "Текущий месяц", current_quarter: "Текущий квартал", current_year: "Текущий год" })[draft.period] || draft.period;
  datasetDraftFilters.textContent = draft.filters.join("; ");
  datasetDraftFormula.textContent = draft.formula;
  datasetDraftFields.replaceChildren(...draft.fields.map((field) => {
    const item = document.createElement("div");
    item.className = "dataset-field";
    const name = document.createElement("code");
    name.textContent = field.code;
    const title = document.createElement("span");
    title.textContent = field.title;
    const type = document.createElement("small");
    type.textContent = field.type;
    item.append(name, title, type);
    return item;
  }));
}
