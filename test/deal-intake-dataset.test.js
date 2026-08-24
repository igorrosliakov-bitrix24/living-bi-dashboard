import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateDealIntakeRows,
  getCurrentQuarterRange,
  loadDealIntakeDataset,
  selectDealIntakeRows
} from "../lib/deal-intake-dataset.js";

test("deal intake excludes returning deals and test funnels", () => {
  const rows = aggregateDealIntakeRows({
    users: [{ ID: "7", NAME: "Анна", LAST_NAME: "Иванова" }],
    excludedCategoryIds: ["99"],
    deals: [
      deal({ ID: "1", CATEGORY_ID: "0", IS_RETURN_CUSTOMER: "N", OPPORTUNITY: "120" }),
      deal({ ID: "2", CATEGORY_ID: "99", IS_RETURN_CUSTOMER: "N", OPPORTUNITY: "500" }),
      deal({ ID: "3", CATEGORY_ID: "0", IS_RETURN_CUSTOMER: "Y", OPPORTUNITY: "700" })
    ]
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    WEEK_START: "2026-08-17",
    MANAGER_ID: 7,
    MANAGER_NAME: "Анна Иванова",
    CURRENCY_ID: "RUB",
    NEW_DEALS: 1,
    PIPELINE_AMOUNT: 120,
    AVERAGE_AMOUNT: 120,
    WEEKLY_SHARE_PERCENT: 100
  });
});

test("deal intake groups by week, manager and currency", () => {
  const rows = aggregateDealIntakeRows({
    users: [
      { ID: "7", NAME: "Анна", LAST_NAME: "Иванова" },
      { ID: "8", NAME: "Пётр", LAST_NAME: "Смирнов" }
    ],
    deals: [
      deal({ ID: "1", OPPORTUNITY: "100" }),
      deal({ ID: "2", OPPORTUNITY: "300" }),
      deal({ ID: "3", ASSIGNED_BY_ID: "8", OPPORTUNITY: "200" }),
      deal({ ID: "4", CURRENCY_ID: "USD", OPPORTUNITY: "50" })
    ],
    excludedCategoryIds: []
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.find((row) => row.MANAGER_ID === 7 && row.CURRENCY_ID === "RUB"), {
    WEEK_START: "2026-08-17",
    MANAGER_ID: 7,
    MANAGER_NAME: "Анна Иванова",
    CURRENCY_ID: "RUB",
    NEW_DEALS: 2,
    PIPELINE_AMOUNT: 400,
    AVERAGE_AMOUNT: 200,
    WEEKLY_SHARE_PERCENT: 66.67
  });
  assert.equal(rows.find((row) => row.MANAGER_ID === 8).WEEKLY_SHARE_PERCENT, 33.33);
  assert.equal(rows.find((row) => row.CURRENCY_ID === "USD").WEEKLY_SHARE_PERCENT, 100);
});

test("connector data selection keeps only declared fields", () => {
  const selected = selectDealIntakeRows([
    { WEEK_START: "2026-08-17", MANAGER_ID: 7, MANAGER_NAME: "Анна", CURRENCY_ID: "RUB" }
  ], { select: ["MANAGER_NAME", "UNKNOWN", "WEEK_START"], limit: 1 });

  assert.deepEqual(selected, [
    ["MANAGER_NAME", "WEEK_START"],
    ["Анна", "2026-08-17"]
  ]);
});

test("current quarter uses an exclusive upper boundary", () => {
  assert.deepEqual(getCurrentQuarterRange(new Date("2026-08-19T12:00:00Z")), {
    start: "2026-07-01",
    endExclusive: "2026-10-01",
    lowerBoundary: "2026-06-30T23:59:59"
  });
});

test("live loader follows pagination and records excluded funnels", async () => {
  const calls = [];
  const snapshot = await loadDealIntakeDataset({
    clientEndpoint: "https://example.bitrix24.ru/rest/",
    accessToken: "test-token",
    now: new Date("2026-08-19T12:00:00Z"),
    fetchImpl: async (url) => {
      calls.push(String(url));
      const method = new URL(url).pathname.split("/").pop();
      if (method === "crm.category.list.json") {
        return response({ result: { categories: [{ id: "99", name: "Тест" }] } });
      }
      if (method === "user.get.json") {
        return response({ result: [{ ID: "7", NAME: "Анна" }] });
      }
      return response({ result: [deal({ ID: "1" })] });
    }
  });

  assert.equal(snapshot.meta.sourceDeals, 1);
  assert.deepEqual(snapshot.meta.excludedCategoryIds, ["99"]);
  assert.equal(snapshot.rows.length, 1);
  assert.ok(calls.some((url) => url.includes("filter%5B%3EBEGINDATE%5D=2026-06-30T23%3A59%3A59")));
});

function deal(overrides = {}) {
  return {
    ID: "1",
    CATEGORY_ID: "0",
    ASSIGNED_BY_ID: "7",
    BEGINDATE: "2026-08-19T10:00:00+03:00",
    OPPORTUNITY: "100",
    CURRENCY_ID: "RUB",
    IS_RETURN_CUSTOMER: "N",
    ...overrides
  };
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

test("неделя берётся из BEGINDATE, а при его отсутствии — из DATE_CREATE", () => {
  const rows = aggregateDealIntakeRows({
    deals: [
      {
        ID: "1",
        CATEGORY_ID: "0",
        ASSIGNED_BY_ID: "30",
        BEGINDATE: "2026-07-08T00:00:00+03:00",
        DATE_CREATE: "2026-08-23T10:00:00+03:00",
        OPPORTUNITY: "100",
        CURRENCY_ID: "RUB",
        IS_RETURN_CUSTOMER: "N"
      },
      {
        ID: "2",
        CATEGORY_ID: "0",
        ASSIGNED_BY_ID: "30",
        DATE_CREATE: "2026-08-19T10:00:00+03:00",
        OPPORTUNITY: "100",
        CURRENCY_ID: "RUB",
        IS_RETURN_CUSTOMER: "N"
      }
    ],
    users: [{ ID: "30", NAME: "Анна", LAST_NAME: "Воронцова" }],
    excludedCategoryIds: []
  });

  assert.deepEqual(rows.map((row) => row.WEEK_START), ["2026-07-06", "2026-08-17"]);
});
