import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeControlEvent, getAuthorizedSnapshot } from "./control-event-normalizer.mjs";
import { prepareFailure, persistFailure } from "./run-failure-state.mjs";

const BRANCH = /^(codex|chore|fix|feat|refactor|test|docs|spike)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SHELL_LINE = /^(?:[-*+]\s+|`+\s*)?(?:run\s+)?(?:npm\s+(?:test|run\s+(?:build|lint|test))|git\s+diff\s+--check|node\s+--check|(?:bash|sh)\s+-c)\b/i;
const SHELL_META = /[;&|`$()<>]/;
const validatedPlans = new WeakMap();

const fail = message => { throw new Error(message); };
function isSafeRef(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._/-]+$/.test(value) || /\/\/|\/$/.test(value)) return false;
  return value.split("/").every(component => component.length > 0 && !component.startsWith(".") && !component.endsWith(".") && !component.includes("..") && !component.endsWith(".lock"));
}
const json = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function immutableClone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(immutableClone));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableClone(item)])));
}
function sameTrustedUsers(expected, actual) {
  return Array.isArray(actual) && expected.length === actual.length && expected.every((name, index) => actual[index] === name);
}
function bodyOf(event) { try { return JSON.parse(event.issue.body); } catch { fail("Malformed normalized issue body"); } }
function configuredSteps(project) {
  const profile = project.validation_profile || project.validationProfile || {};
  const allow = Object.prototype.hasOwnProperty.call(profile, "allowed_executables")
    ? profile.allowed_executables
    : Object.prototype.hasOwnProperty.call(project, "allowed_validation_executables")
      ? project.allowed_validation_executables
      : ["git"];
  const steps = profile.validation_steps || project.default_validation_steps || [];
  if (!Array.isArray(allow) || !allow.every(x => isSafeRef(x))) fail("Invalid validation executable allowlist");
  if (!Array.isArray(steps)) fail("Validation steps must be structured");
  return { allow, steps };
}
function validateSteps(body, project) {
  const { allow, steps: defaults } = configuredSteps(project);
  const userSteps = body.validation_steps === undefined ? [] : body.validation_steps;
  if (!Array.isArray(userSteps)) fail("Validation steps must be structured argv");
  const steps = [...defaults, ...userSteps];
  if (!Array.isArray(steps)) fail("Validation steps must be structured argv");
  return steps.map(step => {
    if (!step || typeof step !== "object" || Array.isArray(step) || typeof step.name !== "string" || typeof step.command !== "string" || !Array.isArray(step.arguments) || !step.arguments.every(x => typeof x === "string" && !SHELL_META.test(x))) fail("Invalid structured validation step");
    if (!allow.includes(step.command) || !isSafeRef(step.command)) fail("Validation executable is not allowed");
    if (SHELL_META.test(step.command) || step.arguments.some(x => SHELL_META.test(x))) fail("Routine validation shell line is prohibited");
    return { name: step.name, command: step.command, arguments: [...step.arguments] };
  }).filter((step, i, all) => all.findIndex(x => x.command === step.command && JSON.stringify(x.arguments) === JSON.stringify(step.arguments)) === i);
}
function duplicateState(controlRoot, instanceId, project, issue, iteration) {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const base = path.join(home, ".chatgpt-codex-orchestrator", "instances", instanceId);
  for (const dir of ["codex-runs", "run-state", "runs", "failure-outbox"]) {
    const folder = path.join(base, dir);
    let folderStat;
    try { folderStat = fs.lstatSync(folder); } catch (error) {
      if (error?.code === "ENOENT") continue;
      fail("Uncertain existing run state");
    }
    if (folderStat.isSymbolicLink() || !folderStat.isDirectory()) fail("Uncertain existing run state");
    for (const name of fs.readdirSync(folder)) {
      if (!/\.json$/.test(name)) continue;
      const file = path.join(folder, name); let st; try { st = fs.lstatSync(file); } catch { fail("Uncertain existing run state"); }
      if (st.isSymbolicLink() || !st.isFile()) fail("Uncertain existing run state");
      let value; try { value = json(file); } catch { fail("Uncertain existing run state"); }
      if (dir === "failure-outbox") {
        const journal = name.endsWith(".journal.json");
        const failure = journal ? value?.failure : value;
        if (journal && (value?.version !== 1 || value?.phase !== "prepared" || typeof value.callback_id !== "string")) fail("Uncertain existing run state");
        if (!failure || typeof failure !== "object" || Array.isArray(failure) || failure.execution_state !== "TERMINAL_FAILURE" || typeof failure.project !== "string" || !Number.isInteger(failure.issue) || failure.issue < 1 || !Number.isInteger(failure.iteration) || failure.iteration < 1 || typeof failure.callback_id !== "string" || failure.callback_id !== `failure-${failure.project}-${failure.issue}-${failure.iteration}` || !failure.callback || typeof failure.callback !== "object" || !["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"].includes(failure.callback.delivery_state) || failure.callback.callback_id !== failure.callback_id) fail("Uncertain existing run state");
      }
      if (value.project === project && Number(value.issue) === issue && Number(value.iteration) === iteration) fail("Duplicate run state exists");
      const failure = dir === "failure-outbox" ? (name.endsWith(".journal.json") ? value.failure : value) : null;
      if (failure && failure.project === project && failure.issue === issue && failure.iteration === iteration) fail("Duplicate run state exists");
    }
  }
}

