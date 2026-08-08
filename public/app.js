const checkButton = document.querySelector("#checkConnection");
const form = document.querySelector("#aiCommandForm");
const textarea = document.querySelector("#aiCommand");
const output = document.querySelector("#output");
const connectionState = document.querySelector("#connectionState");
const diagnosticsSummary = document.querySelector("#diagnosticsSummary");
const capabilityList = document.querySelector("#capabilityList");
const technicalDetails = document.querySelector("#technicalDetails");
const authState = document.querySelector("#authState");
const reportList = document.querySelector("#reportList");
const metricRow = document.querySelector("#metricRow");
const chartBars = document.querySelector("#chartBars");
const dashboardName = document.querySelector("#dashboardName");
const chartTitle = document.querySelector("#chartTitle");
const visualEditor = document.querySelector("#visualEditor");
const dashboardTitleInput = document.querySelector("#dashboardTitleInput");
const chartTitleInput = document.querySelector("#chartTitleInput");
const chartSortInput = document.querySelector("#chartSortInput");
const editorStatus = document.querySelector("#editorStatus");
const editorMessage = document.querySelector("#editorMessage");
let dashboardSpec;

checkButton.addEventListener("click", checkConnection);
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

    reportList.replaceChildren(
      ...payload.entities.map((entity, index) => {
        const button = document.createElement("button");
        button.className = `report${index === 0 ? " active" : ""}`;
        button.type = "button";

        const title = document.createElement("span");
        title.textContent = entity.title;
        const description = document.createElement("small");
        description.textContent = "Источник данных MVP";

        button.append(title, description);
        return button;
      })
    );
  } catch (error) {
    reportList.textContent = `Ошибка загрузки: ${error.message}`;
  }
}

async function loadDashboardData() {
  try {
    const response = await fetch("/api/dashboard/data");
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
    diagnosticsSummary.textContent = "Часть числовых агрегатов рассчитана по ограниченной выборке.";
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
  } catch (error) {
    editorStatus.textContent = "Ошибка загрузки";
    editorStatus.className = "status status-error";
    editorMessage.textContent = error.message;
  }
}

function renderDashboardEditor() {
  const bar = dashboardSpec.widgets.find((widget) => widget.type === "bar");
  dashboardName.textContent = dashboardSpec.title;
  dashboardTitleInput.value = dashboardSpec.title;
  chartTitleInput.value = bar?.title || "";
  chartSortInput.value = bar?.options?.sort || "desc";
  editorStatus.textContent = `Версия ${dashboardSpec.version}`;
  editorStatus.className = "status status-success";
  editorMessage.textContent = "";
}

visualEditor.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!dashboardSpec) {
    return;
  }

  const nextDashboard = structuredClone(dashboardSpec);
  const bar = nextDashboard.widgets.find((widget) => widget.type === "bar");
  nextDashboard.title = dashboardTitleInput.value.trim();

  if (bar) {
    bar.title = chartTitleInput.value.trim();
    bar.options = { ...bar.options, sort: chartSortInput.value };
  }

  editorStatus.textContent = "Сохраняем";
  editorStatus.className = "status status-neutral";
  editorMessage.textContent = "";

  try {
    const response = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboard: nextDashboard, expectedVersion: dashboardSpec.version })
    });
    const payload = await response.json();

    if (response.status === 409) {
      await loadDashboardSpec();
      editorMessage.textContent = "Кто-то уже сохранил другую версию. Загружены актуальные настройки.";
      return;
    }

    if (!response.ok || !payload.saved) {
      throw new Error(payload.message || "Изменение не сохранено.");
    }

    dashboardSpec = payload.dashboard;
    renderDashboardEditor();
    await loadDashboardData();
    editorMessage.textContent = "Новая версия сохранена.";
  } catch (error) {
    editorStatus.textContent = "Ошибка сохранения";
    editorStatus.className = "status status-error";
    editorMessage.textContent = error.message;
  }
});

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

async function checkConnection() {
  setConnectionState("Проверяем", "neutral");
  diagnosticsSummary.textContent = "Запрашиваем сведения о портале и доступных функциях.";
  capabilityList.hidden = true;
  technicalDetails.hidden = true;

  try {
    const response = await fetch("/api/me");
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Платформа вернула ошибку.");
    }

    renderDiagnostics(payload);
    output.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    setConnectionState("Ошибка", "error");
    diagnosticsSummary.textContent = `Не удалось получить данные: ${error.message}`;
    output.textContent = "";
    technicalDetails.hidden = true;
  }
}

const resizeObserver = new ResizeObserver(() => {
  window.parent.postMessage({ type: "vibe:resize", height: document.documentElement.scrollHeight }, "*");
});

resizeObserver.observe(document.documentElement);

function renderDiagnostics(payload) {
  const { portal, tariff, capabilities } = payload.data;
  const rows = [
    ["Портал", portal],
    ["Тариф", tariff.name],
    ["Приложения", availability(capabilities.apps.create.available, "создание доступно")],
    ["Агенты", availability(capabilities.agents.create.available, "создание доступно")],
    ["AI Router", availability(capabilities.aiRouter.chatCompletions.available, "чат-модель доступна")],
    ["Размещение в Битрикс24", availability(capabilities.apps.bindPlacements.available, "доступно")]
  ];

  capabilityList.replaceChildren(
    ...rows.flatMap(([term, description]) => {
      const title = document.createElement("dt");
      title.textContent = term;
      const value = document.createElement("dd");
      value.textContent = description;
      return [title, value];
    })
  );

  setConnectionState("Подключено", "success");
  diagnosticsSummary.textContent =
    "Платформа видит портал. Следующий технический шаг: выяснить способ чтения и изменения нативных BI-отчётов.";
  capabilityList.hidden = false;
  technicalDetails.hidden = false;
}

function availability(isAvailable, text) {
  return isAvailable ? text : "недоступно";
}

function setConnectionState(text, state) {
  connectionState.textContent = text;
  connectionState.className = `status status-${state}`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const command = textarea.value.trim();

  if (!command) {
    output.textContent = "Введите команду для ИИ.";
    return;
  }

  diagnosticsSummary.textContent = `Команда сохранена для будущего шага: «${command}». Подключение AI-модели и BI API ещё впереди.`;
  technicalDetails.open = false;
  output.textContent = JSON.stringify({ status: "draft", command }, null, 2);
  technicalDetails.hidden = false;
});
