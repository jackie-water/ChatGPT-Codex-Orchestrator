import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { planMacosCodexRun } from "../src/lib/macos-codex-run-contract.mjs";
import { executeMacosCodexRun } from "../src/lib/macos-codex-execution.mjs";
import { prepareFailureForAuthorizedSnapshot } from "../src/lib/run-failure-state.mjs";

const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" }).toString().trim();
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-exec-"));
  const home = path.join(root, "home"), control = path.join(root, "control"), bare = path.join(root, "remote.git");
  fs.mkdirSync(home); fs.mkdirSync(control); fs.mkdirSync(bare);
  fs.writeFileSync(path.join(control, "instance.json"), JSON.stringify({ instance_id: "exec-test" }));
  fs.writeFileSync(path.join(control, "projects.json"), JSON.stringify({ projects: { demo: { enabled: true, repository: "owner/repo", default_branch: "main", max_iterations: 5 } } }));
  const state = path.join(home, ".chatgpt-codex-orchestrator/instances/exec-test"); fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "chat-routes.json"), JSON.stringify({ routes: [{ project: "demo", route: "chat-165", status: "active", chat_url: "https://chatgpt.com/c/chat-165" }] }));
  sh(root, "init", "--bare", bare); const seed = path.join(root, "seed"); sh(root, "clone", bare, seed); sh(seed, "config", "user.email", "test@example.com"); sh(seed, "config", "user.name", "Test"); fs.writeFileSync(path.join(seed, "README"), "ok\n"); sh(seed, "add", "."); sh(seed, "commit", "-m", "initial"); sh(seed, "push", "origin", "HEAD:main"); sh(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  const automation = path.join(state, "automation"), repo = path.join(automation, "repo"); fs.mkdirSync(automation, { recursive: true }); sh(automation, "clone", bare, repo); sh(repo, "config", "remote.origin.url", "https://github.com/owner/repo.git"); sh(repo, "update-ref", "refs/remotes/origin/main", sh(seed, "rev-parse", "HEAD")); sh(repo, "checkout", "-b", "feat/task");
  const codex = path.join(root, "fake-codex"); fs.writeFileSync(codex, "#!/bin/sh\nprintf '%s' \"$@\" > \"$PWD/argv\"\ncat >/dev/null\nexit 0\n"); fs.chmodSync(codex, 0o700);
  const event = ({ prompt = "do the task" } = {}) => ({ repository: { full_name: "control/private" }, issue: { title: "[CODEX-RUN] demo", number: 200, user: { login: "trusted" }, body: JSON.stringify({ project: "demo", iteration: 1, max_iterations: 5, review_route: "chat-165", target_branch: "feat/task", prompt }) } });
  return { root, home, control, bare, repo, codex, event };
}

test("verified bare remote checkout executes once and records unvalidated success", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(result.execution_state, "EXECUTED_UNVALIDATED", JSON.stringify(result)); assert.equal(fs.readFileSync(path.join(f.repo, "argv"), "utf8"), "exec--full-auto");
  } finally { process.env.HOME = old; }
});

test("nonzero Codex and timeout persist safe P1 failures", async () => {
  for (const mode of ["nonzero", "timeout"]) {
    const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
    const script = mode === "nonzero" ? "#!/bin/sh\ncat >/dev/null\nexit 7\n" : "#!/bin/sh\ncat >/dev/null\nsleep 2\n";
    fs.writeFileSync(f.codex, script); fs.chmodSync(f.codex, 0o700);
    try {
      const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: mode === "timeout" ? 50 : 5000 });
      assert.equal(result.state, "TERMINAL_FAILURE"); assert.equal(result.failure.stage, mode === "timeout" ? "timeout" : "codex"); assert.equal(result.failure.source_commit, null); assert.equal(result.failure.callback.delivery_state, "PENDING");
    } finally { process.env.HOME = old; }
  }
});

