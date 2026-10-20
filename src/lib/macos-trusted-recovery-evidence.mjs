import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { defaultLocalPaths } from "./control-render.mjs";

export const TRUSTED_RECOVERY_EVIDENCE_VERSION = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CHAT_URL = /^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]+$/;
const OWNER_MODES = new Set([0o600, 0o700]);

const currentUid = () => typeof process.getuid === "function" ? process.getuid() : null;
const own = stat => currentUid() === null || stat.uid === currentUid() || stat.uid === 0;
const mode = stat => stat.mode & 0o777;
const canonicalUrl = value => {
  const url = typeof value === "string" ? value.replace(/\/$/, "") : "";
  return CHAT_URL.test(url) ? url : null;
};
const repositoryParts = value => {
  if (!REPOSITORY.test(String(value || ""))) throw new Error("invalid repository identity");
  const [owner, name] = String(value).split("/");
  return { owner, name, full_name: `${owner}/${name}` };
};
const safeId = value => typeof value === "string" && ID.test(value);

function lstat(fsImpl, file) {
  try { return { stat: fsImpl.lstatSync(file) }; } catch (error) { return { error, missing: error?.code === "ENOENT" }; }
}

function secureParent(fsImpl, file, home) {
  const absolute = path.resolve(file);
  const base = path.resolve(home);
  if (absolute !== base && !absolute.startsWith(base + path.sep)) return { ok: false, reason: "outside-home" };
  const baseResult = lstat(fsImpl, base);
  if (baseResult.error || baseResult.stat.isSymbolicLink() || !baseResult.stat.isDirectory() || !own(baseResult.stat) || (mode(baseResult.stat) & 0o022)) return { ok: false, reason: "unsafe-home" };
  let cursor = path.dirname(absolute);
  while (cursor !== base && cursor.startsWith(base + path.sep)) {
    const result = lstat(fsImpl, cursor);
    if (result.missing) { cursor = path.dirname(cursor); continue; }
    if (result.error || result.stat.isSymbolicLink() || !result.stat.isDirectory() || !own(result.stat) || (mode(result.stat) & 0o022)) return { ok: false, reason: "unsafe-ancestor" };
    cursor = path.dirname(cursor);
  }
  return cursor === base ? { ok: true } : { ok: false, reason: "outside-home" };
}

function secureFile(fsImpl, file, home, { allowMissing = false, privateFile = true } = {}) {
  const parent = secureParent(fsImpl, file, home);
  if (!parent.ok) return parent;
  const result = lstat(fsImpl, file);
  if (result.missing) return allowMissing ? { ok: true, missing: true } : { ok: false, missing: true };
  if (result.error || result.stat.isSymbolicLink() || !result.stat.isFile() || result.stat.nlink !== 1 || !own(result.stat) || (privateFile ? !OWNER_MODES.has(mode(result.stat)) : (mode(result.stat) & 0o022))) return { ok: false, reason: privateFile ? "unsafe-proof-file" : "unsafe-passive-file" };
  return { ok: true };
}

function readJson(fsImpl, file, home, options = {}) {
  const checked = secureFile(fsImpl, file, home, options);
  if (!checked.ok || checked.missing) return { ...checked, present: !checked.missing };
  try {
    const value = JSON.parse(fsImpl.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, present: true, value } : { ok: false, present: true, reason: "malformed-json" };
  } catch { return { ok: false, present: true, reason: "malformed-json" }; }
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value, Object.keys(value || {}).sort())).digest("hex");
}

function diagnostic(status, gates = [], extra = {}) {
  return { status, version: TRUSTED_RECOVERY_EVIDENCE_VERSION, missing_verification_gates: [...new Set(gates)].sort(), mutations_performed: false, ...extra };
}

function issueBody(issue) {
  if (!issue || typeof issue.body !== "string") return null;
  try { return JSON.parse(issue.body); } catch { return null; }
}

function remoteRepository(api, repository) {
  if (!api?.getRepository) throw new Error("independent GitHub repository query is unavailable");
  return api.getRepository(repository);
}

