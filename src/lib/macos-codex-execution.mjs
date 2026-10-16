import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { getValidatedMacosCodexPlan } from "./macos-codex-run-contract.mjs";
import { prepareFailureForAuthorizedSnapshot, persistFailure } from "./run-failure-state.mjs";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^(codex|chore|fix|feat|refactor|test|docs|spike)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const HOME = () => process.env.HOME || process.env.USERPROFILE || "/tmp";
const MAX_TIMEOUT = 30 * 60 * 1000;
const safe = p => path.resolve(p);
function privateDir(p) {
  const absolute = safe(p); const root = path.parse(absolute).root; let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) { current = path.join(current, part); try { const st = fs.lstatSync(current); const allowedSystemLink = st.isSymbolicLink() && ["/tmp", "/var"].includes(current); if ((!allowedSystemLink && st.isSymbolicLink()) || (!allowedSystemLink && !st.isDirectory())) throw new Error("Unsafe preexisting state directory"); } catch (e) { if (e.code !== "ENOENT") throw e; } }
  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  current = root; for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) { current = path.join(current, part); const st = fs.lstatSync(current); const allowedSystemLink = st.isSymbolicLink() && ["/tmp", "/var"].includes(current); if ((!allowedSystemLink && st.isSymbolicLink()) || (!allowedSystemLink && !st.isDirectory())) throw new Error("Unsafe state directory"); }
  fs.chmodSync(absolute, 0o700); return absolute;
}
function trustedPath(p, root) {
  const absolute = safe(p); const trusted = safe(root);
  if (absolute !== trusted && !absolute.startsWith(`${trusted}${path.sep}`)) throw new Error("Path is outside the trusted automation root");
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) { current = path.join(current, part); const st = fs.lstatSync(current); if (st.isSymbolicLink() && !["/tmp", "/var"].includes(current)) throw new Error("Trusted path contains a symlink"); }
  return absolute;
}
function atomic(file, value) {
  privateDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file); fs.chmodSync(file, 0o600);
}
function claim(file, value) {
  privateDir(path.dirname(file));
  let fd; try { fd = fs.openSync(file, "wx", 0o600); } catch (e) { if (e.code === "EEXIST") throw new Error("Run is already claimed or has uncertain prior state"); throw e; }
  try { fs.writeFileSync(fd, JSON.stringify(value) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function git(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 15000 });
  if (result.error || result.status !== 0) throw new Error(`Git ${args[0]} failed`);
  return result.stdout.trim();
}
function trustedCodexExecutable(executable) {
  if (!path.isAbsolute(executable)) throw new Error("Codex executable is not trusted");
  let resolved; let stat;
  try { resolved = fs.realpathSync(executable); stat = fs.statSync(resolved); } catch { throw new Error("Codex executable is not trusted"); }
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0 || (stat.uid !== uid && stat.uid !== 0)) throw new Error("Codex executable is not trusted");
  let current = path.parse(resolved).root;
  const root = current;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const component = fs.lstatSync(current);
    if (component.isSymbolicLink() || (!component.isDirectory() && current !== resolved)) throw new Error("Codex executable parent is not trusted");
    if (current === resolved) continue;
    const stickyPrivateTemp = ["/private/tmp", "/tmp"].includes(current) && component.uid === 0 && (component.mode & 0o7777) === 0o1777;
    if (!stickyPrivateTemp && (component.uid !== uid && component.uid !== 0 || (component.mode & 0o022) !== 0)) throw new Error("Codex executable parent is not trusted");
  }
  return resolved;
}
function failure(planned, stage, code, exitCode) {
  const snapshot = getValidatedMacosCodexPlan(planned);
  const authorization = snapshot.authorization;
  const { context, failure: state } = prepareFailureForAuthorizedSnapshot({ authorization, stage, code, exitCode });
  return persistFailure({ context, failure: state });
}
function validateClone(repo, plan) {
  let current = path.parse(repo).root;
  for (const part of repo.slice(current.length).split(path.sep).filter(Boolean)) { current = path.join(current, part); const st = fs.lstatSync(current); if (st.isSymbolicLink() && !["/tmp", "/var"].includes(current)) throw new Error("Repository path is symlinked"); }
  const origin = git(repo, ["remote", "get-url", "origin"]);
  const expected = `https://github.com/${plan.repository}.git`;
  if (origin !== expected && origin !== `git@github.com:${plan.repository}.git`) throw new Error("Repository origin does not match project registry");
  if (git(repo, ["status", "--porcelain"])) throw new Error("Trusted clone is dirty");
  const branch = git(repo, ["branch", "--show-current"]);
  if (branch !== plan.target_branch || !BRANCH.test(branch)) throw new Error("Clone is not on the authorized task branch");
  if (["main", "master", plan.default_branch].includes(branch)) throw new Error("Protected/default branch is prohibited");
  const head = git(repo, ["rev-parse", "HEAD"]); if (!SHA.test(head)) throw new Error("Invalid repository HEAD");
  const remoteDefault = git(repo, ["rev-parse", "--verify", `refs/remotes/origin/${plan.default_branch}^{commit}`]);
  if (!SHA.test(remoteDefault)) throw new Error("Invalid verified default branch");
  return { branch, head, remote_default: remoteDefault };
}
function runCodex(executable, repo, prompt, timeoutMs, logFile) {
  return new Promise((resolve, reject) => {
    let settled = false; let killTimer;
    const finish = result => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer);
      try { atomic(logFile, result.log); }
      catch { reject(Object.assign(new Error("Codex log persistence failed; run outcome is unknown"), { code: "CODEX_LOG_PERSIST_FAILED" })); return; }
      resolve(result.value);
    };
    const child = spawn(executable, ["exec", "--full-auto"], { cwd: repo, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; const append = chunk => { if (output.length < 32768) output += chunk.toString().slice(0, 32768 - output.length); };
    const clean = () => output
      .replace(/\b(?:github_pat_|gh[opusr]_)[A-Za-z0-9_]+/gi, "[REDACTED]")
      .replace(/((?:authorization\s*:\s*)?(?:bearer|token)\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
      .replace(/((?:api[_-]?key|secret|token)\s*[:=]\s*)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]");
    child.stdout.on("data", append); child.stderr.on("data", append); child.stdin.end(prompt);
    let timer = setTimeout(() => { child.kill("SIGTERM"); killTimer = setTimeout(() => child.kill("SIGKILL"), 1000); }, timeoutMs);
    child.on("close", (code, signal) => finish({ value: { code, signal, timedOut: Boolean(killTimer) }, log: { exit_code: code, signal, output: clean() } }));
    child.on("error", error => finish({ value: { code: null, error }, log: { error: error.code || "spawn-failed", output: clean() } }));
  });
}

export async function executeMacosCodexRun({ planned, repoPath, codexExecutable, timeoutMs = 300000, controlRoot, trustedGithubUsername }) {
  const snapshot = getValidatedMacosCodexPlan(planned);
  if (controlRoot !== snapshot.controlRoot || JSON.stringify(trustedGithubUsername) !== JSON.stringify(snapshot.trustedGithubUsername) || typeof repoPath !== "string" || typeof codexExecutable !== "string") throw new Error("Execution authority does not match the validated plan");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT) throw new Error("Invalid execution timeout");
  const { plan, identity } = snapshot; const issue = identity.issue;
  const base = privateDir(path.join(HOME(), ".chatgpt-codex-orchestrator", "instances", snapshot.instance_id));
  const automationRoot = privateDir(path.join(base, "automation"));
  let repo; let trustedExecutable;
  try {
    repo = trustedPath(repoPath, automationRoot);
    trustedExecutable = trustedCodexExecutable(codexExecutable);
  } catch (error) {
    failure(planned, "preflight", "EXECUTION_PREP_FAILED");
    throw error;
  }
  const id = `${plan.project}-${issue}-${plan.iteration}`; const ledgerFile = path.join(base, "macos-execution-ledger", `${id}.json`);
  const ledger = { version: 1, execution_state: "CLAIMED", project: plan.project, issue, iteration: plan.iteration, claimed_at_utc: new Date().toISOString() };
  let logs;
  try { logs = privateDir(path.join(base, "macos-execution-logs")); }
  catch (error) {
    failure(planned, "preflight", "EXECUTION_PREP_FAILED");
    throw error;
  }
  claim(ledgerFile, ledger);
  try {
    const observed = validateClone(repo, plan);
    const result = await runCodex(trustedExecutable, repo, JSON.parse(snapshot.event.issue.body).prompt, timeoutMs, path.join(logs, `${id}.json`));
    if (result.code !== 0) { const saved = failure(planned, result.timedOut ? "timeout" : "codex", result.timedOut ? "CODEX_TIMEOUT" : (result.error ? "CODEX_SPAWN_FAILED" : "CODEX_NONZERO"), result.code ?? undefined); atomic(ledgerFile, { ...ledger, execution_state: "TERMINAL_FAILURE", callback_id: saved.state.callback_id }); return { state: "TERMINAL_FAILURE", failure: saved.state }; }
    const done = { ...ledger, execution_state: "EXECUTED_UNVALIDATED", observed_branch: observed.branch, observed_repository: plan.repository, observed_head: observed.head, exit_code: 0, validation_state: "NOT_RUN", success_callback_state: "NOT_IMPLEMENTED", completed_at_utc: new Date().toISOString() }; atomic(ledgerFile, done); return done;
  } catch (error) {
    if (error?.code === "CODEX_LOG_PERSIST_FAILED") {
      // The child may have changed the clone. Preserve the claim even if reconciliation cannot be persisted.
      let saved; let persistenceFailed = false;
      try { saved = failure(planned, "unknown", "CODEX_LOG_PERSIST_FAILED"); } catch { persistenceFailed = true; }
      try { atomic(ledgerFile, { ...ledger, execution_state: "UNKNOWN", ...(saved ? { callback_id: saved.state.callback_id } : {}) }); } catch { persistenceFailed = true; }
      if (persistenceFailed) throw error;
      return { state: "UNKNOWN", failure: saved.state };
    }
    let saved; try { saved = failure(planned, error.message.includes("Codex") ? "codex" : "git", error.message.includes("Codex") ? "CODEX_PREP_FAILED" : "EXECUTION_PREP_FAILED"); } catch { atomic(ledgerFile, { ...ledger, execution_state: "UNKNOWN" }); throw error; } atomic(ledgerFile, { ...ledger, execution_state: "TERMINAL_FAILURE", callback_id: saved.state.callback_id }); return { state: "TERMINAL_FAILURE", failure: saved.state };
  }
}