test("claim, origin, and dirty-clone checks fail closed before Codex", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    const first = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(first.execution_state, "EXECUTED_UNVALIDATED");
    await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /claimed|uncertain|Duplicate/);
  } finally { process.env.HOME = old; }
  for (const kind of ["origin", "dirty"]) {
    const g = fixture(); const prior = process.env.HOME; process.env.HOME = g.home;
    try {
      if (kind === "origin") sh(g.repo, "config", "remote.origin.url", "https://github.com/wrong/repo.git"); else fs.writeFileSync(path.join(g.repo, "dirty"), "x\n");
      const planned = planMacosCodexRun({ event: g.event(), controlRoot: g.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      const result = await executeMacosCodexRun({ planned, repoPath: g.repo, codexExecutable: g.codex, controlRoot: g.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
      assert.equal(result.failure.stage, "git"); assert.equal(fs.existsSync(path.join(g.repo, "argv")), false);
    } finally { process.env.HOME = prior; }
  }
});

test("unvalidated plan objects and symlinked clones fail closed", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  try {
    await assert.rejects(() => executeMacosCodexRun({ planned: { plan: {} }, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"] }));
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    const link = path.join(path.dirname(f.repo), "link"); fs.symlinkSync(f.repo, link);
    await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: link, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }));
  } finally { process.env.HOME = old; }
});

test("execution uses the immutable authorized plan after caller mutation", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    planned.plan.project = "foreign";
    planned.plan.repository = "attacker/repo";
    planned.plan.target_branch = "feat/foreign";
    planned.plan.iteration = 99;
    const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(result.execution_state, "EXECUTED_UNVALIDATED");
    assert.equal(result.project, "demo"); assert.equal(result.iteration, 1);
    assert.equal(fs.existsSync(path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test/macos-execution-ledger/foreign-200-99.json")), false);
  } finally { process.env.HOME = old; }
});

test("execution keeps the authorized instance when instance metadata changes", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    fs.writeFileSync(path.join(f.control, "instance.json"), JSON.stringify({ instance_id: "foreign-instance" }));
    const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(result.execution_state, "EXECUTED_UNVALIDATED");
    assert.equal(fs.existsSync(path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test/macos-execution-ledger/demo-200-1.json")), true);
    assert.equal(fs.existsSync(path.join(f.home, ".chatgpt-codex-orchestrator/instances/foreign-instance")), false);
  } finally { process.env.HOME = old; }
});

test("rejects a symlinked preexisting private instance state before chmod or Codex", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  const state = path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test");
  const sentinel = path.join(f.root, "sentinel"); fs.mkdirSync(sentinel); const sentinelFile = path.join(sentinel, "sentinel.bin");
  fs.writeFileSync(sentinelFile, "do-not-touch\n"); fs.chmodSync(sentinel, 0o755); const before = fs.statSync(sentinel);
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    fs.rmSync(state, { recursive: true }); fs.symlinkSync(sentinel, state, "dir");
    await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /Unsafe/);
    assert.equal(fs.readFileSync(sentinelFile, "utf8"), "do-not-touch\n"); assert.equal(fs.statSync(sentinel).mode & 0o777, before.mode & 0o777);
    assert.equal(fs.existsSync(path.join(sentinel, "macos-execution-ledger")), false); assert.equal(fs.existsSync(path.join(sentinel, "macos-execution-logs")), false); assert.equal(fs.existsSync(path.join(f.repo, "argv")), false);
  } finally { process.env.HOME = old; }
});

test("queues nonzero Codex failure to the original authorized instance after Control metadata changes", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    fs.writeFileSync(f.codex, "#!/bin/sh\ncat >/dev/null\nexit 9\n"); fs.chmodSync(f.codex, 0o700);
    fs.writeFileSync(path.join(f.control, "instance.json"), JSON.stringify({ instance_id: "foreign-instance" }));
    const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(result.failure.callback_id, "failure-demo-200-1"); assert.equal(result.failure.callback.chat_url, "https://chatgpt.com/c/chat-165"); assert.equal(result.failure.callback.delivery_state, "PENDING"); assert.equal(result.failure.source_commit, null);
    const outbox = path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test/failure-outbox/failure-demo-200-1.json"); assert.equal(fs.existsSync(outbox), true); assert.equal(JSON.parse(fs.readFileSync(outbox)).callback_id, "failure-demo-200-1");
    assert.equal(fs.existsSync(path.join(f.home, ".chatgpt-codex-orchestrator/instances/foreign-instance")), false);
    await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /claimed|uncertain|Duplicate/);
  } finally { process.env.HOME = old; }
});

test("rejects forged authorization snapshots without file side effects", () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home; const before = fs.readdirSync(f.home);
  try { assert.throws(() => prepareFailureForAuthorizedSnapshot({ authorization: { instance_id: "exec-test", project: "demo", repository: "owner/repo", issue: 200, iteration: 1, author: "trusted", chat_url: "https://chatgpt.com/c/chat-165", configuration: {} }, stage: "codex", code: "CODEX_NONZERO" }), /genuine authorization snapshot/); assert.deepEqual(fs.readdirSync(f.home), before); }
  finally { process.env.HOME = old; }
});
