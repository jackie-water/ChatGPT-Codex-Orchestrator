import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { submitMacosDurableIntent, durablePaths, readMacosDurableStatus, claimMacosDurableWorker, reconcileMacosDurableWorker, updateMacosDurableStatus, processOwnerLiveness, redactLog } from "../src/lib/macos-durable-intake.mjs";
import { parseArgs, parseTrustedUsernames } from "../runtime/scripts/macos-dispatch.mjs";

const write = (file, value, mode = 0o600) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode }); };
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "macos-durable-intake-")));
  const home = path.join(root, "home"), control = path.join(root, "control"); fs.mkdirSync(home, { mode: 0o700 }); fs.mkdirSync(control, { mode: 0o700 });
  const instance = "durable-test", base = path.join(home, ".chatgpt-codex-orchestrator", "instances", instance);
  write(path.join(control, "instance.json"), { instance_id: instance });
  write(path.join(control, "projects.json"), { projects: { demo: { enabled: true, repository: "fake-owner/fake-project", default_branch: "main", checkpoint_branch: "codex/checkpoints", local_path_key: "sandbox-demo" } } });
  write(path.join(base, "chat-routes.json"), { routes: [{ project: "demo", route: "chat-267", status: "active", chat_url: "https://chatgpt.com/c/chat-267" }] });
  const event = { repository: { full_name: "fake-control/private" }, issue: { title: "[CODEX-RUN] durable", number: 266, user: { login: "trusted" }, body: JSON.stringify({ project: "demo", iteration: 1, max_iterations: 5, review_route: "chat-267", target_branch: "feat/macos-durable-submit-return-20261017", prompt: "Implement the isolated task" }) } };
  return { root, home, control, event, args: { controlRoot: control, controlRepository: "fake-control/private", trustedGithubUsername: ["trusted"] } };
}
function withHome(home, fn) { const old = process.env.HOME; process.env.HOME = home; try { return fn(); } finally { if (old === undefined) delete process.env.HOME; else process.env.HOME = old; } }
const fakeSpawn = calls => (file, argv, options) => { calls.push({ file, argv, options }); return { pid: 4242, unref() {} }; };
function currentStartIdentity(pid = process.pid) {
  if (process.platform === "darwin") return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).trim();
  if (process.platform === "linux") {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  }
  return "test-owner";
}

test("acknowledges before worker terminal and replays exactly once", () => {
  const f = fixture(), calls = [];
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) });
    assert.equal(first.status, "ACCEPTED"); assert.equal(calls.length, 1); assert.ok(fs.existsSync(first.receipt_path));
  });
  withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) });
    assert.equal(first.status, "ACCEPTED"); assert.equal(calls.length, 1);
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("partial, unknown, conflicting and symlinked durable state fail closed", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const calls = [], first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) });
    const paths = path.parse(first.receipt_path); fs.unlinkSync(first.receipt_path);
    assert.throws(() => submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) }), /partial|missing|UNCERTAIN/i);
    const dir = path.dirname(first.receipt_path); fs.unlinkSync(path.join(dir, `${path.basename(first.receipt_path).replace(".receipt.json", ".intent.json")}`));
    const moved = `${dir}.moved`; fs.renameSync(dir, moved); fs.mkdirSync(path.join(f.root, "elsewhere"), { mode: 0o700 }); fs.symlinkSync(path.join(f.root, "elsewhere"), dir, "dir");
    assert.throws(() => submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) }), /symlink|unsafe/i);
    void paths; fs.rmSync(moved, { recursive: true, force: true });
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("spawn failure is ambiguous and remains recoverable as UNKNOWN", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    assert.throws(() => submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: () => { throw new Error("fake spawn"); } }), /spawn/i);
    const dir = path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "durable-test", "macos-durable-intake");
    const receipt = fs.readdirSync(dir).find(name => name.endsWith(".receipt.json"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, receipt))).status, "UNKNOWN");
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("worker claim and receipt transitions are exclusive and monotonic", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn([]) });
    assert.equal(claimMacosDurableWorker({ receiptPath: first.receipt_path, key: first.task_id }), true);
    assert.equal(claimMacosDurableWorker({ receiptPath: first.receipt_path, key: first.task_id }), false);
    updateMacosDurableStatus({ receiptPath: first.receipt_path, patch: { status: "SUCCEEDED" } });
    const unchanged = updateMacosDurableStatus({ receiptPath: first.receipt_path, patch: { status: "UNKNOWN" } });
    assert.equal(unchanged.status, "SUCCEEDED");
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("spawn error after return is settled UNKNOWN and secrets/prompts are redacted", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const listeners = {};
    const child = { pid: 4243, once(name, fn) { listeners[name] = fn; }, unref() {} };
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: () => child });
    listeners.error({ code: "ENOENT" });
    assert.equal(JSON.parse(fs.readFileSync(first.receipt_path, "utf8")).status, "UNKNOWN");
    assert.match(redactLog("token=abcdefghijklmnop prompt=do-not-store"), /token=\[REDACTED\].*prompt=\[REDACTED\]/);
    assert.equal(redactLog('password="secret phrase" api-key=abcdefghijklmnop secret: second-secret'), 'password=[REDACTED] api-key=[REDACTED] secret: [REDACTED]');
    assert.equal(redactLog("password=lf-secret\nprompt: lf-prompt\r\nsecret='crlf-secret'"), "password=[REDACTED]\nprompt: [REDACTED]\r\nsecret=[REDACTED]");
    assert.doesNotMatch(redactLog(`prompt=${"x".repeat(40000)}`), /x{100}/);
    void first;
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("dispatcher preserves the legacy single-user template and rejects ambiguity", () => {
  const old = process.argv;
  try {
    process.argv = ["node", "macos-dispatch", "--event-path", "e", "--control-root", "c", "--control-repository", "r", "--trusted-github-username", "trusted"];
    assert.deepEqual(parseTrustedUsernames(parseArgs()), ["trusted"]);
    process.argv = [...process.argv, "--trusted-github-usernames", '["trusted"]'];
    assert.throws(() => parseArgs(), /Ambiguous/);
    assert.throws(() => parseTrustedUsernames({ "--trusted-github-username": "bad_name" }), /validated/);
    assert.throws(() => parseTrustedUsernames({ "--trusted-github-usernames": '["trusted","trusted"]' }), /unique/);
  } finally { process.argv = old; }
});

