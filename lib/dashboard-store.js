import { createInitialDashboard, validateDashboardSpec } from "./dashboard-spec.js";

export class DashboardStore {
  constructor(initialSpec = createInitialDashboard(), versions = [initialSpec], ownerId = null) {
    const validation = validateDashboardSpec(initialSpec);

    if (!validation.valid) {
      throw new Error(`Invalid initial dashboard: ${validation.errors.join(" ")}`);
    }

    this.replaceVersions(versions);
    this.setOwnerId(ownerId);
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

  reset() {
    const initial = createInitialDashboard();
    this.versions = [clone(initial)];
    return { saved: true, dashboard: clone(initial) };
  }

  getSnapshot() {
    return { format: 2, ownerId: this.ownerId, versions: clone(this.versions) };
  }

  getOwnerId() {
    return this.ownerId;
  }

  claimOwner(userId) {
    if (this.ownerId || typeof userId !== "string" || !userId) {
      return false;
    }

    this.ownerId = userId;
    return true;
  }

  setOwnerId(ownerId) {
    this.ownerId = typeof ownerId === "string" && ownerId ? ownerId : null;
  }

  replaceVersions(versions) {
    if (!Array.isArray(versions) || versions.length === 0) {
      throw new Error("Dashboard versions must be a non-empty array.");
    }

    const migratedVersions = versions.map(migrateDashboard);
    let previousVersion = 0;

    for (const dashboard of migratedVersions) {
      const validation = validateDashboardSpec(dashboard);

      if (!validation.valid || dashboard.version <= previousVersion) {
        throw new Error("Dashboard versions contain an invalid snapshot.");
      }

      previousVersion = dashboard.version;
    }

    this.versions = clone(migratedVersions);
  }
}

function migrateDashboard(dashboard) {
  const migrated = clone(dashboard);

  if (migrated.period?.field === "closeDate") {
    migrated.period.field = "closedAt";
  }

  for (const widget of migrated.widgets || []) {
    if (widget.period?.field === "closeDate") {
      widget.period.field = "closedAt";
    }
  }

  return migrated;
}

function clone(value) {
  return structuredClone(value);
}
