#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { updateMacosDurableStatus, redactLog } from "../../src/lib/macos-durable-intake.mjs";
import { planMacosCodexRun, getValidatedMacosCodexPlan } from "../../src/lib/macos-codex-run-contract.mjs";

const arg = process.argv.indexOf("--intent-path");
if (arg < 0 || !process.argv[arg + 1]) throw new Error("Missing --intent-path");
const intentPath = path.resolve(process.argv[arg + 1]);
const intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
const receiptPath = intentPath.replace(/\.intent\.json$/, ".receipt.json");
const logPath = intentPath.replace(/\.intent\.json$/, ".worker.log");
const eventPath = intentPath.replace(/\.intent\.json$/, ".event.json");
const log = [];
const append = chunk => { if (Buffer.byteLength(log.join("")) < 32768) log.push(String(chunk).slice(0, 32768)); };
function finish(status, failure_code, extra = {}) {
  try { fs.writeFileSync(logPath, redactLog(log.join("")), { mode: 0o600 }); }
  catch { status = "UNKNOWN"; failure_code = "STATUS_PERSIST_FAILED"; }
  updateMacosDurableStatus({ receiptPath, expected: ["ACCEPTED", "RUNNING"], patch: { status, ...(failure_code ? { failure_code } : {}), ...extra } });
}
try {
  updateMacosDurableStatus({ receiptPath, patch: { status: "RUNNING", worker_pid: process.pid, started_at_utc: new Date().toISOString() } });
  const replanned = planMacosCodexRun({ event: intent.event, controlRoot: intent.control_root, controlRepository: intent.control_repository, trustedGithubUsername: intent.trusted_github_username });
  if (getValidatedMacosCodexPlan(replanned).authorization_digest !== intent.authorization_digest) throw Object.assign(new Error("Authorized snapshot changed after acceptance"), { code: "AUTHORIZATION_CHANGED" });
  const eventFd = fs.openSync(eventPath, "wx", 0o600);
  try { fs.writeFileSync(eventFd, JSON.stringify(intent.event) + "\n"); fs.fsyncSync(eventFd); } finally { fs.closeSync(eventFd); }
  const dispatch = fileURLToPath(new URL("./macos-dispatch.mjs", import.meta.url));
  const args = [dispatch, "--event-path", eventPath, "--control-root", intent.control_root, "--control-repository", intent.control_repository, "--trusted-github-username", intent.trusted_github_username.join(","), "--timeout-ms", String(intent.timeout_ms)];
  const child = spawn(process.execPath, args, { cwd: path.dirname(dispatch), detached: true, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  child.stdout.on("data", append); child.stderr.on("data", append);
  child.on("error", error => finish("UNKNOWN", error.code === "ENOENT" ? "DISPATCH_UNAVAILABLE" : "DISPATCH_SPAWN_FAILED"));
  child.on("close", (code, signal) => {
    if (signal) return finish("UNKNOWN", "DISPATCH_TERMINATED");
    if (code === 0) return finish("SUCCEEDED", undefined, { completed_at_utc: new Date().toISOString() });
    finish("FAILED", "DISPATCH_NONZERO", { exit_code: code, completed_at_utc: new Date().toISOString() });
  });
} catch (error) { finish("UNKNOWN", /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || "") ? error.code : "WORKER_FAILURE"); }
