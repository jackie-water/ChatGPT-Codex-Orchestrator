import fs from "node:fs";
import path from "node:path";

export function pendingCallbackCount(state, deps = {}) {
  const fileSystem = deps.fs || fs;
  const pathModule = deps.path || path;
  if (!state?.instance_root) return 0;

  const pendingDir = pathModule.join(state.instance_root, "pending-wakes");
  if (!fileSystem.existsSync(pendingDir)) return 0;
  return fileSystem.readdirSync(pendingDir).filter(name => name.endsWith(".json")).length;
}

export function doctorHealth(checks) {
  const booleanChecks = Object.fromEntries(Object.entries(checks).filter(([, value]) => typeof value === "boolean"));
  const healthy = Object.values(booleanChecks).every(Boolean) && checks.pending_callbacks === 0;
  return {
    healthy,
    status: healthy ? "PASS" : "ERROR",
    error_id: healthy ? null : "DOCTOR-001",
    recoverable: true
  };
}

export function repairHealth(runtime) {
  if (runtime.pending_callbacks > 0) {
    return {
      status: "ERROR",
      error_id: "REPAIR-001",
      recoverable: true,
      message: "Unresolved pending callbacks remain after safe retry/reconciliation and require separate resolution.",
      repaired: ["runner", "reviewer_browser", "preflight"]
    };
  }
  return {
    status: "PASS",
    error_id: null,
    recoverable: true,
    repaired: ["runner", "reviewer_browser", "pending_callbacks", "preflight"]
  };
}