test("dead worker claim reconciles once while a live claim remains active", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn([]) });
    const claimPath = first.receipt_path.replace(".receipt.json", ".worker-claim");
    write(claimPath, { version: 1, key: first.task_id, pid: 2147483647, process_start_identity: "dead-owner", claimed_at_utc: new Date().toISOString() });
    assert.equal(reconcileMacosDurableWorker({ receiptPath: first.receipt_path, key: first.task_id }).status, "UNKNOWN");
    assert.equal(updateMacosDurableStatus({ receiptPath: first.receipt_path, patch: { status: "RUNNING" } }).status, "UNKNOWN");
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("receipt lock distinguishes live contention from an orphaned lock", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn([]) });
    const lockPath = `${first.receipt_path}.lock`;
    write(lockPath, { version: 1, pid: process.pid, process_start_identity: currentStartIdentity(), locked_at_utc: new Date().toISOString() });
    assert.throws(() => updateMacosDurableStatus({ receiptPath: first.receipt_path, patch: { status: "RUNNING" } }), /live writer|contention/);
    fs.rmSync(lockPath);
    write(lockPath, { version: 1, pid: 2147483647, process_start_identity: "dead-owner", locked_at_utc: new Date().toISOString() });
    assert.equal(updateMacosDurableStatus({ receiptPath: first.receipt_path, patch: { status: "RUNNING" } }).status, "UNKNOWN");
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("duplicate tampered intent validates before reconciliation and does not mutate receipt", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn([]) });
    const intentPath = first.receipt_path.replace(".receipt.json", ".intent.json");
    const receiptBefore = fs.readFileSync(first.receipt_path, "utf8");
    const intent = JSON.parse(fs.readFileSync(intentPath, "utf8")); intent.identity.review_route = "chat-268";
    fs.writeFileSync(intentPath, JSON.stringify(intent) + "\n");
    assert.throws(() => submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn([]) }), /AUTHORIZATION_CONFLICT|authorization conflict/i);
    assert.equal(fs.readFileSync(first.receipt_path, "utf8"), receiptBefore);
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("worker owner provenance distinguishes PID reuse, kernel-dead, and ambiguous owners", () => {
  assert.equal(processOwnerLiveness({ pid: 123, process_start_identity: "old", kill: () => {}, identity: () => "new" }), "replaced");
  assert.equal(processOwnerLiveness({ pid: 123, process_start_identity: "old", kill: () => { throw Object.assign(new Error(), { code: "ESRCH" }); }, identity: () => "old" }), "orphan");
  assert.equal(processOwnerLiveness({ pid: 123, process_start_identity: "old", kill: () => { throw Object.assign(new Error(), { code: "EPERM" }); }, identity: () => "old" }), "unknown");
  assert.equal(processOwnerLiveness({ pid: 123, kill: () => {} }), "unknown");
});

