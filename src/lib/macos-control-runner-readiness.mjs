import fs from "node:fs";
import path from "node:path";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const INSTANCE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LABEL = /^[A-Za-z0-9._-]+$/;
const PRIVATE_MODE = 0o022;
const STATUSES = new Set([
  "READY", "WORKFLOW_DISABLED", "RUNNER_UNREGISTERED", "RUNNER_OFFLINE",
  "RUNNER_NOT_CONFIGURED", "CALLBACK_PENDING", "UNKNOWN", "CONFLICT"
]);

function value(observations, name, fallback) {
  const item = observations?.[name];
  if (typeof item === "function") {
    try { return item(); } catch { return fallback; }
  }
  return item === undefined ? fallback : item;
}

function privateFile(file, fileSystem) {
  if (!file) return { ok: false, reason: "missing_path" };
  try {
    const stat = fileSystem.lstatSync(file);
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    return {
      ok: stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
        (uid === null || stat.uid === uid) && (stat.mode & PRIVATE_MODE) === 0,
      exists: true,
      owner: uid === null || stat.uid === uid,
      private: (stat.mode & PRIVATE_MODE) === 0
    };
  } catch (error) {
    return { ok: false, exists: false, reason: error.code === "ENOENT" ? "missing" : "read_failure" };
  }
}

function readRunnerConfig(runnerPath, fileSystem) {
  if (!runnerPath || typeof runnerPath !== "string") return { ok: false, reason: "missing_path" };
  const config = path.join(runnerPath, ".runner");
  try {
    const directory = fileSystem.lstatSync(runnerPath);
    const directoryUid = typeof process.getuid === "function" ? process.getuid() : null;
    if (!directory.isDirectory() || directory.isSymbolicLink() ||
        (directoryUid !== null && directory.uid !== directoryUid) || (directory.mode & PRIVATE_MODE) !== 0) {
      return { ok: false, reason: "unsafe_runner_path" };
    }
    const stat = fileSystem.lstatSync(config);
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        (uid !== null && stat.uid !== uid) || (stat.mode & PRIVATE_MODE) !== 0) {
      return { ok: false, reason: "unsafe_config" };
    }
    const parsed = JSON.parse(fileSystem.readFileSync(config, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "invalid_config" };
    // Only booleans/counts are retained. The .runner file may contain credentials.
    return { ok: true, valid: true, has_credentials: Object.keys(parsed).some(key => /token|credential|secret/i.test(key)) };
  } catch (error) {
    return { ok: false, reason: error.code === "ENOENT" ? "missing_config" : "read_failure" };
  }
}

function labelsOf(runner) {
  const labels = runner?.labels ?? runner?.label_names ?? runner?.runner_labels;
  if (!Array.isArray(labels)) return null;
  const normalized = [];
  for (const label of labels) {
    if (typeof label === "string" && LABEL.test(label)) normalized.push(label);
    else if (label && typeof label === "object" && typeof label.name === "string" && LABEL.test(label.name)) normalized.push(label.name);
    else return null;
  }
  return normalized;
}

function callbackState(state, fileSystem) {
  const root = state?.instance_root;
  if (!root) return { known: false, pending: false, reason: "missing_root" };
  try {
    const dir = path.join(root, "pending-wakes");
    const directory = fileSystem.lstatSync(dir);
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (!directory.isDirectory() || directory.isSymbolicLink() ||
        (uid !== null && directory.uid !== uid) || (directory.mode & 0o077) !== 0) {
      return { known: false, pending: false, reason: "unsafe_callback_directory" };
    }
    const files = fileSystem.readdirSync(dir).filter(name => name.endsWith(".json"));
    let pending = false;
    for (const name of files) {
      try {
        const file = path.join(dir, name);
        const stat = fileSystem.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
            (uid !== null && stat.uid !== uid) || (stat.mode & 0o077) !== 0) {
          return { known: false, pending: false, reason: "unsafe_callback_record" };
        }
        const record = JSON.parse(fileSystem.readFileSync(file, "utf8"));
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          return { known: false, pending: false, reason: "malformed_callback_record" };
        }
        const delivery = record.delivery_state;
        const verified = record.verified_by === "committed-user-turn" || record.verified_by === "existing-user-message";
        if (delivery === "DELIVERED" && verified) continue;
        if (["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED"].includes(delivery)) pending = true;
        else return { known: false, pending: false, reason: "unknown_callback_state" };
      } catch (error) {
        return { known: false, pending: false, reason: error.code === "ENOENT" ? "read_failure" : "malformed_callback_record" };
      }
    }
    return { known: true, pending };
  } catch (error) {
    return { known: error.code === "ENOENT", pending: false, reason: error.code === "ENOENT" ? "missing_outbox" : "read_failure" };
  }
}

function safeWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object") return { known: false };
  const state = String(workflow.state ?? workflow.status ?? "").toLowerCase();
  const disabled = workflow.enabled === false || ["disabled", "disabled_manually", "inactive"].includes(state);
  const enabled = workflow.enabled === true || ["enabled", "active"].includes(state);
  const fresh = workflow.fresh === true || workflow.freshness === "current" || workflow.source === "live";
  return { known: (disabled || enabled) && fresh, disabled, enabled, fresh };
}

function inventoryOf(observation) {
  if (!observation || typeof observation !== "object") return { known: false, empty: false, runner: null, fresh: false };
  const inventory = observation.inventory && typeof observation.inventory === "object" ? observation.inventory : observation;
  const runners = Array.isArray(inventory.runners) ? inventory.runners : null;
  const freshness = observation.fresh === true || observation.freshness === "current" || observation.source === "live" ||
    inventory.fresh === true || inventory.freshness === "current" || inventory.source === "live";
  const inventoryState = String(observation.inventory_status ?? inventory.inventory_status ?? inventory.status ?? "").toLowerCase();
  if (observation.reachable === false || observation.error || ["unknown", "unreachable", "timeout", "failed"].includes(inventoryState)) {
    return { known: false, empty: false, runner: null, fresh: freshness };
  }
  if (runners && runners.length === 0 && ["verified", "verified_empty", "empty"].includes(inventoryState)) {
    return { known: true, empty: true, runner: null, fresh: freshness };
  }
  // A direct runner record is accepted for existing callers/tests.
  if (Array.isArray(observation.labels) || Array.isArray(observation.label_names) || Array.isArray(observation.runner_labels)) {
    return { known: true, empty: false, runner: observation, fresh: freshness };
  }
  if (runners && runners.length === 1) return { known: true, empty: false, runner: runners[0], fresh: freshness };
  return { known: false, empty: false, runner: null, fresh: freshness };
}

/**
 * Read-only, instance-scoped macOS runner diagnosis. All external observations
 * can be injected, allowing tests and callers to avoid network probes.
 */
