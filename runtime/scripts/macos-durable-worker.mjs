#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { updateMacosDurableStatus, claimMacosDurableWorker, durablePaths, redactLog } from "../../src/lib/macos-durable-intake.mjs";
import { planMacosCodexRun, getValidatedMacosCodexPlan } from "../../src/lib/macos-codex-run-contract.mjs";

const arg = process.argv.indexOf("--intent-path");
if (arg < 0 || !process.argv[arg + 1]) throw new Error("Missing --intent-path");
const intentPath = path.resolve(process.argv[arg + 1]);
function readPrivateJson(file, label) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || (typeof process.getuid === "function" && st.uid !== process.getuid()) || (st.mode & 0o077) !== 0) throw new Error(`Unsafe durable ${label}`);
    return JSON.parse(fs.readFileSync(fd, "utf8"));
  } finally { fs.closeSync(fd); }
}
const intent = readPrivateJson(intentPath, "intent");
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
const receiptPath = intentPath.replace(/\.intent\.json$/, ".receipt.json");
const logPath = intentPath.replace(/\.intent\.json$/, ".worker.log");
const eventPath = intentPath.replace(/\.intent\.json$/, ".event.json");
const log = [];
const append = chunk => { if (Buffer.byteLength(log.join("")) < 32768) log.push(String(chunk).slice(0, 32768)); };
function safeLog() {
  const parent = path.dirname(logPath); const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || (typeof process.getuid === "function" && parentStat.uid !== process.getuid()) || (parentStat.mode & 0o077) !== 0) throw new Error("Unsafe durable log directory");
  const fd = fs.openSync(logPath, "wx", 0o600);
  try { fs.writeFileSync(fd, redactLog(log.join(""))); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const st = fs.lstatSync(logPath); if (!st.isFile() || st.nlink !== 1 || (typeof process.getuid === "function" && st.uid !== process.getuid()) || (st.mode & 0o077) !== 0) throw new Error("Unsafe durable log");
  const dfd = fs.openSync(parent, "r"); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
}
function finish(status, failure_code, extra = {}) {
  try { safeLog(); }
  catch { status = "UNKNOWN"; failure_code = "STATUS_PERSIST_FAILED"; }
  updateMacosDurableStatus({ receiptPath, expected: ["ACCEPTED", "RUNNING"], patch: { status, ...(failure_code ? { failure_code } : {}), ...extra } });
}
try {
  const receipt = readPrivateJson(receiptPath, "receipt");
  if (receipt.key !== intent.key || !["ACCEPTED", "RUNNING"].includes(receipt.status)) throw Object.assign(new Error("Receipt binding mismatch"), { code: "AUTHORIZATION_CONFLICT" });
  const replanned = planMacosCodexRun({ event: intent.event, controlRoot: intent.control_root, controlRepository: intent.control_repository, trustedGithubUsername: intent.trusted_github_username });
  const snapshot = getValidatedMacosCodexPlan(replanned); const exact = durablePaths(snapshot);
  if (path.resolve(exact.intentPath) !== intentPath || exact.key !== intent.key || intent.authorization_digest !== snapshot.authorization_digest
    || canonical(intent.trusted_github_username) !== canonical(snapshot.trustedGithubUsername)
    || canonical(intent.identity) !== canonical(snapshot.identity)
    || canonical(intent.authorized_snapshot) !== canonical(snapshot)) throw Object.assign(new Error("Authorized intent binding changed"), { code: "AUTHORIZATION_CONFLICT" });
  if (!claimMacosDurableWorker({ receiptPath, key: intent.key })) process.exit(0);
  if (updateMacosDurableStatus({ receiptPath, expected: ["ACCEPTED"], patch: { status: "RUNNING", worker_pid: process.pid, started_at_utc: new Date().toISOString() } }).status !== "RUNNING") process.exit(0);
  const eventFd = fs.openSync(eventPath, "wx", 0o600);
  try { fs.writeFileSync(eventFd, JSON.stringify(intent.event) + "\n"); fs.fsyncSync(eventFd); } finally { fs.closeSync(eventFd); }
  const dispatch = fileURLToPath(new URL("./macos-dispatch.mjs", import.meta.url));
  const args = [dispatch, "--event-path", eventPath, "--control-root", intent.control_root, "--control-repository", intent.control_repository, "--trusted-github-usernames", JSON.stringify(intent.trusted_github_username), "--timeout-ms", String(intent.timeout_ms)];
  const child = spawn(process.execPath, args, { cwd: path.dirname(dispatch), detached: true, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  child.stdout.on("data", append); child.stderr.on("data", append);
  let settled = false;
  const settle = (status, code, extra) => { if (settled) return; settled = true; finish(status, code, extra); };
  child.once("error", error => settle("UNKNOWN", error.code === "ENOENT" ? "DISPATCH_UNAVAILABLE" : "DISPATCH_SPAWN_FAILED"));
  child.once("close", (code, signal) => {
    if (signal) return settle("UNKNOWN", "DISPATCH_TERMINATED");
    if (code === 0) return settle("SUCCEEDED", undefined, { completed_at_utc: new Date().toISOString() });
    settle("FAILED", "DISPATCH_NONZERO", { exit_code: code, completed_at_utc: new Date().toISOString() });
  });
} catch (error) { finish("UNKNOWN", /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || "") ? error.code : "WORKER_FAILURE"); }
