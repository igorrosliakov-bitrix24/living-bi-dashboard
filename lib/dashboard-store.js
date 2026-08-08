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

  listVersions() {
    const currentVersion = this.versions.at(-1).version;

    return this.versions.toReversed().map((dashboard) => ({
      version: dashboard.version,
      title: dashboard.title,
      widgetCount: dashboard.widgets.length,
      current: dashboard.version === currentVersion
    }));
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

  restore(version, expectedVersion) {
    const target = this.versions.find((dashboard) => dashboard.version === version);

    if (!target) {
      return { saved: false, error: "version_not_found" };
    }

    return this.save(target, expectedVersion);
  }
}

function clone(value) {
  return structuredClone(value);
}
