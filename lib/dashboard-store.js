import { createInitialDashboard, validateDashboardSpec } from "./dashboard-spec.js";

export class DashboardStore {
  constructor(initialSpec = createInitialDashboard()) {
    const validation = validateDashboardSpec(initialSpec);

    if (!validation.valid) {
      throw new Error(`Invalid initial dashboard: ${validation.errors.join(" ")}`);
    }

    this.versions = [clone(initialSpec)];
  }

  getCurrent() {
    return clone(this.versions.at(-1));
  }

  save(nextSpec, expectedVersion) {
    const current = this.versions.at(-1);

    if (expectedVersion !== current.version) {
      return { saved: false, error: "version_conflict", currentVersion: current.version };
    }

    const candidate = { ...nextSpec, version: current.version + 1 };
    const validation = validateDashboardSpec(candidate);

    if (!validation.valid) {
      return { saved: false, error: "invalid_spec", errors: validation.errors };
    }

    const saved = clone(candidate);
    this.versions.push(saved);
    return { saved: true, dashboard: clone(saved) };
  }
}

function clone(value) {
  return structuredClone(value);
}
