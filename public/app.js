const checkButton = document.querySelector("#checkConnection");
const form = document.querySelector("#aiCommandForm");
const textarea = document.querySelector("#aiCommand");
const output = document.querySelector("#output");
const connectionState = document.querySelector("#connectionState");
const diagnosticsSummary = document.querySelector("#diagnosticsSummary");
const capabilityList = document.querySelector("#capabilityList");
const technicalDetails = document.querySelector("#technicalDetails");

checkButton.addEventListener("click", checkConnection);

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
