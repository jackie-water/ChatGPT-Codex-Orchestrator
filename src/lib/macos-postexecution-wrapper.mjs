import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { getValidatedMacosCodexPlan } from "./macos-codex-run-contract.mjs";
import { prepareFailureForAuthorizedSnapshot, persistFailure, hasTrustedDeliveryProof } from "./run-failure-state.mjs";
import { validateCallbackState } from "../../runtime/scripts/callback-delivery.mjs";

const SHA = /^[0-9a-f]{40}$/;
const MAX_TIMEOUT = 30 * 60 * 1000;
const OUTPUT_LIMIT = 8192;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const problem = code => Object.assign(new Error(code), { code });
const refSafe = ref => typeof ref === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref)
  && ref.split("/").every(p => p && !p.startsWith(".") && !p.endsWith(".") && !p.includes("..") && !p.endsWith(".lock"));

// Include the leaf: a lexical prefix alone cannot authorize repository writes.
function safePath(value, missing = false) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw problem("UNTRUSTED_PATH");
  const absolute = path.resolve(value);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw problem("SYMLINKED_PATH"); }
    catch (error) { if (missing && error.code === "ENOENT") break; throw error; }
  }
  return absolute;
}
function exists(file) { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } }
function expectedBrowserPort(instanceId) {
  const hex = String(instanceId).replace(/[^0-9a-f]/gi, "").slice(0, 6);
  const n = Number.parseInt(hex || "0", 16);
  return 10000 + (Number.isFinite(n) ? n % 40000 : 0);
}
function psValue(line, name) {
  const match = line.match(new RegExp(`^\\$env:${name} = '((?:''|[^'])*)'$`));
  if (!match) throw problem("INVALID_INSTANCE_CONFIG");
  return match[1].replaceAll("''", "'");
}
export function verifiedBrowserBinding(snapshot) {
  const root = safePath(snapshot.instance_root);
  const config = safePath(path.join(root, "config.ps1"));
  const routeFile = safePath(path.join(root, "chat-routes.json"));
  const lines = privateFile(config).toString("utf8").split(/\r?\n/).filter(Boolean);
  const fields = new Map();
  for (const line of lines) {
    if (!line.startsWith("$env:")) continue;
    const match = line.match(/^\$env:([A-Z0-9_]+) = '/);
    if (!match || fields.has(match[1])) throw problem("INVALID_INSTANCE_CONFIG");
    fields.set(match[1], psValue(line, match[1]));
  }
  const expectedProfile = path.join(root, "browser-profile");
  const expected = {
    ORCHESTRATOR_INSTANCE_ID: `runner-${snapshot.instance_id}`,
    ORCHESTRATOR_BROWSER_DEBUG_PORT: String(expectedBrowserPort(snapshot.instance_id)),
    ORCHESTRATOR_BROWSER_PROFILE: expectedProfile,
    CODEX_CHAT_ROUTE_FILE: routeFile
  };
  for (const [key, value] of Object.entries(expected)) if (fields.get(key) !== value) throw problem("INSTANCE_CONFIG_MISMATCH");
  const port = Number(fields.get("ORCHESTRATOR_BROWSER_DEBUG_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw problem("INVALID_BROWSER_PORT");
  const routes = JSON.parse(privateFile(routeFile).toString("utf8"));
  if (!Array.isArray(routes.routes)) throw problem("ROUTE_FILE_MISMATCH");
  const routeKeyMatches = routes.routes.filter(record => record?.route === snapshot.plan.review_route);
  const matches = routeKeyMatches.filter(record => record?.project === snapshot.plan.project
    && record?.status === "active" && record?.chat_url === snapshot.authorization.chat_url);
  if (routeKeyMatches.length !== 1 || matches.length !== 1) throw problem("ROUTE_FILE_MISMATCH");
  return { port, profile: expectedProfile, instanceId: `runner-${snapshot.instance_id}` };
}
export function attemptMacosChatDelivery(snapshot, callback, spawnWake = childProcess.spawnSync) {
  if(!callback?.callback_id || callback.callback_state === "DELIVERED") return callback;
  const file=path.join(snapshot.instance_root,"pending-wakes",`${callback.callback_id}.json`);
  const wake=path.join(snapshot.controlRoot,"scripts","wake-chat.mjs");
  try { const stored=JSON.parse(fs.readFileSync(file,"utf8")); if(stored.callback_id!==callback.callback_id||stored.chat_url!==snapshot.authorization.chat_url)throw problem("CALLBACK_IDENTITY_CONFLICT"); const binding=verifiedBrowserBinding(snapshot); const reconcileOnly=stored.delivery_state!=="PENDING"; spawnWake(process.execPath,[wake,stored.message],{encoding:"utf8",timeout:95000,env:{...process.env,ORCHESTRATOR_CHAT_URL:snapshot.authorization.chat_url,ORCHESTRATOR_BROWSER_DEBUG_PORT:String(binding.port),ORCHESTRATOR_BROWSER_PROFILE:binding.profile,ORCHESTRATOR_INSTANCE_ID:binding.instanceId,CODEX_CALLBACK_ID:callback.callback_id,CODEX_CALLBACK_STATE_FILE:file,CODEX_CALLBACK_EXPECTED_FINGERPRINT:digest(fs.readFileSync(file)),...(reconcileOnly?{CODEX_RECONCILE_ONLY:"1"}:{})}}); const final=JSON.parse(fs.readFileSync(file,"utf8")); const delivered=final.callback_id===callback.callback_id&&final.chat_url===snapshot.authorization.chat_url&&final.delivery_state==="DELIVERED"&&hasTrustedDeliveryProof(final); const callbackState=delivered?"DELIVERED":final.delivery_state==="DELIVERED"?"PENDING":final.delivery_state; return {callback_id:callback.callback_id,callback_state:callbackState,delivery_status:delivered?"DELIVERED":"PENDING"}; } catch { return {...callback,delivery_status:"PENDING"}; }
}
function directory(dir) {
  safePath(dir, true);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(safePath(dir));
  if (!st.isDirectory() || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw problem("UNTRUSTED_STATE_DIRECTORY");
  fs.chmodSync(dir, 0o700);
}
function trustedCloneDirectories(base, repo) {
  for (let dir = repo; ; dir = path.dirname(dir)) {
    const st = fs.lstatSync(safePath(dir));
    if (!st.isDirectory() || (st.mode & 0o022) || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw problem("UNTRUSTED_CLONE");
    if (dir === base) break;
    if (dir === path.dirname(dir)) throw problem("UNTRUSTED_CLONE");
  }
}
function privateFile(file, callback = false) {
  safePath(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    // Existing receipt writers may retain a readable mode; neither ledger nor
    // callback records may be writable by another account.
    if (!st.isFile() || st.nlink !== 1 || (st.mode & (callback ? 0o022 : 0o077)) !== 0 || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw problem("UNTRUSTED_STATE_FILE");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function syncDirectory(dir) { const fd = fs.openSync(dir, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeJson(file, value, exclusive = false) {
  directory(path.dirname(file)); safePath(file, true);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    if (exclusive) { fs.linkSync(temp, file); fs.unlinkSync(temp); }
    else { if (exists(file)) privateFile(file); fs.renameSync(temp, file); }
    syncDirectory(path.dirname(file));
  } finally { if (exists(temp)) fs.unlinkSync(temp); }
}
function cleanEnvironment() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1" };
}
function redact(value) {
  let result = String(value);
  for (const [key, secret] of Object.entries(process.env)) if (/(?:token|secret|password|api_?key)/i.test(key) && secret.length >= 8) result = result.split(secret).join("[REDACTED]");
  return result.replace(/\b(?:github_pat_|gh[opusr]_)[A-Za-z0-9_]+/gi, "[REDACTED]")
    .replace(/((?:authorization\s*:\s*)?(?:bearer|token)\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|secret|password|token)\s*[:=]\s*)\S+/gi, "$1[REDACTED]");
}
function executable(command, repo, env) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command) || /^(?:ba|da|z|fi|c|k)?sh$|^(?:cmd|powershell|pwsh)$/i.test(command)) throw problem("UNSAFE_VALIDATOR_EXECUTABLE");
  for (const dir of (env.PATH || "").split(path.delimiter).filter(path.isAbsolute)) {
    let candidate; try { candidate = fs.realpathSync(path.join(dir, command)); } catch { continue; }
    if (candidate === repo || candidate.startsWith(`${repo}${path.sep}`)) continue;
    const st = fs.statSync(candidate);
    if (!st.isFile() || !(st.mode & 0o111) || (st.mode & 0o022) || (typeof process.getuid === "function" && ![0, process.getuid()].includes(st.uid))) continue;
    let parent = path.dirname(candidate), trusted = true;
    while (parent !== path.dirname(parent)) {
      const p = fs.statSync(parent);
      const systemTemp = parent === "/private/tmp" && p.uid === 0 && (p.mode & 0o7777) === 0o1777;
      if (!systemTemp && ((p.mode & 0o022) || (typeof process.getuid === "function" && ![0, process.getuid()].includes(p.uid)))) { trusted = false; break; }
      parent = path.dirname(parent);
    }
    if (!trusted) continue;
    return candidate;
  }
  throw problem("VALIDATOR_EXECUTABLE_UNAVAILABLE");
}
function gitClient(repo, env) {
  const bin = executable("git", repo, env);
  const argv = args => ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", "-c", "push.followTags=false", "-C", repo, ...args];
  const run = (args, { input, extraEnv } = {}) => childProcess.spawnSync(bin, argv(args),
    { env: { ...env, ...extraEnv }, input, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, shell: false });
  const raw = (args, options) => { const r = run(args, options); if (r.error || r.status !== 0) throw problem("GIT_OPERATION_FAILED"); return r.stdout; };
  return { bin, argv, run, raw, text: (args, options) => raw(args, options).trim(), ancestor: (a, b) => {
    const r = run(["merge-base", "--is-ancestor", a, b]); if (r.error || ![0, 1].includes(r.status)) throw problem("GIT_ANCESTRY_UNVERIFIED"); return r.status === 0;
  } };
}
function origins(git, plan) {
  const allowed = [`https://github.com/${plan.repository}.git`, `git@github.com:${plan.repository}.git`];
  for (const args of [["remote", "get-url", "--all", "origin"], ["remote", "get-url", "--push", "--all", "origin"]]) {
    const urls = git.text(args).split(/\r?\n/);
    if (urls.length !== 1 || !allowed.includes(urls[0])) throw problem("ORIGIN_URL_MISMATCH");
  }
  const mirror = git.run(["config", "--bool", "--get", "remote.origin.mirror"]);
  if (mirror.error || ![0, 1].includes(mirror.status) || mirror.stdout.trim() === "true") throw problem("UNSAFE_ORIGIN_MIRROR");
}
function sourceGuard(git, plan, sha, defaultSha) {
  origins(git, plan);
  if (git.text(["branch", "--show-current"]) !== plan.target_branch) throw problem("SOURCE_BRANCH_DRIFT");
  const head = git.text(["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!SHA.test(head) || (sha && head !== sha)) throw problem("SOURCE_SHA_DRIFT");
  if (defaultSha && git.text(["rev-parse", "--verify", `refs/remotes/origin/${plan.default_branch}^{commit}`]) !== defaultSha) throw problem("DEFAULT_SHA_DRIFT");
  return head;
}
const status = git => git.raw(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]);
const names = text => text.split("\0").filter(Boolean);

// Only ESRCH proves the private group absent. Parent exit also reaps children.
function runValidator(repo, bin, args, env, timeoutMs) {
  return new Promise(resolve => {
    let child, groupPid, timer, killTimer, poll, deadline, settled = false, stopping = false, timedOut = false;
    let output = "", exitCode = null, spawnError;
    const present = () => { if (!Number.isInteger(groupPid) || groupPid <= 1 || groupPid === process.pid) return true; try { process.kill(-groupPid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } };
    const signal = sig => { if (!Number.isInteger(groupPid) || groupPid <= 1 || groupPid === process.pid) return false; try { process.kill(-groupPid, sig); return true; } catch (e) { return e.code === "ESRCH"; } };
    const finish = uncertain => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer); clearInterval(poll); clearTimeout(deadline);
      if (uncertain) { child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref(); }
      resolve({ exit_code: exitCode, timed_out: timedOut, termination_verified: !uncertain, ...(spawnError ? { error: "SPAWN_FAILED" } : {}), output: redact(output).slice(0, OUTPUT_LIMIT) });
    };
    const stop = () => {
      if (settled || stopping) return;
      stopping = true;
      if (!present()) return finish(false);
      if (!signal("SIGTERM")) return finish(true);
      poll = setInterval(() => { if (!present()) finish(false); }, 25);
      killTimer = setTimeout(() => {
        if (!present()) return finish(false);
        if (!signal("SIGKILL")) return finish(true);
        deadline = setTimeout(() => finish(present()), 500);
      }, 1000);
    };
    try { child = childProcess.spawn(bin, args, { cwd: repo, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { spawnError = true; return finish(false); }
    groupPid = child.pid;
    const append = chunk => { if (output.length < OUTPUT_LIMIT * 4) output += chunk.toString().slice(0, OUTPUT_LIMIT * 4 - output.length); };
    child.stdout.on("data", append); child.stderr.on("data", append);
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.on("error", () => { spawnError = true; if (!groupPid) finish(false); else stop(); });
    child.on("exit", code => { exitCode = code; stop(); });
    child.on("close", code => { exitCode = code; if (!stopping) stop(); });
  });
}
function remoteHead(git, branch) {
  const ref = `refs/heads/${branch}`;
  const lines = git.text(["ls-remote", "--heads", "origin", ref]).split("\n").filter(Boolean);
  if (!lines.length) return null;
  if (lines.length !== 1) throw problem("REMOTE_HEAD_UNVERIFIED");
  const [sha, name] = lines[0].split(/\s+/);
  if (!SHA.test(sha) || name !== ref) throw problem("REMOTE_HEAD_UNVERIFIED");
  return sha;
}
function exactReport(git, commit, file, report) {
  if (!SHA.test(commit) || git.raw(["show", `${commit}:${file}`]) !== report) throw problem("CHECKPOINT_CONTENT_MISMATCH");
}
function checkpointPath(plan, sha) { return `.codex/runs/by-issue/${plan.issue}/iteration-${plan.iteration}__${sha.slice(0, 12)}.md`; }
function renderReport(plan, ledger, data) {
  return `<!-- CODEX_MACOS_POSTEXECUTION_V1 -->\n# Codex run\n\n` + [
    ["project", plan.project], ["repository", plan.repository], ["orchestrator_issue", plan.issue], ["iteration", plan.iteration],
    ["status", data.validation_state === "PASSED" ? "VALIDATED_SOURCE" : "VALIDATION_FAILED"],
    ["source_branch", plan.target_branch], ["pre_execution_commit", ledger.observed_head], ["post_execution_commit", ledger.post_execution_head],
    ["source_commit", data.source_commit], ["default_commit", ledger.observed_remote_default], ["validation", data.validation_state], ["source_push", data.source_push_state || "NOT_PUSHED"],
  ].map(([k, v]) => `- ${k}: ${v}`).join("\n") + "\n\nChanged files (JSON):\n\n" + redact(JSON.stringify(data.changed_files)) +
    "\n\nValidation evidence (JSON):\n\n" + redact(JSON.stringify(data.validation, null, 2)) + "\n";
}
function publishCheckpoint(git, plan, data, guard, save) {
  guard();
  const branch = plan.checkpoint_branch;
  const base = remoteHead(git, branch);
  if (!base) throw problem("CHECKPOINT_BRANCH_MISSING");
  git.text(["fetch", "--no-tags", "--no-write-fetch-head", "--refmap=", "origin", `refs/heads/${branch}`]);
  if (remoteHead(git, branch) !== base) throw problem("CHECKPOINT_HEAD_DRIFT");
  const file = checkpointPath(plan, data.source_commit);
  const entries = names(git.raw(["ls-tree", "-r", "--name-only", "-z", base, "--", `.codex/runs/by-issue/${plan.issue}/`]))
    .filter(p => path.posix.basename(p).startsWith(`iteration-${plan.iteration}__`));
  if (entries.length) {
    if (entries.length !== 1 || entries[0] !== file) throw problem("CHECKPOINT_ITERATION_CONFLICT");
    exactReport(git, base, file, data.report);
    return { checkpoint_commit: base, checkpoint_path: file, checkpoint_branch: branch };
  }
  // A private temporary index avoids checkout/worktree mutation and cannot
  // follow symlinks from the checkpoint tree on the host filesystem.
  const indexDir = fs.mkdtempSync(path.join(data.state_directory, "checkpoint-index-"));
  let commit;
  try {
    const extraEnv = { GIT_INDEX_FILE: path.join(indexDir, "index"), GIT_AUTHOR_NAME: "Codex Orchestrator", GIT_AUTHOR_EMAIL: "codex-orchestrator@users.noreply.github.com", GIT_COMMITTER_NAME: "Codex Orchestrator", GIT_COMMITTER_EMAIL: "codex-orchestrator@users.noreply.github.com" };
    const blob = git.text(["hash-object", "-w", "--stdin"], { input: data.report });
    git.text(["read-tree", base], { extraEnv });
    git.text(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`], { extraEnv });
    const tree = git.text(["write-tree"], { extraEnv });
    commit = git.text(["commit-tree", tree, "-p", base, "-m", `chore(checkpoint): issue #${plan.issue} iteration ${plan.iteration}`], { extraEnv });
  } finally {
    for (const name of ["index", "index.lock"]) { const file = path.join(indexDir, name); if (exists(file)) fs.unlinkSync(safePath(file)); }
    fs.rmdirSync(indexDir);
  }
  if (!SHA.test(commit)) throw problem("CHECKPOINT_COMMIT_UNVERIFIED");
  exactReport(git, commit, file, data.report); guard();
  if (remoteHead(git, branch) !== base) throw problem("CHECKPOINT_HEAD_DRIFT");
  const coordinates = { checkpoint_commit: commit, checkpoint_path: file, checkpoint_branch: branch };
  save({ ...coordinates, phase: "CHECKPOINT_PUSH_ATTEMPTED" });
  git.run(["push", "--porcelain", "--no-follow-tags", "origin", `${commit}:refs/heads/${branch}`]);
  // A nonzero/timeout may have succeeded. Query; never blindly push again.
  if (remoteHead(git, branch) !== commit) throw problem("CHECKPOINT_PUSH_UNCONFIRMED");
  exactReport(git, commit, file, data.report);
  return coordinates;
}
function queueCallback(snapshot, data, allowCreate = true) {
  const plan = snapshot.plan;
  const callbackId = `codex-${plan.project}-${plan.issue}-${plan.iteration}-${data.source_commit}`;
  const message = `[CODEX-AUTO callback_id=${callbackId}] Project '${plan.project}' wrapper validation passed. Issue #${plan.issue}, iteration ${plan.iteration}/${plan.max_iterations}, repository ${plan.repository}, branch ${plan.target_branch}, source commit ${data.source_commit}. Authoritative report: checkpoint_commit=${data.checkpoint_commit} path=${data.checkpoint_path}. Read that exact report and source diff, then return PASS, REVISE, or NEEDS_HUMAN. Do not substitute .codex/latest-run.md. Treat callback_id as idempotent; do not create duplicate successor runs for this source commit. PASS is review-only. Merge requires the user's explicit approval for commit ${data.source_commit}.`;
  const file = path.join(snapshot.instance_root, "pending-wakes", `${callbackId}.json`);
  if (!exists(file) && !allowCreate) throw problem("CALLBACK_RECORD_MISSING");
  if (!exists(file)) writeJson(file, { version: 1, routing_version: "explicit-route-v1", delivery_state: "PENDING", callback_id: callbackId,
    chat_url: snapshot.authorization.chat_url, message, source_commit: data.source_commit, checkpoint_commit: data.checkpoint_commit,
    checkpoint_path: data.checkpoint_path, queued_at_utc: new Date().toISOString() }, true);
  const current = JSON.parse(privateFile(file, true));
  validateCallbackState(current, { callbackId, chatUrl: snapshot.authorization.chat_url, message });
  if (current.source_commit !== data.source_commit || current.checkpoint_commit !== data.checkpoint_commit || current.checkpoint_path !== data.checkpoint_path
    || (current.delivery_state === "DELIVERED" && !hasTrustedDeliveryProof(current))) throw problem("CALLBACK_IDENTITY_CONFLICT");
  return { callback_id: callbackId, callback_state: current.delivery_state };
}

export async function finalizeMacosCodexRun({ planned, repoPath, controlRoot, trustedGithubUsername, timeoutMs = MAX_TIMEOUT }) {
  const snapshot = getValidatedMacosCodexPlan(planned);
  if (controlRoot !== snapshot.controlRoot || JSON.stringify(trustedGithubUsername) !== JSON.stringify(snapshot.trustedGithubUsername)) throw problem("AUTHORITY_MISMATCH");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT) throw problem("INVALID_VALIDATION_TIMEOUT");
  const { plan, instance_root: base } = snapshot;
  const currentBase = path.join(fs.realpathSync(process.env.HOME || process.env.USERPROFILE || "/tmp"), ".chatgpt-codex-orchestrator", "instances", snapshot.instance_id);
  if (currentBase !== base) throw problem("INSTANCE_HOME_MISMATCH");
  const id = `${plan.project}-${plan.issue}-${plan.iteration}`;
  const ledgerFile = path.join(base, "macos-execution-ledger", `${id}.json`);
  const stateDir = path.join(base, "macos-finalization");
  const stateFile = path.join(stateDir, `${id}.json`);
  let data, lock, ledgerBytes, ledger, repo, git, stage = "preflight", owned = false;
  const save = patch => { data = { ...data, ...patch }; writeJson(stateFile, data); };
  const inputGuard = () => {
    if (!privateFile(ledgerFile).equals(ledgerBytes)) throw problem("EXECUTION_LEDGER_DRIFT");
    safePath(repo);
    trustedCloneDirectories(base, repo);
    for (const p of [".git", ".git/config", ".git/objects", ".git/refs", ".git/HEAD", ".git/index", ".git/packed-refs"]) safePath(path.join(repo, p), true);
  };
  try {
    ledgerBytes = privateFile(ledgerFile); ledger = JSON.parse(ledgerBytes);
    if (ledger.version !== 1 || ledger.execution_state !== "EXECUTED_UNVALIDATED" || ledger.validation_state !== "NOT_RUN" || ledger.exit_code !== 0
      || ledger.project !== plan.project || ledger.issue !== plan.issue || ledger.iteration !== plan.iteration || ledger.instance_id !== snapshot.instance_id
      || ledger.authorization_digest !== snapshot.authorization_digest || ledger.observed_repository !== plan.repository || ledger.observed_branch !== plan.target_branch
      || !SHA.test(ledger.observed_head) || !SHA.test(ledger.post_execution_head) || !SHA.test(ledger.observed_remote_default)) throw problem("EXECUTION_LEDGER_UNAUTHORIZED");
    if (!refSafe(plan.target_branch) || !/^(codex|chore|fix|feat|refactor|test|docs|spike)\//.test(plan.target_branch)
      || ["main", "master", plan.default_branch].includes(plan.target_branch)) throw problem("PROTECTED_TASK_BRANCH");
    if (!refSafe(plan.checkpoint_branch) || ["main", "master", plan.default_branch, plan.target_branch].includes(plan.checkpoint_branch)) throw problem("PROTECTED_CHECKPOINT_BRANCH");
    if (typeof repoPath !== "string" || !path.isAbsolute(repoPath) || repoPath !== ledger.repo_path) throw problem("CLONE_IDENTITY_MISMATCH");
    repo = safePath(repoPath);
    if (!repo.startsWith(`${base}${path.sep}automation${path.sep}`)) throw problem("UNTRUSTED_CLONE");
    trustedCloneDirectories(base, repo);
    const repoStat = fs.lstatSync(repo), meta = path.join(repo, ".git");
    if (!repoStat.isDirectory() || (repoStat.mode & 0o022) || (typeof process.getuid === "function" && repoStat.uid !== process.getuid())
      || !fs.lstatSync(safePath(meta)).isDirectory()) throw problem("UNTRUSTED_CLONE");
    safePath(path.join(meta, "config")); safePath(path.join(meta, "objects")); safePath(path.join(meta, "refs"));
    for (const p of ["commondir", "objects/info/alternates"]) if (exists(path.join(meta, p))) throw problem("SHARED_GIT_DIRECTORY");
    directory(stateDir);
    lock = path.join(stateDir, `${id}.lock`);
    try { writeJson(lock, { pid: process.pid, authorization_digest: snapshot.authorization_digest }, true); } catch (error) { if (error.code === "EEXIST") throw problem("FINALIZATION_BUSY"); throw error; }
    owned = true;
    const env = cleanEnvironment();
    // Check all configured argv before staging anything. The trusted snapshot
    // already applied the registry allowlist; never read caller plan fields.
    if (plan.validation_steps.length > 64) throw problem("VALIDATION_PROFILE_TOO_LARGE");
    const validators = plan.validation_steps.map(step => {
      if (!step.arguments.every(arg => typeof arg === "string" && !arg.includes("\0"))) throw problem("INVALID_VALIDATION_ARGV");
      return executable(step.command, repo, env);
    });
    git = gitClient(repo, env);
    if (git.text(["rev-parse", "--show-toplevel"]) !== repo || git.text(["rev-parse", "--absolute-git-dir"]) !== meta) throw problem("UNTRUSTED_GIT_DIRECTORY");
    inputGuard(); origins(git, plan);
    if (exists(stateFile)) {
      const existing = JSON.parse(privateFile(stateFile));
      if (existing.version !== 1 || existing.authorization_digest !== snapshot.authorization_digest || existing.ledger_digest !== digest(ledgerBytes)
        || existing.project !== plan.project || existing.issue !== plan.issue || existing.iteration !== plan.iteration || existing.repo_path !== repo) throw problem("FINALIZATION_IDENTITY_CONFLICT");
      data = existing;
      if (["CHECKPOINT_PUSH_ATTEMPTED", "PUBLISHED", "COMPLETE"].includes(data.phase)) {
        if (!SHA.test(data.source_commit) || !SHA.test(data.checkpoint_commit) || data.checkpoint_path !== checkpointPath(plan, data.source_commit)
          || data.checkpoint_branch !== plan.checkpoint_branch || data.validation_state !== "PASSED" || data.report !== renderReport(plan, ledger, data)) throw problem("PUBLICATION_IDENTITY_CONFLICT");
        sourceGuard(git, plan, data.source_commit, ledger.observed_remote_default);
        const checkpointHead = remoteHead(git, plan.checkpoint_branch);
        if (status(git) || remoteHead(git, plan.target_branch) !== data.source_commit || !checkpointHead
          || (checkpointHead !== data.checkpoint_commit && !git.ancestor(data.checkpoint_commit, checkpointHead))) throw problem("PUBLICATION_DRIFT");
        inputGuard();
        exactReport(git, data.checkpoint_commit, data.checkpoint_path, data.report);
        const allowCreate = data.phase !== "COMPLETE" && !data.callback_id;
        save({ phase: "PUBLISHED" });
        const callback = attemptMacosChatDelivery(snapshot, queueCallback(snapshot, data, allowCreate));
        save({ phase: "COMPLETE", execution_state: "READY_FOR_REVIEW", state: "READY_FOR_REVIEW", ...callback });
        return data;
      }
      if (data.failure) {
        const terminal = data.execution_state === "VALIDATED_FAILURE" ? "VALIDATED_FAILURE" : "UNKNOWN";
        return { ...data, execution_state: terminal, state: terminal };
      }
      // Query an interrupted source push for truthful evidence, but do not
      // repeat it or revalidate automatically after an interrupted claim.
      if (data.phase === "SOURCE_PUSH_ATTEMPTED") save({ source_push_state: remoteHead(git, plan.target_branch) === data.source_commit ? "VERIFIED" : "UNKNOWN" });
      throw problem("FINALIZATION_INTERRUPTED");
    }
    data = { version: 1, phase: "CLAIMED", execution_state: "UNKNOWN", project: plan.project, issue: plan.issue, iteration: plan.iteration,
      authorization_digest: snapshot.authorization_digest, ledger_digest: digest(ledgerBytes), repo_path: repo, state_directory: stateDir,
      validation_state: "NOT_RUN", validation: [], changed_files: [], source_push_state: "NOT_PUSHED" };
    writeJson(stateFile, data, true);
    const pre = sourceGuard(git, plan, ledger.post_execution_head, ledger.observed_remote_default);
    if (!git.ancestor(ledger.observed_head, pre)) throw problem("PRE_EXECUTION_SHA_DIVERGED");
    stage = "git"; inputGuard();
    if (status(git)) {
      git.text(["diff", "--check", "HEAD", "--"]);
      save({ phase: "COMMIT_ATTEMPTED" });
      git.text(["add", "--all", "--", "."]);
      sourceGuard(git, plan, pre, ledger.observed_remote_default); inputGuard();
      git.text(["diff", "--cached", "--check"]);
      if (git.raw(["diff", "--cached", "--name-only", "-z"])) git.text(["-c", "user.name=Codex Orchestrator", "-c", "user.email=codex-orchestrator@users.noreply.github.com", "commit", "--author=Codex Orchestrator <codex-orchestrator@users.noreply.github.com>", "-m", `codex: issue #${plan.issue} iteration ${plan.iteration}`]);
    }
    const sha = sourceGuard(git, plan, undefined, ledger.observed_remote_default);
    if (!git.ancestor(pre, sha) || status(git)) throw problem("POST_COMMIT_STATE_UNVERIFIED");
    save({ phase: "VALIDATING", source_commit: sha, changed_files: names(git.raw(["diff", "--name-only", "-z", `${ledger.observed_remote_default}...${sha}`, "--"])) });
    const stable = () => { inputGuard(); sourceGuard(git, plan, sha, ledger.observed_remote_default); if (status(git)) throw problem("VALIDATION_TREE_DRIFT"); };
    stage = "validation"; stable();
    const integrity = await runValidator(repo, git.bin, git.argv(["diff", "--no-ext-diff", "--no-textconv", "--check", `${ledger.observed_remote_default}...${sha}`, "--"]), env, timeoutMs);
    const results = [{ name: "git diff --check", ...integrity }];
    save({ validation: results });
    if (!integrity.termination_verified) throw problem("VALIDATOR_TERMINATION_UNVERIFIED");
    for (const [i, step] of plan.validation_steps.entries()) {
      if (results.some(r => r.exit_code !== 0 || r.timed_out)) break;
      stable();
      const result = await runValidator(repo, validators[i], [...step.arguments], env, timeoutMs);
      results.push({ name: redact(step.name), ...result }); save({ validation: results });
      if (!result.termination_verified) throw problem("VALIDATOR_TERMINATION_UNVERIFIED");
      stable();
      if (result.timed_out || result.exit_code !== 0) break;
    }
    stable();
    const passed = results.every(r => r.exit_code === 0 && !r.timed_out);
    save({ validation: results, validation_state: passed ? "PASSED" : "FAILED", phase: "VALIDATED" });
    if (!passed) throw problem("VALIDATION_FAILED");
    stage = "git";
    const head = remoteHead(git, plan.target_branch);
    if (head && head !== sha) {
      git.text(["fetch", "--no-tags", "--no-write-fetch-head", "--refmap=", "origin", `refs/heads/${plan.target_branch}`]);
      if (!git.ancestor(head, sha)) throw problem("SOURCE_REMOTE_DIVERGED");
    }
    stable();
    if (remoteHead(git, plan.target_branch) !== head) throw problem("SOURCE_REMOTE_DRIFT");
    if (head !== sha) {
      save({ phase: "SOURCE_PUSH_ATTEMPTED", source_push_state: "UNKNOWN", prior_remote_head: head });
      git.run(["push", "--porcelain", "--no-follow-tags", "origin", `${sha}:refs/heads/${plan.target_branch}`]);
      if (remoteHead(git, plan.target_branch) !== sha) throw problem("SOURCE_PUSH_UNCONFIRMED");
    }
    stable(); save({ phase: "SOURCE_PUBLISHED", source_push_state: "VERIFIED" });
    stage = "publish"; save({ report: renderReport(plan, ledger, data) });
    const publicationGuard = () => { stable(); if (remoteHead(git, plan.target_branch) !== sha) throw problem("SOURCE_PUBLICATION_DRIFT"); };
    const coordinates = publishCheckpoint(git, plan, data, publicationGuard, save);
    publicationGuard();
    if (remoteHead(git, plan.checkpoint_branch) !== coordinates.checkpoint_commit) throw problem("CHECKPOINT_PUBLICATION_DRIFT");
    save({ ...coordinates, phase: "PUBLISHED" });
    const callback = attemptMacosChatDelivery(snapshot, queueCallback(snapshot, data));
    save({ ...callback, phase: "COMPLETE", execution_state: "READY_FOR_REVIEW", state: "READY_FOR_REVIEW" });
    return data;
  } catch (error) {
    if (error.code === "FINALIZATION_BUSY") throw error;
    const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || "") ? error.code : "POSTEXECUTION_STATE_UNVERIFIED";
    const state = code === "VALIDATION_FAILED" ? "VALIDATED_FAILURE" : "UNKNOWN";
    const prepared = prepareFailureForAuthorizedSnapshot({ authorization: snapshot.authorization, stage, code, sourceCommit: SHA.test(data?.source_commit) ? data.source_commit : undefined });
    prepared.failure.execution_state = state === "UNKNOWN" ? "UNKNOWN" : "TERMINAL_FAILURE";
    let saved;
    try { saved = persistFailure(prepared); }
    catch { throw problem(code === "VALIDATOR_TERMINATION_UNVERIFIED" ? code : "POSTEXECUTION_INCIDENT_PERSIST_FAILED"); }
    if (owned && data) {
      try { save({ phase: data.phase === "PUBLISHED" ? "PUBLISHED" : "FAILED", execution_state: state, state,
        validation_state: stage === "validation" && data.validation_state !== "FAILED" ? "UNKNOWN" : data.validation_state,
        failure: saved.state, failure_callback_id: saved.state.callback_id }); }
      catch { throw problem("POSTEXECUTION_STATE_PERSIST_FAILED"); }
    }
    return { ...data, state, execution_state: state, failure: saved.state };
  } finally {
    if (owned) { fs.unlinkSync(safePath(lock)); syncDirectory(stateDir); }
  }
}