test("PID reuse reconciles to UNKNOWN without removing the replacement claim", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn([]) });
    const claimPath = first.receipt_path.replace(".receipt.json", ".worker-claim");
    write(claimPath, { version: 1, key: first.task_id, pid: process.pid, process_start_identity: "different-start-microseconds" });
    const reconciled = reconcileMacosDurableWorker({ receiptPath: first.receipt_path, key: first.task_id });
    assert.equal(reconciled.status, "UNKNOWN"); assert.equal(reconciled.failure_code, "WORKER_PID_REUSED");
    assert.equal(fs.existsSync(claimPath), true);
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("native MISSING own PID rejects before durable writes or worker spawn", { skip: process.platform !== "darwin" }, () => {
  const f = fixture(), calls = [], oldFlag = process.env.ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY;
  const oldHelper = process.env.ORCHESTRATOR_MACOS_NATIVE_HELPER;
  const helper = path.join(f.root, "missing-identity-helper");
  fs.writeFileSync(helper, '#!/bin/sh\nprintf \'{"status":"MISSING","pid":%s,"errno":3}\\n\' "$1"\n', { mode: 0o700 });
  process.env.ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY = "1"; process.env.ORCHESTRATOR_MACOS_NATIVE_HELPER = helper;
  try { withHome(f.home, () => {
    assert.throws(() => submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) }), /preflight|identity|MISSING/i);
    const dir = path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "durable-test", "macos-durable-intake");
    assert.equal(fs.readdirSync(dir).length, 0); assert.equal(calls.length, 0);
  }); } finally {
    if (oldFlag === undefined) delete process.env.ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY; else process.env.ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY = oldFlag;
    if (oldHelper === undefined) delete process.env.ORCHESTRATOR_MACOS_NATIVE_HELPER; else process.env.ORCHESTRATOR_MACOS_NATIVE_HELPER = oldHelper;
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("RUNNING without a claim becomes UNKNOWN while ACCEPTED remains waiting", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn([]) });
    updateMacosDurableStatus({ receiptPath: first.receipt_path, patch: { status: "RUNNING" } });
    assert.equal(reconcileMacosDurableWorker({ receiptPath: first.receipt_path, key: first.task_id }).failure_code, "WORKER_CLAIM_MISSING");
    const second = submitMacosDurableIntent({ ...f.args, event: { ...f.event, issue: { ...f.event.issue, number: 267 } }, spawnWorker: fakeSpawn([]) });
    assert.equal(reconcileMacosDurableWorker({ receiptPath: second.receipt_path, key: second.task_id }).status, "ACCEPTED");
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("active claim with matching owner identity remains active", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn([]) });
    const claimPath = first.receipt_path.replace(".receipt.json", ".worker-claim");
    write(claimPath, { version: 1, key: first.task_id, pid: process.pid, process_start_identity: currentStartIdentity() });
    assert.equal(reconcileMacosDurableWorker({ receiptPath: first.receipt_path, key: first.task_id }).status, "ACCEPTED");
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("preserves an exact multi-user authorization array", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, trustedGithubUsername: ["trusted", "reviewer"], event: f.event, spawnWorker: fakeSpawn([]) });
    const intent = JSON.parse(fs.readFileSync(first.receipt_path.replace(".receipt.json", ".intent.json"), "utf8"));
    assert.deepEqual(intent.trusted_github_username, ["trusted", "reviewer"]);
    const worker = fs.readFileSync(new URL("../runtime/scripts/macos-durable-worker.mjs", import.meta.url), "utf8");
    const dispatch = fs.readFileSync(new URL("../runtime/scripts/macos-dispatch.mjs", import.meta.url), "utf8");
    assert.match(worker, /canonical\(intent\.trusted_github_username\)/);
    assert.match(dispatch, /Trusted usernames must be a unique validated array/);
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("Windows remains outside the native durable intake surface", () => {
  const source = fs.readFileSync(new URL("../runtime/scripts/macos-durable-worker.mjs", import.meta.url), "utf8");
  assert.match(source, /macos-dispatch\.mjs/); assert.doesNotMatch(source, /powershell|\.ps1/);
});
