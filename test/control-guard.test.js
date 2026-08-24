import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedControlMethods,
  assertControlMethodAllowed,
  assertManagedDatasetName,
  ControlGuardError,
  describeOwnershipCheck
} from "../lib/control-guard.js";

test("разрешены только методы, которые приложение действительно вызывает", () => {
  assert.equal(allowedControlMethods.size, 11);
  for (const method of [
    "biconnector.dataset.list", "biconnector.dataset.get", "biconnector.dataset.add",
    "biconnector.dataset.update", "biconnector.dataset.fields", "biconnector.dataset.fields.update",
    "biconnector.dataset.delete", "biconnector.connector.list", "biconnector.connector.add",
    "biconnector.source.list", "biconnector.source.add"
  ]) {
    assert.doesNotThrow(() => assertControlMethodAllowed(method), method);
  }
});

test("удаление и изменение чужих коннекторов и источников запрещено", () => {
  for (const method of [
    "biconnector.connector.delete", "biconnector.connector.update",
    "biconnector.source.delete", "biconnector.source.update",
    "crm.deal.delete", "biconnector.dataset.drop", "", null, 42
  ]) {
    assert.throws(() => assertControlMethodAllowed(method), (error) => {
      assert.ok(error instanceof ControlGuardError);
      assert.equal(error.code, "unsupported_bitrix_method");
      return true;
    }, String(method));
  }
});

test("создание проверяется по имени из запроса", () => {
  const check = describeOwnershipCheck("biconnector.dataset.add", { fields: { name: "vibecode_ai_deal_total_managers" } });
  assert.deepEqual(check, { kind: "name", name: "vibecode_ai_deal_total_managers" });
  assert.doesNotThrow(() => assertManagedDatasetName(check.name));
});

test("чужое имя датасета отклоняется", () => {
  for (const name of ["system_filter_tasks_flow", "crm_deals", "", undefined, "vibecode_bi_demo"]) {
    assert.throws(() => assertManagedDatasetName(name), (error) => {
      assert.equal(error.code, "foreign_dataset");
      return true;
    }, String(name));
  }
});

test("изменение и удаление требуют сверки по идентификатору", () => {
  for (const method of ["biconnector.dataset.update", "biconnector.dataset.delete", "biconnector.dataset.fields.update"]) {
    assert.deepEqual(describeOwnershipCheck(method, { id: 16 }), { kind: "id", id: 16 }, method);
  }
});

test("изменение без корректного идентификатора отклоняется", () => {
  for (const params of [{}, { id: 0 }, { id: -3 }, { id: "abc" }]) {
    assert.throws(() => describeOwnershipCheck("biconnector.dataset.delete", params), (error) => {
      assert.equal(error.code, "invalid_dataset_id");
      return true;
    }, JSON.stringify(params));
  }
});

test("чтение не требует проверки принадлежности", () => {
  for (const method of ["biconnector.dataset.list", "biconnector.dataset.get", "biconnector.connector.list", "biconnector.source.add"]) {
    assert.equal(describeOwnershipCheck(method, { id: 16 }), null, method);
  }
});
