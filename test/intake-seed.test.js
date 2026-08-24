import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWeekStarts,
  createDateSpreadCalls,
  createIntakeCompanyCalls,
  createIntakeDealCalls,
  createIntakeRepairCalls,
  createIntakeSeedPlan,
  intakeSeedNamespace,
  parseIntakeSeedOptions
} from "../lib/intake-seed.js";

const companies = { "company-1": { id: 11 }, "company-2": { id: 12 } };

test("параметры seed разбираются со значениями по умолчанию", () => {
  const options = parseIntakeSeedOptions(["--confirm", "--manager-ids=30,32"]);
  assert.equal(options.confirmed, true);
  assert.equal(options.dealCount, 360);
  assert.equal(options.weeks, 8);
  assert.deepEqual(options.managerIds, [30, 32]);
});

test("seed требует ответственных", () => {
  assert.throws(() => parseIntakeSeedOptions(["--confirm"]), /manager-ids/);
});

test("seed отклоняет некорректное количество сделок и недель", () => {
  assert.throws(() => parseIntakeSeedOptions(["--deals=5", "--manager-ids=30"]), /от 12 до 1000/);
  assert.throws(() => parseIntakeSeedOptions(["--weeks=40", "--manager-ids=30"]), /от 1 до 13/);
});

test("seed отклоняет неизвестный параметр", () => {
  assert.throws(() => parseIntakeSeedOptions(["--unknown"]), /Неизвестный параметр/);
});

test("каждая сделка помечена как не повторная", () => {
  const deals = createIntakeDealCalls(companies, new Date("2026-08-23T00:00:00Z"), {
    count: 12,
    managerIds: [30, 32, 34],
    weeks: 4
  });
  assert.equal(deals.length, 12);
  assert.ok(deals.every((deal) => deal.params.isReturning === false));
  assert.ok(deals.every((deal) => deal.params.title.startsWith(intakeSeedNamespace)));
  assert.ok(deals.every((deal) => deal.params.isManualOpportunity === true));
});

test("менеджеры чередуются, а клиент у каждой сделки свой", () => {
  const sixCompanies = Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [`company-${index + 1}`, { id: 20 + index }])
  );
  const deals = createIntakeDealCalls(sixCompanies, new Date("2026-08-23T00:00:00Z"), {
    count: 6,
    managerIds: [30, 32, 34],
    weeks: 2
  });
  assert.deepEqual(deals.map((deal) => deal.params.assignedById), [30, 32, 34, 30, 32, 34]);
  assert.deepEqual(deals.map((deal) => deal.params.companyId), [20, 21, 22, 23, 24, 25]);
  assert.equal(new Set(deals.map((deal) => deal.params.companyId)).size, 6);
});

test("даты начала раскладываются по нескольким неделям квартала", () => {
  const deals = createIntakeDealCalls(companies, new Date("2026-08-23T00:00:00Z"), {
    count: 20,
    managerIds: [30],
    weeks: 4
  });
  const weeks = new Set(deals.map((deal) => buildMonday(deal.params.begindate)));
  assert.equal(weeks.size, 4);
});

test("недели не выходят за начало текущего квартала", () => {
  const starts = buildWeekStarts(new Date("2026-07-08T00:00:00Z"), 8);
  assert.ok(starts.length >= 1);
  assert.ok(starts.every((date) => date.getTime() >= Date.UTC(2026, 6, 1)));
});

test("seed без созданных компаний завершается ошибкой", () => {
  assert.throws(() => createIntakeDealCalls({}, new Date(), { count: 12, managerIds: [30] }), /идентификаторы созданных компаний/);
});

test("seed без ответственных завершается ошибкой", () => {
  assert.throws(() => createIntakeDealCalls(companies, new Date(), { count: 12, managerIds: [] }), /идентификаторы ответственных/);
});

