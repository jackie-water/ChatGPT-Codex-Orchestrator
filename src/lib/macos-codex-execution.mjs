import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { planMacosCodexRun } from "./macos-codex-run-contract.mjs";
import { prepareFailure, persistFailure } from "./run-failure-state.mjs";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^(codex|chore|fix|feat|refactor|test|docs|spike)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const HOME = () => process.env.HOME || process.env.USERPROFILE || "/tmp";
const safe = p => path.resolve(p);
function privateDir(p) { fs.mkdirSync(p, { recursive: true, mode: 0o700 }); fs.chmodSync(p, 0o700); return p; }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
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
function failure(planned, controlRoot, trusted, stage, code, exitCode) {
  const { context, failure: state } = prepareFailure({ event: planned.normalized.event, controlRoot, trustedGithubUsername: trusted, stage, code, exitCode });
  return persistFailure({ context, failure: state });
}
function validateClone(repo, plan) {
  if (fs.lstatSync(repo).isSymbolicLink()) throw new Error("Repository path is symlinked");
  const origin = git(repo, ["remote", "get-url", "origin"]);
  const expected = `https://github.com/${plan.repository}.git`;
  if (origin !== expected && origin !== `git@github.com:${plan.repository}.git`) throw new Error("Repository origin does not match project registry");
  if (git(repo, ["status", "--porcelain"])) throw new Error("Trusted clone is dirty");
  const branch = git(repo, ["branch", "--show-current"]);
  if (branch !== plan.target_branch || !BRANCH.test(branch)) throw new Error("Clone is not on the authorized task branch");
  if (["main", "master", plan.default_branch].includes(branch)) throw new Error("Protected/default branch is prohibited");
  const head = git(repo, ["rev-parse", "HEAD"]); if (!SHA.test(head)) throw new Error("Invalid repository HEAD");
  const remoteHead = git(repo, ["symbolic-ref", `refs/remotes/origin/${plan.default_branch}`]).replace(/^refs\/remotes\//, "");
  return { branch, head, remote_default: remoteHead };
}
function runCodex(executable, repo, prompt, timeoutMs, logFile) {
  return new Promise(resolve => {
    const child = spawn(executable, ["exec", "--full-auto"], { cwd: repo, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; const append = chunk => { if (output.length < 32768) output += chunk.toString().slice(0, 32768 - output.length); };
    child.stdout.on("data", append); child.stderr.on("data", append); child.stdin.end(prompt);
    let timer = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 1000); }, timeoutMs);
    child.on("close", (code, signal) => { clearTimeout(timer); atomic(logFile, { exit_code: code, signal, output: output.replace(/Bearer\s+\S+|ghp_[A-Za-z0-9]+/g, "[REDACTED]") }); resolve({ code, signal }); });
    child.on("error", error => { clearTimeout(timer); atomic(logFile, { error: error.code || "spawn-failed" }); resolve({ code: null, error }); });
  });
}

export async function executeMacosCodexRun({ planned, repoPath, codexExecutable, timeoutMs = 300000, controlRoot, trustedGithubUsername }) {
  if (!planned?.plan || typeof repoPath !== "string" || typeof codexExecutable !== "string") throw new Error("A validated plan, repository and trusted Codex executable are required");
  const { plan } = planned; const issue = planned.normalized.context.control_provenance.issue_number; const instance = read(path.join(controlRoot, "instance.json"));
  const base = privateDir(path.join(HOME(), ".chatgpt-codex-orchestrator", "instances", instance.instance_id));
  const id = `${plan.project}-${issue}-${plan.iteration}`; const ledgerFile = path.join(base, "macos-execution-ledger", `${id}.json`);
  const ledger = { version: 1, execution_state: "CLAIMED", project: plan.project, issue, iteration: plan.iteration, claimed_at_utc: new Date().toISOString() };
  claim(ledgerFile, ledger);
  const logs = privateDir(path.join(base, "macos-execution-logs"));
  try {
    const observed = validateClone(safe(repoPath), plan);
    const result = await runCodex(codexExecutable, safe(repoPath), JSON.parse(planned.normalized.event.issue.body).prompt, timeoutMs, path.join(logs, `${id}.json`));
    if (result.code !== 0) { const saved = failure(planned, controlRoot, trustedGithubUsername, result.signal ? "timeout" : "codex", result.signal ? "CODEX_TIMEOUT" : "CODEX_NONZERO", result.code ?? undefined); atomic(ledgerFile, { ...ledger, execution_state: "TERMINAL_FAILURE", callback_id: saved.state.callback_id }); return { state: "TERMINAL_FAILURE", failure: saved.state }; }
    const done = { ...ledger, execution_state: "EXECUTED_UNVALIDATED", observed_branch: observed.branch, observed_repository: plan.repository, observed_head: observed.head, exit_code: 0, validation_state: "NOT_RUN", success_callback_state: "NOT_IMPLEMENTED", completed_at_utc: new Date().toISOString() }; atomic(ledgerFile, done); return done;
  } catch (error) {
    const saved = failure(planned, controlRoot, trustedGithubUsername, "git", "EXECUTION_PREP_FAILED"); atomic(ledgerFile, { ...ledger, execution_state: "TERMINAL_FAILURE", callback_id: saved.state.callback_id }); return { state: "TERMINAL_FAILURE", failure: saved.state };
  }
}
