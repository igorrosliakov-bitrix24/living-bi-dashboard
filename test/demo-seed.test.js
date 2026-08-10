import test from "node:test";
import assert from "node:assert/strict";
import {
  createCompanyCalls,
  createDealCalls,
  createExistingDemoCalls,
  createTaskCalls,
  demoNamespace,
  hasExistingDemoRecords,
  listExistingDemoEntities
} from "../lib/demo-seed.js";

test("builds isolated demo records with a stable namespace", () => {
  const companies = createCompanyCalls();
  const deals = createDealCalls({ "company-1": { id: 11 }, "company-2": { id: 12 }, "company-3": { id: 13 } }, new Date("2026-08-01T00:00:00Z"));
  const tasks = createTaskCalls(1, new Date("2026-08-01T00:00:00Z"));

  assert.equal(companies.length, 3);
  assert.equal(deals.length, 28);
  assert.equal(tasks.length, 8);
  assert.ok([...companies, ...deals, ...tasks].every((call) => call.params.xmlId.startsWith(demoNamespace)));
  assert.equal(deals[0].params.companyId, 11);
  assert.equal(deals[0].params.closedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(deals.at(-1).params.closedAt, "2025-08-01T00:00:00.000Z");
  assert.deepEqual([...new Set(deals.map((deal) => deal.params.stageId))], ["NEW", "PREPARATION", "WON", "LOSE"]);
  assert.equal(tasks[0].params.deadline, "2026-07-29T00:00:00.000Z");
  assert.equal(tasks[0].params.responsibleId, 1);
});

test("detects existing demo records before writing", () => {
  assert.equal(createExistingDemoCalls().length, 3);
  assert.equal(hasExistingDemoRecords({ "existing-deals": [] }), false);
  assert.equal(hasExistingDemoRecords({ "existing-deals": [{ id: 1 }] }), true);
  assert.deepEqual(listExistingDemoEntities({ "existing-companies": [{ id: 1 }], "existing-tasks": [] }), ["companies"]);
  assert.throws(() => createDealCalls({}), /идентификаторы/);
  assert.throws(() => createTaskCalls(), /исполнителя/);
});