test("план seed продолжает нумерацию со смещения", () => {
  const plan = createIntakeSeedPlan({ dealCount: 3, managerIds: [30], weeks: 2, startIndex: 10 });
  const deals = plan.createDeals(companies);
  assert.deepEqual(deals.map((deal) => deal.params.xmlId), [
    `${intakeSeedNamespace}:deal:11`,
    `${intakeSeedNamespace}:deal:12`,
    `${intakeSeedNamespace}:deal:13`
  ]);
  assert.equal(plan.companyCalls.length, 3);
});

function buildMonday(value) {
  const date = new Date(value);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return utc.toISOString().slice(0, 10);
}

test("режим починки разбирается отдельным параметром", () => {
  const options = parseIntakeSeedOptions(["--confirm", "--repair", "--manager-ids=30"]);
  assert.equal(options.repair, true);
});

test("починка снимает клиента и признак повторной сделки", () => {
  const calls = createIntakeRepairCalls([101, 102]);
  assert.deepEqual(calls, [
    { id: "repair-1", entity: "deals", action: "update", entityId: 101, params: { companyId: 0, isReturning: false } },
    { id: "repair-2", entity: "deals", action: "update", entityId: 102, params: { companyId: 0, isReturning: false } }
  ]);
});

test("починка отклоняет пустой список и нечисловые идентификаторы", () => {
  assert.throws(() => createIntakeRepairCalls([]), /непустой список/);
  assert.throws(() => createIntakeRepairCalls(["abc"]), /целым положительным числом/);
});

test("компаний создаётся столько же, сколько сделок, и с уникальными названиями", () => {
  const calls = createIntakeCompanyCalls(intakeSeedNamespace, 10);
  assert.equal(calls.length, 10);
  assert.equal(new Set(calls.map((call) => call.params.title)).size, 10);
  assert.throws(() => createIntakeCompanyCalls(intakeSeedNamespace, 0), /целым положительным числом/);
});

test("режим раскладки дат разбирается вместе с пространством имён", () => {
  const options = parseIntakeSeedOptions(["--confirm", "--spread", "--namespace=VIBECODE_LOAD_BI", "--weeks=8"]);
  assert.equal(options.spread, true);
  assert.equal(options.namespace, "VIBECODE_LOAD_BI");
  assert.equal(options.weeks, 8);
});

test("режимы обслуживания не требуют ответственных", () => {
  assert.doesNotThrow(() => parseIntakeSeedOptions(["--confirm", "--spread"]));
  assert.doesNotThrow(() => parseIntakeSeedOptions(["--confirm", "--repair"]));
});

test("пространство имён проверяется", () => {
  assert.throws(() => parseIntakeSeedOptions(["--spread", "--namespace=чужое"]), /VIBECODE_/);
  assert.throws(() => parseIntakeSeedOptions(["--spread", "--namespace=OTHER_NS"]), /VIBECODE_/);
});

test("раскладка дат распределяет сделки по неделям квартала", () => {
  const calls = createDateSpreadCalls([1, 2, 3, 4, 5, 6, 7, 8], { weeks: 4, now: new Date("2026-08-24T00:00:00Z") });
  assert.equal(calls.length, 8);
  const weeks = new Set(calls.map((call) => mondayOf(call.params.begindate)));
  assert.equal(weeks.size, 4);
  assert.equal(calls[0].entity, "deals");
  assert.equal(calls[0].action, "update");
  assert.equal(calls[0].entityId, 1);
});

test("раскладка не ставит дат в будущем", () => {
  const now = new Date("2026-08-24T00:00:00Z");
  const calls = createDateSpreadCalls(Array.from({ length: 40 }, (_, index) => index + 1), { weeks: 8, now });
  const latest = calls.map((call) => call.params.begindate).sort().at(-1);
  assert.ok(new Date(latest).getTime() <= now.getTime(), `дата ${latest} позже ${now.toISOString()}`);
});

test("раскладка отклоняет пустой список и нечисловые идентификаторы", () => {
  assert.throws(() => createDateSpreadCalls([]), /непустой список/);
  assert.throws(() => createDateSpreadCalls(["x"]), /целым положительным числом/);
});

function mondayOf(value) {
  const date = new Date(value);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return utc.toISOString().slice(0, 10);
}
