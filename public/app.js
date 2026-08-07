const checkButton = document.querySelector("#checkConnection");
const form = document.querySelector("#aiCommandForm");
const textarea = document.querySelector("#aiCommand");
const output = document.querySelector("#output");
const connectionState = document.querySelector("#connectionState");
const diagnosticsSummary = document.querySelector("#diagnosticsSummary");
const capabilityList = document.querySelector("#capabilityList");
const technicalDetails = document.querySelector("#technicalDetails");
const authButton = document.querySelector("#authButton");
const authState = document.querySelector("#authState");
let oauthPollTimer;

checkButton.addEventListener("click", checkConnection);
authButton.addEventListener("click", startOAuth);
checkSession();

async function startOAuth() {
  authButton.disabled = true;
  authState.textContent = "Открываем вход...";

  try {
    const response = await fetch("/api/auth/start");
    const payload = await response.json();

    if (!response.ok || !payload.authorizationUrl) {
      throw new Error(payload.message || "Не удалось начать авторизацию.");
    }

    const popup = window.open(payload.authorizationUrl, "bitrix24-oauth", "width=620,height=760");

    if (!popup) {
      window.location.assign(payload.authorizationUrl);
      return;
    }

    authState.textContent = "Завершите вход в открывшемся окне";
    oauthPollTimer = window.setInterval(checkOAuthStatus, 1500);
  } catch (error) {
    authState.textContent = `Ошибка входа: ${error.message}`;
    authButton.disabled = false;
  }
}

async function checkOAuthStatus() {
  try {
    const response = await fetch("/api/auth/status");
    const payload = await response.json();

    if (payload.status === "pending") {
      return;
    }

    window.clearInterval(oauthPollTimer);
    oauthPollTimer = undefined;

    if (!response.ok || !payload.authenticated) {
      throw new Error(payload.message || "Вход не завершён.");
    }

    renderSession(payload);
  } catch (error) {
    window.clearInterval(oauthPollTimer);
    oauthPollTimer = undefined;
    authState.textContent = `Ошибка входа: ${error.message}`;
    authButton.disabled = false;
  }
}

async function checkSession() {
  try {
    const response = await fetch("/api/session");
    const payload = await response.json();

    if (response.ok && payload.authenticated) {
      renderSession(payload);
    }
  } catch {
    authState.textContent = "Сессия пока недоступна";
  }
}

function renderSession(payload) {
  authState.textContent = `Выполнен вход: ${payload.user.name}`;
  authButton.hidden = true;
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