export function diagnoseMacosControlRunnerReadiness({ state = {}, observations = {}, deps = {} } = {}) {
  const fileSystem = deps.fs || fs;
  const expectedRepository = String(state.control_repository || "");
  const expectedInstance = String(state.instance_id || "");
  const expectedLabel = String(state.runner_label || "");
  const runnerPath = state.runner_path;
  const reasons = [];
  const evidence = { mutations_performed: false, credentials_used: false };

  if (!REPOSITORY.test(expectedRepository) || !INSTANCE.test(expectedInstance)) {
    return { status: "UNKNOWN", ready: false, reasons: ["missing_control_identity"], evidence };
  }

  const control = value(observations, "control", {});
  if (!control || control.repository !== expectedRepository || control.instance_id !== expectedInstance) {
    reasons.push(control?.repository || control?.instance_id ? "control_identity_conflict" : "control_identity_unverified");
  }
  evidence.control_repository_match = control?.repository === expectedRepository;
  evidence.instance_match = control?.instance_id === expectedInstance;

  const workflow = safeWorkflow(value(observations, "workflow", state.workflow || {
    state: state.workflow_state || state.workflow_status,
    enabled: state.workflow_enabled
  }));
  evidence.workflow_known = workflow.known;
  evidence.workflow_enabled = workflow.enabled === true;
  evidence.workflow_disabled = workflow.disabled;
  evidence.workflow_fresh = workflow.fresh;
  if (!workflow.known) reasons.push(workflow.fresh ? "workflow_state_unverified" : "workflow_state_stale");

  const config = readRunnerConfig(runnerPath, fileSystem);
  const pathEvidence = privateFile(runnerPath && path.join(runnerPath, ".runner"), fileSystem);
  evidence.runner_path_present = Boolean(runnerPath);
  evidence.runner_configured = config.ok && pathEvidence.ok;
  if (!evidence.runner_configured) reasons.push(config.reason || "runner_not_configured");

  const registration = value(observations, "runner", state.runner_registration || state.actions_runner);
  const inventory = inventoryOf(registration);
  const runner = inventory.runner;
  const registrationKnown = inventory.known && !inventory.empty;
  const registrationRepo = registration?.repository || registration?.repo;
  const registrationInstance = runner?.instance_id || runner?.instance;
  const labels = labelsOf(runner);
  const expectedLabels = ["self-hosted", "macOS", (state.instance_arch || process.arch) === "arm64" ? "ARM64" : "X64", expectedLabel];
  const labelsMatch = Array.isArray(labels) && expectedLabels.every(label => labels.includes(label));
  const runnerRepository = runner?.repository || runner?.repo || registration?.repository || registration?.repo;
  const registrationMatch = registrationKnown && runnerRepository === expectedRepository &&
    registrationInstance === expectedInstance && labelsMatch;
  evidence.runner_inventory_fresh = inventory.fresh;
  evidence.runner_inventory_empty = inventory.empty;
  evidence.runner_registration_known = registrationKnown;
  evidence.runner_registration_match = registrationMatch;
  evidence.runner_online = runner?.status === "online" || runner?.online === true;
  if (!inventory.known || !inventory.fresh) reasons.push(inventory.fresh ? "runner_registration_unverified" : "runner_inventory_stale");
  else if (inventory.empty) reasons.push("runner_inventory_empty");
  else if (runnerRepository !== expectedRepository || registrationInstance !== expectedInstance || !labelsMatch) reasons.push("runner_registration_conflict");

  const launch = value(observations, "launchAgent", value(observations, "launch_agent", {}));
  const launchKnown = launch && typeof launch === "object";
  const launchOwned = launch?.owned === true && launch?.label === state.launch_agent_label;
  const launchLoaded = launch?.loaded === true;
  evidence.launch_agent_known = launchKnown;
  evidence.launch_agent_owned = launchOwned;
  evidence.launch_agent_loaded = launchLoaded;
  if (launchKnown && launch?.ownership_conflict === true) reasons.push("launch_agent_ownership_conflict");
  else if (!launchKnown || !launchOwned) reasons.push("launch_agent_unverified");

  const route = value(observations, "route", state.route || state.chat_route);
  const routeKnown = route && typeof route === "object" && route.status === "active" &&
    route.project === (state.project_key || state.sandbox_project_key) &&
    route.route === (state.review_route || state.target_review_route || state.sandbox_review_route);
  evidence.route_known = Boolean(routeKnown);
  if (!routeKnown) reasons.push("route_unverified");

  const localCallback = callbackState(state, fileSystem);
  const injectedCallback = Object.hasOwn(observations, "callback") && observations.callback !== undefined
    ? value(observations, "callback", null) : null;
  // Current local outbox evidence wins over persisted state. A prevalidated
  // injected observation is accepted explicitly, but old state cannot erase
  // a local pending, unknown, malformed, or unsafe record.
  const pending = injectedCallback || (!["missing_root", "missing_outbox"].includes(localCallback.reason) ? localCallback :
    state.callback_observation || state.pending_wake_outbox || localCallback);
  evidence.callback_known = pending?.known !== false;
  evidence.callback_pending = pending?.pending === true;
  if (pending?.reason === "read_failure") reasons.push("callback_read_failure");

  let status = "UNKNOWN";
  if (reasons.includes("control_identity_conflict") || reasons.includes("runner_registration_conflict") || reasons.includes("launch_agent_ownership_conflict")) status = "CONFLICT";
  else if (workflow.disabled && workflow.fresh) status = "WORKFLOW_DISABLED";
  else if (!evidence.runner_configured) status = "RUNNER_NOT_CONFIGURED";
  else if (inventory.empty && inventory.fresh) status = "RUNNER_UNREGISTERED";
  else if (!registrationMatch) status = registrationKnown ? "RUNNER_UNREGISTERED" : "UNKNOWN";
  else if (!evidence.runner_online) status = "RUNNER_OFFLINE";
  else if (evidence.callback_pending) status = "CALLBACK_PENDING";
  else if (evidence.control_repository_match && evidence.instance_match && workflow.enabled && workflow.fresh && inventory.fresh && launchOwned && launchLoaded && routeKnown) status = "READY";

  // Missing, timed-out, or permission-denied observations can never become READY.
  if (status === "READY" && (reasons.length || !evidence.callback_known || !evidence.launch_agent_known)) status = "UNKNOWN";
  return { status: STATUSES.has(status) ? status : "UNKNOWN", ready: status === "READY", reasons: [...new Set(reasons)], evidence };
}

export const macosControlRunnerReadiness = diagnoseMacosControlRunnerReadiness;
