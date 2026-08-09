import test from "node:test";
import assert from "node:assert/strict";
import {
  createCompanyCalls,
  createDealCalls,
  createExistingDemoCalls,
  createTaskCalls,
  demoNamespace,
  hasExistingDemoRecords
} from "../lib/demo-seed.js";

test("builds isolated demo records with a stable namespace", () => {
  const companies = createCompanyCalls();
  const deals = createDealCalls({ "company-1": { id: 11 }, "company-2": { id: 12 }, "company-3": { id: 13 } }, new Date("2026-08-01T00:00:00Z"));
  const tasks = createTaskCalls(new Date("2026-08-01T00:00:00Z"));

  assert.equal(companies.length, 3);
  assert.equal(deals.length, 12);
  assert.equal(tasks.length, 8);
  assert.ok([...companies, ...deals, ...tasks].every((call) => call.params.xmlId.startsWith(demoNamespace)));
  assert.equal(deals[0].params.companyId, 11);
  assert.equal(tasks[0].params.deadline, "2026-07-29T00:00:00.000Z");
});

test("detects existing demo records before writing", () => {
  assert.equal(createExistingDemoCalls().length, 3);
  assert.equal(hasExistingDemoRecords({ "existing-deals": [] }), false);
  assert.equal(hasExistingDemoRecords({ "existing-deals": [{ id: 1 }] }), true);
  assert.throws(() => createDealCalls({}), /идентификаторы/);
});