export function planMacosCodexRun({ event, controlRoot, controlRepository, trustedGithubUsername }) {
  const normalized = normalizeControlEvent({ event, controlRoot, controlRepository, trustedGithubUsername });
  const snapshot = getAuthorizedSnapshot(normalized);
  const b = bodyOf(normalized.event); const issue = normalized.context.control_provenance.issue_number;
  const project = snapshot.configuration;
  const max = project.max_iterations === undefined ? 5 : project.max_iterations;
  if (!Number.isInteger(max) || max < 1 || max > 20) fail("Invalid configured max_iterations");
  if (!Object.prototype.hasOwnProperty.call(b, "max_iterations") || !Number.isInteger(b.max_iterations) || b.max_iterations < 1 || b.max_iterations > max) fail("Requested max_iterations exceeds project limit");
  const effectiveMax = b.max_iterations;
  const iteration = Number(b.iteration); if (iteration < 1 || iteration > effectiveMax) fail("Iteration exceeds project limit");
  const request = String(b.request || b.request_type || (iteration === 1 ? "initial" : "revise")).toLowerCase();
  const expected = iteration === 1 ? "initial" : "revise"; if (request !== expected) fail("Request type does not match iteration");
  const configuredLimits = project.prompt_limits;
  const initialLimit = configuredLimits == null ? 12000 : configuredLimits.initial_max_chars;
  const reviseLimit = configuredLimits == null ? 6000 : configuredLimits.revise_max_chars;
  if (configuredLimits !== undefined && configuredLimits !== null
    && (typeof configuredLimits !== "object" || Array.isArray(configuredLimits)
      || Object.getPrototypeOf(configuredLimits) !== Object.prototype
      || !Object.prototype.hasOwnProperty.call(configuredLimits, "initial_max_chars")
      || !Object.prototype.hasOwnProperty.call(configuredLimits, "revise_max_chars")
      || !Number.isInteger(initialLimit) || initialLimit < 1000
      || !Number.isInteger(reviseLimit) || reviseLimit < 1000 || reviseLimit > initialLimit)) fail("Invalid configured prompt limits");
  const prompt = typeof b.prompt === "string" ? b.prompt : ""; const limit = iteration === 1 ? Math.min(12000, initialLimit) : Math.min(6000, reviseLimit);
  if (!prompt.trim() || prompt.length > limit) fail("Prompt is empty or exceeds configured limit");
  if (prompt.split(/\r?\n/).some(line => SHELL_LINE.test(line.trim()))) fail("Routine validation shell line is prohibited");
  const target = b.target_branch; const defaultBranch = project.default_branch;
  if (typeof defaultBranch !== "string" || !isSafeRef(defaultBranch)) fail("Invalid configured default branch");
  if (typeof target !== "string" || !BRANCH.test(target) || !isSafeRef(target) || ["main", "master", defaultBranch].includes(target)) fail("Prohibited or unsafe task branch");
  const validation = validateSteps(b, project);
  duplicateState(controlRoot, snapshot.instance_id, normalized.context.authorized_source.project, issue, iteration);
  const planned = { normalized, plan: { project: normalized.context.authorized_source.project, issue, iteration, max_iterations: effectiveMax, repository: project.repository, default_branch: defaultBranch, checkpoint_branch: project.checkpoint_branch, target_branch: target, review_route: normalized.context.authorized_source.review_route, validation_steps: validation, run_id: `codex-${normalized.context.authorized_source.project}-${issue}-${iteration}` } };
  const validatedSnapshot = immutableClone({
    event: normalized.event,
    plan: planned.plan,
    controlRoot,
    trustedGithubUsername,
    instance_id: snapshot.instance_id,
    instance_root: path.join(fs.realpathSync(process.env.HOME || process.env.USERPROFILE || "/tmp"), ".chatgpt-codex-orchestrator", "instances", snapshot.instance_id),
    identity: {
      project: normalized.context.authorized_source.project,
      issue,
      iteration,
      review_route: normalized.context.authorized_source.review_route,
      author: normalized.context.control_provenance.author,
      repository: normalized.context.authorized_source.repository
    }
  });
  // Persist this binding in the executor claim. Reauthorization of a changed
  // event, registry, route, HOME, or validation profile must not finalize it.
  const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  const authorization_digest = crypto.createHash("sha256").update(canonical({ ...validatedSnapshot, authorization: snapshot, provenance: normalized.context.control_provenance })).digest("hex");
  validatedPlans.set(planned, Object.freeze({ ...validatedSnapshot, authorization: snapshot, authorization_digest }));
  return planned;
}

export function recordMacosPreflightFailure({ planned, controlRoot, trustedGithubUsername, code }) {
  const snapshot = planned && typeof planned === "object" ? validatedPlans.get(planned) : undefined;
  if (!snapshot) fail("A validated preflight plan is required");
  if (controlRoot !== snapshot.controlRoot) fail("Preflight controlRoot does not match the validated plan");
  if (!sameTrustedUsers(snapshot.trustedGithubUsername, trustedGithubUsername)) fail("Preflight trusted users do not match the validated plan");
  const { context, failure } = prepareFailure({ event: snapshot.event, controlRoot: snapshot.controlRoot, trustedGithubUsername: snapshot.trustedGithubUsername, stage: "preflight", code });
  return persistFailure({ context, failure });
}

// Deliberately exposes only the immutable authorization snapshot, not a mutable plan.
export function getValidatedMacosCodexPlan(planned) {
  const snapshot = planned && typeof planned === "object" ? validatedPlans.get(planned) : undefined;
  if (!snapshot) fail("A validated plan is required");
  return snapshot;
}
