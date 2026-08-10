const form = document.querySelector("#aiCommandForm");
const textarea = document.querySelector("#aiCommand");
const authState = document.querySelector("#authState");
const reportList = document.querySelector("#reportList");
const sourceTitle = document.querySelector("#sourceTitle");
const sourceDescription = document.querySelector("#sourceDescription");
const sourceExamples = document.querySelector("#sourceExamples");
const metricRow = document.querySelector("#metricRow");
const chartBars = document.querySelector("#chartBars");
const dashboardName = document.querySelector("#dashboardName");
const dashboardScope = document.querySelector("#dashboardScope");
const chartTitle = document.querySelector("#chartTitle");
const visualEditor = document.querySelector("#visualEditor");
const dashboardTitleInput = document.querySelector("#dashboardTitleInput");
const chartTitleInput = document.querySelector("#chartTitleInput");
const chartSortInput = document.querySelector("#chartSortInput");
const dashboardPeriodInput = document.querySelector("#dashboardPeriodInput");
const resetDashboardButton = document.querySelector("#resetDashboard");
const editorStatus = document.querySelector("#editorStatus");
const editorMessage = document.querySelector("#editorMessage");
const aiStatus = document.querySelector("#aiStatus");
const aiProposalPanel = document.querySelector("#aiProposal");
const aiSummary = document.querySelector("#aiSummary");
const aiChanges = document.querySelector("#aiChanges");
const applyAiProposal = document.querySelector("#applyAiProposal");
const versionCount = document.querySelector("#versionCount");
const versionList = document.querySelector("#versionList");
const versionMessage = document.querySelector("#versionMessage");
let dashboardSpec;
let aiProposal;
let selectedEntity = "deals";
let availableEntities = [];
let demoSources = {};

checkSession();
loadAvailableEntities();
loadDashboardSpec();
loadDashboardData();

async function loadAvailableEntities() {
  try {
    const response = await fetch("/api/entities");
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
    const response = await fetch("/api/demo-data");
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
  try {
    const response = await fetch(`/api/dashboard/data${refresh ? "?refresh=1" : ""}`);
    const payload = await response.json();

    if (!response.ok || !Array.isArray(payload.widgets)) {
      throw new Error(payload.message || "Не удалось получить агрегаты.");
    }

    renderDashboardData(payload.widgets);
  } catch (error) {
    chartBars.textContent = `Данные пока недоступны: ${error.message}`;
  }
}

function renderDashboardData(widgets) {
  const kpis = widgets.filter((widget) => widget.type === "kpi");
  const bar = widgets.find((widget) => widget.type === "bar");

  metricRow.replaceChildren(
    ...kpis.map((widget) => {
      const card = document.createElement("article");
      const title = document.createElement("span");
      title.textContent = widget.title;
      const value = document.createElement("strong");
      value.textContent = formatNumber(widget.value);
      card.append(title, value);
      return card;
    })
  );

  if (!bar) {
    chartTitle.textContent = "График отсутствует";
    chartBars.textContent = "Для текущего отчёта нет столбчатого графика.";
    return;
  }

  chartTitle.textContent = bar.title;

  const maxValue = Math.max(...bar.groups.map((group) => group.value), 1);
  chartBars.replaceChildren(
    ...bar.groups.map((group) => {
      const item = document.createElement("div");
      item.className = "bar-item";
      const barValue = document.createElement("span");
      barValue.style.height = `${Math.max((group.value / maxValue) * 100, 8)}%`;
      barValue.title = `${group.label}: ${formatNumber(group.value)}`;
      const label = document.createElement("small");
      label.textContent = group.label;
      item.append(barValue, label);
      return item;
    })
  );

  if (bar.truncated) {
    dashboardScope.textContent = `${dashboardScope.textContent} · данные ограничены выборкой`;
  }
}

async function loadDashboardSpec() {
  try {
    const response = await fetch("/api/dashboard");
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
    const response = await fetch("/api/dashboard/versions");
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
    const response = await fetch("/api/dashboard/restore", {
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
    versionMessage.textContent = `Создана версия ${dashboardSpec.version}: восстановлено состояние версии ${version}. История сохранена.`;
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
  dashboardPeriodInput.value = dashboardSpec.period?.preset || "all_time";
  editorStatus.textContent = `Версия ${dashboardSpec.version}`;
  editorStatus.className = "status status-success";
  editorMessage.textContent = "";
  renderEntityList();
  renderSourceContext();
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
    bar.options = { ...bar.options, sort: chartSortInput.value };
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
    const response = await fetch("/api/dashboard/reset", { method: "POST" });
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
  const response = await fetch("/api/dashboard", {
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

async function checkSession() {
  try {
    const response = await fetch("/api/session");
    const payload = await response.json();

    if (response.ok && payload.authenticated) {
      renderSession(payload);
      return;
    }

    if (payload.mode === "local_development") {
      authState.textContent = "Локальный режим разработки";
      return;
    }

    authState.textContent = "Откройте приложение через Битрикс24";
  } catch {
    authState.textContent = "Сессия пока недоступна";
  }
}

function renderSession(payload) {
  const name = payload.user?.name || "пользователь портала";
  authState.textContent = `Gateway: ${name}`;
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

  try {
    const response = await fetch("/api/dashboard/ai-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, expectedVersion: dashboardSpec.version })
    });
    const payload = await response.json();

    if (!response.ok || !payload.proposal) {
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