function remoteIssue(api, repository, number) {
  if (!api?.getIssue) throw new Error("independent GitHub issue query is unavailable");
  return api.getIssue(repository, number);
}

function independentlyVerifiedProvenance({ state, githubApi, routeFile, issueId }) {
  const control = repositoryParts(state.control_repository);
  const sandbox = repositoryParts(state.sandbox_repository);
  const remoteControl = remoteRepository(githubApi, state.control_repository);
  const remoteSandbox = remoteRepository(githubApi, state.sandbox_repository);
  const supplied = String(issueId || "");
  const suppliedMatch = supplied.match(/\/issues\/(\d+)(?:$|[?#])/);
  const registrationIssueId = Number(suppliedMatch?.[1] || (/^\d+$/.test(supplied) ? supplied : registrationIssueIdFromState(state, routeFile)));
  if (!Number.isSafeInteger(registrationIssueId) || registrationIssueId <= 0) throw new Error("registration issue identity is unavailable");
  const issue = remoteIssue(githubApi, state.control_repository, registrationIssueId);
  const body = issueBody(issue);
  const issueChatUrl = canonicalUrl(body?.chat_url);
  const reviewerChatUrl = canonicalUrl(state.reviewer_chat_url);
  const author = issue?.user?.login;
  if (!remoteControl?.id || !remoteSandbox?.id || !repositoryMatches(remoteControl, state.control_repository, "control", remoteControl.id) ||
      !repositoryMatches(remoteSandbox, state.sandbox_repository, "sandbox", remoteSandbox?.id) ||
      !issueChatUrl || !reviewerChatUrl || issueChatUrl !== reviewerChatUrl ||
      body?.project !== state.sandbox_project_key || body?.installation_id !== state.installation_id ||
      !safeId(author) || Number(issue?.number) !== registrationIssueId) throw new Error("independent GitHub provenance is contradictory");
  return {
    control_repository_id: String(remoteControl.id),
    sandbox_repository_id: String(remoteSandbox.id),
    registration_issue_id: registrationIssueId,
    registration_issue_author: String(author),
    issue,
    remoteControl,
    remoteSandbox,
    control,
    sandbox
  };
}

function registrationIssueIdFromState(state, routeFile) {
  const direct = String(state?.sandbox_chat_registration_issue || "");
  const match = direct.match(/\/issues\/(\d+)(?:$|[?#])/);
  if (match) return Number(match[1]);
  if (/^\d+$/.test(direct)) return Number(direct);
  const selected = routeRecords(routeFile?.value).find(item => item.route === state?.sandbox_review_route && item.project === state?.sandbox_project_key && item.status === "active");
  const selectedValue = String(selected?.registration_issue || "");
  const selectedMatch = selectedValue.match(/\/issues\/(\d+)(?:$|[?#])/);
  return Number(selectedMatch?.[1] || (/^\d+$/.test(selectedValue) ? selectedValue : 0));
}

function repositoryMatches(actual, expected, role, persistedId) {
  const wanted = repositoryParts(expected);
  return (String(actual?.visibility || "").toUpperCase() === "PRIVATE" || actual?.private === true) &&
    String(actual?.owner?.login || actual?.owner?.name || actual?.owner || "").toLowerCase() === wanted.owner.toLowerCase() &&
    String(actual?.name || "") === wanted.name &&
    String(actual?.full_name || "").toLowerCase() === wanted.full_name.toLowerCase() &&
    String(actual?.id || "") === String(persistedId || "") &&
    (actual?.role === undefined || actual.role === role);
}

function repositoryOriginMatches(value, expected) {
  if (value === undefined) return true;
  const text = String(value).trim().replace(/\/$/, "").replace(/\.git$/, "");
  return text === `https://github.com/${expected}` || text === `git@github.com:${expected}` || text === `ssh://git@github.com/${expected}`;
}

function routeRecords(value) {
  const routes = Array.isArray(value?.routes) ? value.routes : value?.routes && typeof value.routes === "object" ? Object.entries(value.routes).map(([route, record]) => ({ route, ...record })) : [];
  return routes.filter(record => safeId(record?.route));
}

function canonicalLocalPaths({ state, home, instanceRoot }) {
  const expectedControl = path.resolve(defaultLocalPaths({
    home,
    installationId: state.installation_id,
    projectKey: typeof state.sandbox_project_key === "string" && state.sandbox_project_key.length > 0
      ? state.sandbox_project_key
      : "__unbound-project__"
  }).control);
  const expectedRoute = path.resolve(instanceRoot, "chat-routes.json");
  const declaredControl = state.control_clone_path === undefined ? expectedControl : path.resolve(String(state.control_clone_path));
  const declaredRoute = state.chat_route_file === undefined ? expectedRoute : path.resolve(String(state.chat_route_file));
  if (declaredControl !== expectedControl) return { ok: false, reason: "canonical_control_clone_path" };
  if (declaredRoute !== expectedRoute) return { ok: false, reason: "canonical_chat_route_path" };
  return { ok: true, control: expectedControl, route: expectedRoute };
}

function localProof({ state, home, fsImpl }) {
  const installationId = String(state?.installation_id || "");
  const instanceId = String(state?.instance_id || "");
  if (!installationId || !safeId(instanceId)) return { status: "ABSENT", gates: ["installer_identity"] };
  const instanceRoot = path.resolve(state.instance_root || path.join(home, ".chatgpt-codex-orchestrator", "instances", instanceId));
  const expectedRoot = path.resolve(home, ".chatgpt-codex-orchestrator", "instances", instanceId);
  if (instanceRoot !== expectedRoot) return { status: "CONFLICT", gates: ["canonical_instance_root"] };
  const paths = canonicalLocalPaths({ state, home, instanceRoot });
  if (!paths.ok) return { status: "CONFLICT", gates: [paths.reason] };
  const control = readJson(fsImpl, path.join(paths.control, "instance.json"), home);
  const intent = readJson(fsImpl, path.join(instanceRoot, "migration-intent.json"), home);
  const receipt = readJson(fsImpl, path.join(instanceRoot, "trusted-recovery-evidence-v1.json"), home, { allowMissing: true });
  const routeFile = readJson(fsImpl, paths.route, home, { allowMissing: true, privateFile: false });
  if (receipt.present && !receipt.ok) return { status: "CONFLICT", gates: ["trusted_manifest_integrity"] };
  if (!receipt.present) return { status: "ABSENT", gates: ["trusted_manifest"] , control, intent, routeFile, instanceRoot };
  return { status: "PRESENT", control, intent, receipt, routeFile, instanceRoot };
}

function verifyLocalIdentity(local, state) {
  const gates = [];
  const control = local.control?.value;
  const intent = local.intent?.value;
  const receipt = local.receipt?.value;
  if (!local.control?.ok || !control) gates.push("control_clone_identity");
  if (!local.intent?.ok || !intent) gates.push("migration_intent");
  if (!receipt || receipt.schema_version !== TRUSTED_RECOVERY_EVIDENCE_VERSION) gates.push("trusted_manifest_version");
  if (receipt && receipt.status !== "VERIFIED") gates.push("trusted_manifest_status");
  if (receipt && (typeof receipt.issued_at !== "string" || !receipt.issued_at ||
      !Number.isFinite(Date.parse(receipt.issued_at)) || new Date(receipt.issued_at).toISOString() !== receipt.issued_at)) {
    gates.push("trusted_manifest_issued_at");
  }
  const expected = { instance_id: state.instance_id, installation_id: state.installation_id, control_repository: state.control_repository, sandbox_repository: state.sandbox_repository };
  if (control && Object.entries(expected).some(([key, value]) => value && control[key] !== value)) gates.push("control_identity_match");
  if (intent && (intent.installation_id !== state.installation_id || intent.generated_repositories?.control !== state.control_repository || intent.generated_repositories?.sandbox !== state.sandbox_repository)) gates.push("migration_identity_match");
  if (receipt && Object.entries(expected).some(([key, value]) => value && receipt[key] !== value)) gates.push("receipt_identity_match");
  return gates;
}

function verifyNewInstallPrepared({ local, state, githubApi }) {
  if (state.macos_setup_approved !== true || state.github_plugin_authorized === false || state.github_plugin_authorization_verified !== true ||
      (state.github_plugin_authorization_installation_id !== undefined && state.github_plugin_authorization_installation_id !== state.installation_id) ||
      (state.github_plugin_authorization_control_repository !== undefined && state.github_plugin_authorization_control_repository !== state.control_repository) ||
      (state.github_plugin_authorization_sandbox_repository !== undefined && state.github_plugin_authorization_sandbox_repository !== state.sandbox_repository) ||
      (state.github_plugin_authorization_chat_url !== undefined && canonicalUrl(state.github_plugin_authorization_chat_url) !== canonicalUrl(state.reviewer_chat_url)) ||
      state.control_environment_ready !== true || state.target_environment_ready === true ||
      !local.control?.ok || !local.intent?.ok || !local.routeFile?.ok) return null;
  const control = local.control.value;
  const intent = local.intent.value;
  const routes = routeRecords(local.routeFile.value);
  const selected = routes.filter(item => item.route === state.sandbox_review_route && item.project === state.sandbox_project_key && item.status === "active");
  if (intent.phase !== "PREPARED" || intent.installation_id !== state.installation_id ||
      intent.generated_repositories?.control !== state.control_repository || intent.generated_repositories?.sandbox !== state.sandbox_repository ||
      control.instance_id !== state.instance_id || control.installation_id !== state.installation_id ||
      control.control_repository !== state.control_repository || control.sandbox_repository !== state.sandbox_repository ||
      control.role !== "control" || !repositoryOriginMatches(control.origin, state.control_repository) ||
      !repositoryOriginMatches(control.remote_origin, state.control_repository) || selected.length > 1 || routes.filter(item => item.route === state.sandbox_review_route).length > 1) return null;
  try {
    const hasRoute = Boolean(state.sandbox_review_route) && selected.length === 1 && routes.filter(item => item.route === state.sandbox_review_route).length === 1;
    if (!hasRoute && routes.length === 0) {
      const provenance = independentlyVerifiedProvenanceWithoutIssue({ state, githubApi });
      return diagnostic("NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE", ["active_unique_route", "trusted_manifest"], { provenance: { control_repository_id: provenance.control_repository_id, sandbox_repository_id: provenance.sandbox_repository_id } });
    }
    if (!hasRoute) return null;
    const provenance = independentlyVerifiedProvenance({ state, githubApi, routeFile: local.routeFile, issueId: selected[0].registration_issue });
    return diagnostic("NEW_INSTALL_PREPARED", ["trusted_manifest"], { provenance: { control_repository_id: provenance.control_repository_id, sandbox_repository_id: provenance.sandbox_repository_id, registration_issue_id: provenance.registration_issue_id } });
  } catch { return null; }
}

function independentlyVerifiedProvenanceWithoutIssue({ state, githubApi }) {
  const remoteControl = remoteRepository(githubApi, state.control_repository);
  const remoteSandbox = remoteRepository(githubApi, state.sandbox_repository);
  if (!remoteControl?.id || !remoteSandbox?.id ||
      !repositoryMatches(remoteControl, state.control_repository, "control", remoteControl.id) ||
      !repositoryMatches(remoteSandbox, state.sandbox_repository, "sandbox", remoteSandbox.id)) throw new Error("independent GitHub repository provenance is contradictory");
  return { control_repository_id: String(remoteControl.id), sandbox_repository_id: String(remoteSandbox.id) };
}

export function verifyTrustedRecoveryEvidence({ state = {}, home = os.homedir(), fsImpl = fs, githubApi, requireReceipt = true } = {}) {
  const local = localProof({ state, home, fsImpl });
  if (local.status === "ABSENT" && !state?.control_environment_ready && !state?.instance_root) return diagnostic("ABSENT", local.gates);
  if (local.status === "CONFLICT") return diagnostic("CONFLICT", local.gates);
  if (local.status === "ABSENT" && !requireReceipt) {
    const prepared = verifyNewInstallPrepared({ local, state, githubApi });
    if (prepared) return prepared;
  }
  if (local.status === "ABSENT" && requireReceipt) return diagnostic("NEEDS_HUMAN_LEGACY", ["trusted_manifest", "independent_provenance"]);
  const gates = verifyLocalIdentity(local, state);
  if (gates.length) return diagnostic(local.status === "PRESENT" ? "CONFLICT" : "NEEDS_HUMAN_LEGACY", gates);
  const manifest = local.receipt.value;
  let provenance;
  try {
    provenance = independentlyVerifiedProvenance({ state, githubApi, routeFile: local.routeFile, issueId: manifest.registration_issue_id });
  } catch {
    return diagnostic("CONFLICT", ["independent_github_provenance"], { reason: "offline-or-unavailable" });
  }
  const { remoteControl, remoteSandbox, issue } = provenance;
  if (String(remoteControl.id) !== String(manifest.control_repository_id) || String(remoteSandbox.id) !== String(manifest.sandbox_repository_id)) return diagnostic("CONFLICT", ["private_repository_identity"]);
  const body = issueBody(issue);
  const author = issue?.user?.login;
  const expectedAuthor = manifest.registration_issue_author;
  const issueUrl = canonicalUrl(body?.chat_url);
  const reviewerUrl = canonicalUrl(state.reviewer_chat_url);
  if (!issueUrl || !reviewerUrl || String(author || "") !== String(expectedAuthor || "") || body?.project !== state.sandbox_project_key || issueUrl !== reviewerUrl || body?.installation_id !== state.installation_id || Number(issue?.number) !== Number(manifest.registration_issue_id)) return diagnostic("CONFLICT", ["registration_issue_identity"]);
  const routeFile = local.routeFile?.value;
  const routes = routeRecords(routeFile);
  const selected = routes.filter(item => item.route === state.sandbox_review_route && item.project === state.sandbox_project_key && item.status === "active");
  if (selected.length !== 1 || routes.filter(item => item.route === state.sandbox_review_route).length !== 1 || routes.filter(item => item.project === state.sandbox_project_key && item.status === "active").length !== 1) return diagnostic("CONFLICT", ["active_unique_route"]);
  if (registrationIssueIdFromState({ ...state, sandbox_chat_registration_issue: selected[0].registration_issue }, local.routeFile) !== Number(manifest.registration_issue_id)) return diagnostic("CONFLICT", ["route_registration_binding"]);
  const identityInputs = { installation_id: state.installation_id, instance_id: state.instance_id, control_repository: state.control_repository, sandbox_repository: state.sandbox_repository, control_repository_id: manifest.control_repository_id, sandbox_repository_id: manifest.sandbox_repository_id, registration_issue_id: manifest.registration_issue_id, registration_issue_author: manifest.registration_issue_author, project: state.sandbox_project_key, chat_url: reviewerUrl };
  if (manifest.identity_sha256 !== hash(identityInputs)) return diagnostic("CONFLICT", ["identity_hash"]);
  return diagnostic("VERIFIED", [], { installation_id: state.installation_id, instance_id: state.instance_id, identity_sha256: manifest.identity_sha256, provenance: { control_repository_id: String(remoteControl.id), sandbox_repository_id: String(remoteSandbox.id), registration_issue_id: Number(issue.number) } });
}

export function issueTrustedRecoveryEvidence({ state = {}, home = os.homedir(), fsImpl = fs, githubApi, issueId } = {}) {
  if (state.macos_setup_approved !== true || state.github_plugin_authorization_verified !== true || state.target_environment_ready === true) throw new Error("official installer approval and independent GitHub authorization are required");
  if (!state.instance_id || !state.installation_id || !state.control_repository || !state.sandbox_repository || !state.sandbox_review_route) throw new Error("complete installer identity is required");
  const instanceRoot = path.resolve(state.instance_root || path.join(home, ".chatgpt-codex-orchestrator", "instances", state.instance_id));
  const paths = canonicalLocalPaths({ state, home, instanceRoot });
  if (!paths.ok) throw new Error(`local trust path is not canonical: ${paths.reason}`);
  const file = path.join(instanceRoot, "trusted-recovery-evidence-v1.json");
  const local = localProof({ state, home, fsImpl });
  if (local.status === "CONFLICT") throw new Error("local trust evidence is contradictory");
  const localGates = verifyLocalIdentity({ ...local, receipt: local.receipt || { present: false } }, state).filter(gate => gate !== "trusted_manifest_version");
  if (localGates.length) throw new Error(`local trust evidence is incomplete: ${localGates.join(", ")}`);
  const routeFile = local.routeFile;
  const routes = routeRecords(routeFile.value);
  const selected = routes.filter(item => item.route === state.sandbox_review_route && item.project === state.sandbox_project_key && item.status === "active");
  if (!routeFile.ok || selected.length !== 1 || routes.filter(item => item.route === state.sandbox_review_route).length !== 1 || routes.filter(item => item.project === state.sandbox_project_key && item.status === "active").length !== 1) throw new Error("actual active route receipt is missing or ambiguous");
  const verified = independentlyVerifiedProvenance({ state, githubApi, routeFile, issueId: issueId || selected[0].registration_issue });
  if (registrationIssueIdFromState({ ...state, sandbox_chat_registration_issue: selected[0].registration_issue }, routeFile) !== verified.registration_issue_id) throw new Error("active route is not bound to the independently queried registration issue");
  const inputs = { installation_id: state.installation_id, instance_id: state.instance_id, control_repository: state.control_repository, sandbox_repository: state.sandbox_repository, control_repository_id: verified.control_repository_id, sandbox_repository_id: verified.sandbox_repository_id, registration_issue_id: verified.registration_issue_id, registration_issue_author: verified.registration_issue_author, project: state.sandbox_project_key, chat_url: canonicalUrl(state.reviewer_chat_url) };
  if (!inputs.chat_url) throw new Error("reviewer Chat URL is invalid");
  const value = { schema_version: TRUSTED_RECOVERY_EVIDENCE_VERSION, status: "VERIFIED", ...inputs, identity_sha256: hash(inputs), issued_at: new Date().toISOString() };
  const parent = secureParent(fsImpl, file, home);
  if (!parent.ok) throw new Error(`trusted manifest parent is unsafe: ${parent.reason}`);
  fsImpl.mkdirSync(instanceRoot, { recursive: true, mode: 0o700 });
  const existing = lstat(fsImpl, file);
  if (existing.stat) {
    if (existing.stat.isSymbolicLink() || !existing.stat.isFile() || !own(existing.stat) || mode(existing.stat) !== 0o600 || existing.stat.nlink !== 1) throw new Error("existing trusted manifest is unsafe");
    let current;
    try { current = JSON.parse(fsImpl.readFileSync(file, "utf8")); } catch { throw new Error("existing trusted manifest is malformed"); }
    const immutable = ["schema_version", "status", ...Object.keys(inputs), "identity_sha256"];
    if (immutable.some(key => current[key] !== value[key]) || typeof current.issued_at !== "string" || !current.issued_at) throw new Error("existing trusted manifest conflicts; refusing overwrite");
    return { status: "VERIFIED", path: file, idempotent: true, manifest: { ...current } };
  }
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd = fsImpl.openSync(temp, "wx", 0o600);
  try { fsImpl.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
  fsImpl.renameSync(temp, file);
  const dirfd = fsImpl.openSync(instanceRoot, "r"); try { fsImpl.fsyncSync(dirfd); } finally { fsImpl.closeSync(dirfd); }
  fsImpl.chmodSync(file, 0o600);
  return { status: "VERIFIED", path: file, idempotent: false, manifest: value };
}

export function githubReadOnlyApi({ run } = {}) {
  if (typeof run !== "function") throw new Error("read-only GitHub API runner is required");
  const json = args => { const result = run(args); if (!result?.ok) throw new Error("GitHub API unavailable"); return JSON.parse(result.stdout || "{}"); };
  return { getRepository: repository => json(["api", `repos/${repository}`]), getIssue: (repository, number) => json(["api", `repos/${repository}/issues/${number}`]) };
}
