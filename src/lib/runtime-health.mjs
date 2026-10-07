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

export function repairHealth(runtime, { preflightEstablished = false } = {}) {
  const readiness = Object.values(runtime).filter(value => typeof value === "boolean");
  const runtimeHealthy = readiness.length > 0 && readiness.every(Boolean);
  const callbacksResolved = runtime.pending_callbacks === 0;
  const repaired = [];
  if (runtime.runner_running) repaired.push("runner");
  if (runtime.reviewer_browser) repaired.push("reviewer_browser");
  if (callbacksResolved) repaired.push("pending_callbacks");
  if (preflightEstablished) repaired.push("preflight");

  if (!runtimeHealthy) return { status: "ERROR", error_id: "REPAIR-001", recoverable: true,
    reason_key: "repair.runtime_unhealthy", repaired };
  if (!callbacksResolved) return { status: "ERROR", error_id: "REPAIR-001", recoverable: true,
    reason_key: "repair.unresolved_callbacks", repaired };
  return { status: "PASS", error_id: null, recoverable: true, repaired };
}
