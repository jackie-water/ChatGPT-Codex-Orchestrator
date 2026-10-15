import fs from "node:fs";
import path from "node:path";
import { normalizeControlEvent } from "./control-event-normalizer.mjs";
import { prepareFailure, persistFailure } from "./run-failure-state.mjs";

const BRANCH = /^(codex|chore|fix|feat|refactor|test|docs|spike)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SAFE_REF = /^(?!.*(?:^|\/)(?:\.|\.\.|\.git)(?:$|\/))(?!.*(?:^|\/)[^.\/]*\.\.[^.\/]*(?:\/|$))(?!.*(?:^|\/)[A-Za-z0-9._-]+\.lock(?:\/|$))(?!.*\.\.?$)(?!.*[\\~^:?*\[\]@{} ])(?!.*\/\/)(?!.*\/$)[A-Za-z0-9._/-]+$/;
const SHELL_LINE = /^(?:[-*+]\s+|`+\s*)?(?:run\s+)?(?:npm\s+(?:test|run\s+(?:build|lint|test))|git\s+diff\s+--check|node\s+--check|(?:bash|sh)\s+-c)\b/i;
const SHELL_META = /[;&|`$()<>]/;

const fail = message => { throw new Error(message); };
const json = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function bodyOf(event) { try { return JSON.parse(event.issue.body); } catch { fail("Malformed normalized issue body"); } }
function configuredSteps(project) {
  const profile = project.validation_profile || project.validationProfile || {};
  const allow = profile.allowed_executables || project.allowed_validation_executables || [];
  const steps = profile.validation_steps || project.default_validation_steps || [];
  if (!Array.isArray(allow) || !allow.every(x => typeof x === "string" && SAFE_REF.test(x))) fail("Invalid validation executable allowlist");
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
    if (!allow.includes(step.command) || !SAFE_REF.test(step.command)) fail("Validation executable is not allowed");
    if (SHELL_META.test(step.command) || step.arguments.some(x => SHELL_META.test(x))) fail("Routine validation shell line is prohibited");
    return { name: step.name, command: step.command, arguments: [...step.arguments] };
  }).filter((step, i, all) => all.findIndex(x => x.command === step.command && JSON.stringify(x.arguments) === JSON.stringify(step.arguments)) === i);
}
function duplicateState(controlRoot, instanceId, project, issue, iteration) {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const base = path.join(home, ".chatgpt-codex-orchestrator", "instances", instanceId);
  for (const dir of ["codex-runs", "run-state", "runs", "failure-outbox"]) {
    const folder = path.join(base, dir); if (!fs.existsSync(folder)) continue;
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
  const b = bodyOf(normalized.event); const issue = normalized.context.control_provenance.issue_number;
  const registry = json(path.join(controlRoot, "projects.json")); const project = registry.projects[normalized.context.authorized_source.project];
  const max = project.max_iterations === undefined ? 5 : project.max_iterations;
  if (!Number.isInteger(max) || max < 1) fail("Invalid configured max_iterations");
  let effectiveMax = max;
  if (b.max_iterations !== undefined) { if (!Number.isInteger(b.max_iterations) || b.max_iterations < 1 || b.max_iterations > max) fail("Requested max_iterations exceeds project limit"); effectiveMax = b.max_iterations; }
  const iteration = Number(b.iteration); if (iteration < 1 || iteration > effectiveMax) fail("Iteration exceeds project limit");
  const request = String(b.request || b.request_type || (iteration === 1 ? "initial" : "revise")).toLowerCase();
  const expected = iteration === 1 ? "initial" : "revise"; if (request !== expected) fail("Request type does not match iteration");
  const configuredLimits = project.prompt_limits || {};
  const initialLimit = configuredLimits.initial_max_chars === undefined ? 12000 : configuredLimits.initial_max_chars;
  const reviseLimit = configuredLimits.revise_max_chars === undefined ? 6000 : configuredLimits.revise_max_chars;
  if (!Number.isInteger(initialLimit) || initialLimit < 1 || !Number.isInteger(reviseLimit) || reviseLimit < 1) fail("Invalid configured prompt limits");
  const prompt = typeof b.prompt === "string" ? b.prompt : ""; const limit = iteration === 1 ? Math.min(12000, initialLimit) : Math.min(6000, reviseLimit);
  if (!prompt.trim() || prompt.length > limit) fail("Prompt is empty or exceeds configured limit");
  if (prompt.split(/\r?\n/).some(line => SHELL_LINE.test(line.trim()))) fail("Routine validation shell line is prohibited");
  const target = b.target_branch; const defaultBranch = project.default_branch;
  if (typeof defaultBranch !== "string" || !SAFE_REF.test(defaultBranch)) fail("Invalid configured default branch");
  if (typeof target !== "string" || !BRANCH.test(target) || !SAFE_REF.test(target) || ["main", "master", defaultBranch].includes(target)) fail("Prohibited or unsafe task branch");
  const validation = validateSteps(b, project);
  duplicateState(controlRoot, normalized.context.instance?.instance_id || json(path.join(controlRoot, "instance.json")).instance_id, normalized.context.authorized_source.project, issue, iteration);
  return { normalized, plan: { project: normalized.context.authorized_source.project, issue, iteration, repository: project.repository, default_branch: defaultBranch, target_branch: target, review_route: normalized.context.authorized_source.review_route, validation_steps: validation, run_id: `codex-${normalized.context.authorized_source.project}-${issue}-${iteration}` } };
}

export function recordMacosPreflightFailure({ planned, controlRoot, trustedGithubUsername, code }) {
  if (!planned?.normalized?.event) fail("A validated preflight plan is required");
  const { context, failure } = prepareFailure({ event: planned.normalized.event, controlRoot, trustedGithubUsername, stage: "preflight", code });
  return persistFailure({ context, failure });
}
