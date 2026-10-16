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

test("trusted Codex symlink resolves to the executable target", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  const link = path.join(f.root, "codex-link"); fs.symlinkSync(f.codex, link);
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: link, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(result.execution_state, "EXECUTED_UNVALIDATED");
  } finally { process.env.HOME = old; }
});

test("rejects dangling and directory Codex symlinks before spawn", async () => {
  for (const target of ["dangling", "directory"]) {
    const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
    const link = path.join(f.root, "codex-link"); const destination = path.join(f.root, target);
    if (target === "directory") fs.mkdirSync(destination); fs.symlinkSync(destination, link);
    try {
      const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: link, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /trusted/);
      assert.equal(fs.existsSync(path.join(f.repo, "argv")), false);
    } finally { process.env.HOME = old; }
  }
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

test("timeout terminates the private process group before returning", { timeout: 10000 }, async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  const marker = path.join(f.repo, "late-descendant-mutation");
  fs.writeFileSync(f.codex, `#!/bin/sh
(trap '' TERM; sleep 1; printf 'mutated\\n' > '${marker}') &
trap 'exit 143' TERM
sleep 10
`); fs.chmodSync(f.codex, 0o700);
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 50 });
    assert.equal(result.state, "TERMINAL_FAILURE"); assert.equal(result.failure.stage, "timeout");
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(fs.existsSync(marker), false);
  } finally { process.env.HOME = old; fs.rmSync(f.root, { recursive: true, force: true }); }
});

function installPersistentCodexGroup(f) {
  const groupFile = `${f.codex}.group.json`; const readyFile = `${f.codex}.ready`;
  const descendant = `import fs from "node:fs";
process.on("SIGTERM", () => {});
fs.writeFileSync(${JSON.stringify(readyFile)}, "ready");
setInterval(() => {}, 1000);`;
  // The parent exits on TERM and closes its pipes; the descendant keeps the private group alive.
  fs.writeFileSync(`${f.codex}.mjs`, `import fs from "node:fs";
import { spawn } from "node:child_process";
process.on("SIGTERM", () => process.exit(0));
const child = spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(descendant)}], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(groupFile)}, JSON.stringify({ pid: process.pid, descendant: child.pid }));
fs.appendFileSync(${JSON.stringify(`${f.codex}.launches`)}, "launch\\n");
console.error("benign group diagnostic secret=termination_OUTPUT_123456");
process.stdin.resume();
setInterval(() => {}, 1000);
`);
  fs.writeFileSync(f.codex, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$0.mjs"\n`);
  return { groupFile, readyFile };
}

for (const scenario of [
  { name: "SIGTERM denied", deny: "SIGTERM" },
  { name: "SIGKILL denied after parent exit", deny: "SIGKILL" },
  { name: "group remains after SIGKILL", survives: true },
  { name: "group probe fails after SIGKILL", probeFails: true },
  ...["outbox", "ledger", "both"].map(unavailable => ({ name: `${unavailable} storage unavailable`, deny: "SIGTERM", unavailable }))
]) {
  test(`unverified timeout termination stays UNKNOWN: ${scenario.name}`, { timeout: 10000, skip: process.platform === "win32" }, async () => {
    const f = fixture(); const old = process.env.HOME; const originalKill = process.kill; const renameSync = fs.renameSync;
    const { groupFile, readyFile } = installPersistentCodexGroup(f);
    const state = path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test");
    const ledgerFile = path.join(state, "macos-execution-ledger/demo-200-1.json");
    const logFile = path.join(state, "macos-execution-logs/demo-200-1.json");
    const outbox = path.join(state, "failure-outbox"); const callbackFile = path.join(outbox, "failure-demo-200-1.json");
    const journalFile = path.join(outbox, "failure-demo-200-1.journal.json");
    const outboxUnavailable = ["outbox", "both"].includes(scenario.unavailable);
    const ledgerUnavailable = ["ledger", "both"].includes(scenario.unavailable);
    const calls = []; const writes = new Set(); let killAttempted = false; let probeFailures = 0; let deadline;
    const readGroup = () => JSON.parse(fs.readFileSync(groupFile, "utf8"));
    try {
      process.env.HOME = f.home;
      const routesFile = path.join(state, "chat-routes.json");
      fs.writeFileSync(routesFile, JSON.stringify({ routes: [{ project: "demo", route: "chat-212", status: "active", chat_url: "https://chatgpt.com/c/chat-212" }] }));
      const event = f.event(); const body = JSON.parse(event.issue.body); body.review_route = "chat-212"; event.issue.body = JSON.stringify(body);
      const planned = planMacosCodexRun({ event, controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      fs.writeFileSync(routesFile, JSON.stringify({ routes: [{ project: "demo", route: "chat-999", status: "active", chat_url: "https://chatgpt.com/c/chat-999" }] }));
      planned.plan.review_route = "chat-999";
      process.kill = (pid, signal) => {
        calls.push({ pid, signal, ready: fs.existsSync(readyFile) });
        const group = readGroup();
        // Never forward a signal to anything except this test's recorded fake group.
        if (!Number.isInteger(group.pid) || group.pid <= 1 || group.pid === process.pid || pid !== -group.pid) throw Object.assign(new Error("Unexpected process group"), { code: "EPERM" });
        if (signal === scenario.deny) throw Object.assign(new Error("EPERM secret=termination_DIAGNOSTIC_123456"), { code: "EPERM" });
        if (signal === "SIGKILL") {
          killAttempted = true;
          if (scenario.survives) return true;
        }
        if (signal === 0 && killAttempted && scenario.probeFails) {
          probeFailures++;
          throw Object.assign(new Error("EIO secret=termination_DIAGNOSTIC_123456"), { code: "EIO" });
        }
        return originalKill(pid, signal);
      };
      fs.renameSync = (from, to) => {
        writes.add(to);
        if ((outboxUnavailable && to === callbackFile) || (ledgerUnavailable && to === ledgerFile)) throw Object.assign(new Error("ENOSPC secret=termination_STORAGE_123456"), { code: "ENOSPC" });
        return renameSync(from, to);
      };
      const started = Date.now();
      const execution = () => Promise.race([
        executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 1000 }),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Termination reconciliation did not settle")), 5000); })
      ]);
      let result;
      if (scenario.unavailable) {
        await assert.rejects(execution, error => {
          assert.equal(error.code, "CODEX_TERMINATION_UNVERIFIED");
          assert.equal(error.message, "Codex process group termination could not be verified; run outcome is unknown"); return true;
        });
      } else {
        result = await execution(); assert.equal(result.state, "UNKNOWN");
      }
      clearTimeout(deadline); assert.ok(Date.now() - started < 4500, "unverified termination must settle within a bounded interval");
      const group = readGroup();
      assert.ok(calls.length > 0); assert.ok(calls.every(call => call.pid === -group.pid && call.ready));
      assert.ok(calls.some(call => call.signal === "SIGTERM"));
      assert.equal(calls.some(call => call.signal === "SIGKILL"), scenario.deny !== "SIGTERM");
      if (scenario.deny !== "SIGTERM") assert.throws(() => originalKill(group.pid, 0), { code: "ESRCH" }, "the direct parent exited before settlement");
      if (scenario.probeFails) assert.ok(probeFailures > 0);
      else assert.equal(originalKill(-group.pid, 0), true, "the fake group is still present when UNKNOWN settles");
      if (scenario.survives) assert.ok(killAttempted && Date.now() - started >= 2250, "the bounded post-KILL verification must expire");
      const ledgerText = fs.readFileSync(ledgerFile, "utf8"); const ledger = JSON.parse(ledgerText);
      assert.equal(ledger.execution_state, ledgerUnavailable ? "CLAIMED" : "UNKNOWN");
      assert.equal(ledger.project, "demo"); assert.equal(ledger.issue, 200); assert.equal(ledger.iteration, 1);
      if (!scenario.unavailable) assert.equal(ledger.callback_id, "failure-demo-200-1");
      const incidentFile = outboxUnavailable ? journalFile : callbackFile;
      const incidentText = fs.readFileSync(incidentFile, "utf8"); const record = JSON.parse(incidentText);
      const incident = outboxUnavailable ? record.failure : record;
      assert.equal(incident.execution_state, "UNKNOWN"); assert.equal(incident.stage, "unknown"); assert.equal(incident.code, "CODEX_TERMINATION_UNVERIFIED");
      assert.equal(incident.project, "demo"); assert.equal(incident.issue, 200); assert.equal(incident.iteration, 1);
      assert.equal(incident.source_commit, null); assert.equal(incident.source_commit_available, false); assert.equal(incident.exit_code, null);
      assert.equal(incident.callback_id, "failure-demo-200-1"); assert.equal(incident.callback.callback_id, incident.callback_id);
      assert.equal(incident.callback.chat_url, "https://chatgpt.com/c/chat-212"); assert.equal(incident.callback.delivery_state, "PENDING"); assert.equal(incident.delivery_state, "PENDING");
      if (result) assert.deepEqual(result.failure, incident);
      assert.deepEqual(fs.readdirSync(outbox).filter(name => name.endsWith(".json")), [path.basename(incidentFile)]);
      const logText = fs.readFileSync(logFile, "utf8"); assert.equal(JSON.parse(logText).error, "CODEX_TERMINATION_UNVERIFIED");
      assert.match(logText, /benign group diagnostic secret=\[REDACTED\]/);
      assert.doesNotMatch(incidentText + ledgerText + logText, /EPERM|EIO|ENOSPC|termination_(?:DIAGNOSTIC|STORAGE|OUTPUT)_123456|chat-999/);
      assert.ok(writes.has(logFile) && writes.has(callbackFile) && writes.has(ledgerFile));
      const callCount = calls.length;
      fs.renameSync = renameSync;
      await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 1000 }), /claimed|uncertain/);
      assert.equal(calls.length, callCount);
      assert.equal(fs.readFileSync(`${f.codex}.launches`, "utf8"), "launch\n");
      assert.equal(fs.readFileSync(ledgerFile, "utf8"), ledgerText); assert.equal(fs.readFileSync(incidentFile, "utf8"), incidentText);
      assert.deepEqual(fs.readdirSync(outbox).filter(name => name.endsWith(".json")), [path.basename(incidentFile)]);
    } finally {
      clearTimeout(deadline); process.kill = originalKill; fs.renameSync = renameSync;
      try {
        if (fs.existsSync(groupFile)) {
          const group = readGroup();
          assert.ok(Number.isInteger(group.pid) && group.pid > 1 && group.pid !== process.pid);
          try { originalKill(-group.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
      } finally {
        if (old === undefined) delete process.env.HOME; else process.env.HOME = old;
        fs.rmSync(f.root, { recursive: true, force: true });
      }
    }
  });
}

test("redacts GitHub credentials and token-shaped diagnostics before every log is persisted", async () => {
  const cases = [
    { name: "success", script: "#!/bin/sh\nprintf '%s\\n' 'Authorization: Bearer bearer_PLACEHOLDER_123456' 'github_pat_PLACEHOLDER_123456' 'gho_PLACEHOLDER_123456' 'ghu_PLACEHOLDER_123456' 'ghs_PLACEHOLDER_123456' 'ghr_PLACEHOLDER_123456' 'api_key=generic_PLACEHOLDER_123456' 'benign success diagnostic context'; cat >/dev/null; exit 0", timeoutMs: 5000 },
    { name: "nonzero", script: "#!/bin/sh\nprintf '%s\\n' 'token generic_TOKEN_PLACEHOLDER_123456' 'benign nonzero diagnostic context'; cat >/dev/null; exit 7", timeoutMs: 5000 },
    { name: "timeout", script: "#!/bin/sh\nprintf '%s\\n' 'Authorization: token token_HEADER_PLACEHOLDER_123456' 'benign timeout diagnostic context'; cat >/dev/null; sleep 2", timeoutMs: 500 }
  ];
  for (const item of cases) {
    const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
    fs.writeFileSync(f.codex, item.script); fs.chmodSync(f.codex, 0o700);
    try {
      const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: item.timeoutMs });
      const logFile = path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test/macos-execution-logs/demo-200-1.json");
      const persisted = fs.readFileSync(logFile, "utf8");
      assert.match(persisted, /\[REDACTED\]/);
      for (const placeholder of ["bearer_PLACEHOLDER_123456", "github_pat_PLACEHOLDER_123456", "gho_PLACEHOLDER_123456", "ghu_PLACEHOLDER_123456", "ghs_PLACEHOLDER_123456", "ghr_PLACEHOLDER_123456", "generic_PLACEHOLDER_123456", "generic_TOKEN_PLACEHOLDER_123456", "token_HEADER_PLACEHOLDER_123456"]) assert.doesNotMatch(persisted, new RegExp(placeholder));
      assert.match(persisted, new RegExp(`benign ${item.name} diagnostic context`));
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

test("queues nonzero Codex failure after replacing and mutating public normalized authorization", async () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  try {
    fs.writeFileSync(f.codex, "#!/bin/sh\ncat >/dev/null\nexit 9\n"); fs.chmodSync(f.codex, 0o700);
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    const originalNormalized = planned.normalized;
    planned.normalized.context.authorized_source.project = "foreign";
    planned.normalized.context.authorized_source.review_route = "foreign-route";
    planned.normalized = { context: { authorized_source: { project: "attacker", review_route: "attacker-route" } } };
    const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(result.failure.callback_id, "failure-demo-200-1");
    assert.equal(result.failure.callback.chat_url, "https://chatgpt.com/c/chat-165");
    assert.equal(result.failure.project, "demo"); assert.equal(result.failure.issue, 200); assert.equal(result.failure.iteration, 1);
    assert.equal(result.failure.callback.delivery_state, "PENDING"); assert.equal(result.failure.source_commit, null);
    const outbox = path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test/failure-outbox/failure-demo-200-1.json");
    assert.equal(fs.existsSync(outbox), true);
    const persisted = JSON.parse(fs.readFileSync(outbox, "utf8"));
    assert.equal(persisted.source_commit, null); assert.equal(persisted.callback.delivery_state, "PENDING");
    assert.equal(persisted.callback_id, "failure-demo-200-1"); assert.equal(persisted.project, "demo");
    assert.equal(persisted.callback.chat_url, "https://chatgpt.com/c/chat-165");
    assert.equal(fs.existsSync(path.join(f.home, ".chatgpt-codex-orchestrator/instances/foreign-instance")), false);
    assert.equal(originalNormalized.context.authorized_source.project, "foreign");
    await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /claimed|uncertain|Duplicate/);
  } finally { process.env.HOME = old; }
});

test("rejects forged authorization snapshots without file side effects", () => {
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home; const before = fs.readdirSync(f.home);
  try { assert.throws(() => prepareFailureForAuthorizedSnapshot({ authorization: { instance_id: "exec-test", project: "demo", repository: "owner/repo", issue: 200, iteration: 1, author: "trusted", chat_url: "https://chatgpt.com/c/chat-165", configuration: {} }, stage: "codex", code: "CODEX_NONZERO" }), /genuine authorization snapshot/); assert.deepEqual(fs.readdirSync(f.home), before); }
  finally { process.env.HOME = old; }
});

test("rejects executables beneath writable parents while accepting private parents and trusted temp boundaries", async () => {
  for (const mode of [0o777, 0o775]) {
    const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
    const parent = path.join(f.root, `writable-${mode.toString(8)}`); const executable = path.join(parent, "codex");
    fs.mkdirSync(parent); fs.chmodSync(parent, mode); fs.copyFileSync(f.codex, executable); fs.chmodSync(executable, 0o700);
    try {
      const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: executable, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /trusted/);
      assert.equal(fs.existsSync(path.join(f.repo, "argv")), false);
      assert.equal(fs.existsSync(path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test/macos-execution-ledger/demo-200-1.json")), false);
    } finally { process.env.HOME = old; }
  }
  const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
  const privateParent = path.join(f.root, "private-bin"); const privateExecutable = path.join(privateParent, "codex");
  fs.mkdirSync(privateParent, 0o700); fs.copyFileSync(f.codex, privateExecutable); fs.chmodSync(privateExecutable, 0o700);
  try {
    const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
    const result = await executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: privateExecutable, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(result.execution_state, "EXECUTED_UNVALIDATED");
    assert.equal(fs.readFileSync(path.join(f.repo, "argv"), "utf8"), "exec--full-auto");
  } finally { process.env.HOME = old; }
});

test("preexisting unsafe log paths fail before claim and persist one recoverable P1 failure", async () => {
  for (const kind of ["symlink", "file"]) {
    const f = fixture(); const old = process.env.HOME; process.env.HOME = f.home;
    const state = path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test");
    const logs = path.join(state, "macos-execution-logs"); const outside = path.join(f.root, "outside");
    fs.mkdirSync(outside); const sentinel = path.join(outside, "sentinel"); fs.writeFileSync(sentinel, "untouched\n");
    if (kind === "symlink") fs.symlinkSync(outside, logs); else fs.writeFileSync(logs, "not a directory\n");
    try {
      const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /Unsafe|directory/);
      const outbox = path.join(state, "failure-outbox"); const files = fs.readdirSync(outbox).filter(name => name.endsWith(".json") && !name.endsWith(".journal.json"));
      assert.deepEqual(files, ["failure-demo-200-1.json"]); const first = JSON.parse(fs.readFileSync(path.join(outbox, files[0]), "utf8"));
      assert.equal(first.project, "demo"); assert.equal(first.issue, 200); assert.equal(first.iteration, 1); assert.equal(first.source_commit, null); assert.equal(first.callback.chat_url, "https://chatgpt.com/c/chat-165"); assert.equal(first.callback.delivery_state, "PENDING");
      assert.equal(fs.existsSync(path.join(state, "macos-execution-ledger/demo-200-1.json")), false); assert.equal(fs.existsSync(path.join(f.repo, "argv")), false); assert.equal(fs.readFileSync(sentinel, "utf8"), "untouched\n");
      await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /Unsafe|directory/);
      assert.deepEqual(fs.readdirSync(outbox).filter(name => name.endsWith(".json") && !name.endsWith(".journal.json")), files); assert.equal(fs.existsSync(path.join(f.repo, "argv")), false);
    } finally { process.env.HOME = old; }
  }
});

test("log rename failure settles as UNKNOWN with one original-Chat P1 callback and no rerun", { timeout: 15000 }, async () => {
  for (const exitCode of [0, 7]) {
    const f = fixture(); const old = process.env.HOME; const renameSync = fs.renameSync;
    const state = path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test");
    const logFile = path.join(state, "macos-execution-logs/demo-200-1.json");
    const ledgerFile = path.join(state, "macos-execution-ledger/demo-200-1.json");
    const outbox = path.join(state, "failure-outbox"); const callbackFile = path.join(outbox, "failure-demo-200-1.json");
    let deadline; let logFailures = 0;
    try {
      process.env.HOME = f.home;
      // Keep the clone clean so the claim, rather than a dirty-clone check, must prevent a rerun.
      fs.writeFileSync(f.codex, `#!/bin/sh\nprintf 'launch\\n' >> "$0.launches"\ncat >/dev/null\nexit ${exitCode}\n`);
      const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      const routesFile = path.join(state, "chat-routes.json"); const routes = JSON.parse(fs.readFileSync(routesFile, "utf8"));
      routes.routes.push({ project: "demo", route: "chat-212", status: "active", chat_url: "https://chatgpt.com/c/chat-212" });
      fs.writeFileSync(routesFile, JSON.stringify(routes)); planned.plan.review_route = "chat-212";
      fs.renameSync = (from, to) => {
        if (to === logFile) { logFailures++; throw Object.assign(new Error("ENOSPC secret=log_DIAGNOSTIC_123456"), { code: "ENOSPC" }); }
        return renameSync(from, to);
      };
      const result = await Promise.race([
        executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Log persistence failure did not settle")), 3000); })
      ]);
      clearTimeout(deadline);
      assert.equal(logFailures, 1); assert.equal(result.state, "UNKNOWN");
      const ledgerText = fs.readFileSync(ledgerFile, "utf8"); const ledger = JSON.parse(ledgerText);
      assert.equal(ledger.execution_state, "UNKNOWN"); assert.equal(ledger.callback_id, "failure-demo-200-1");
      assert.equal(ledger.project, "demo"); assert.equal(ledger.issue, 200); assert.equal(ledger.iteration, 1);
      assert.deepEqual(fs.readdirSync(outbox), ["failure-demo-200-1.json"]);
      const callbackText = fs.readFileSync(callbackFile, "utf8"); const persisted = JSON.parse(callbackText);
      assert.deepEqual(result.failure, persisted);
      assert.equal(persisted.stage, "unknown"); assert.equal(persisted.code, "CODEX_LOG_PERSIST_FAILED");
      assert.equal(persisted.project, "demo"); assert.equal(persisted.issue, 200); assert.equal(persisted.iteration, 1);
      assert.equal(persisted.source_commit, null); assert.equal(persisted.source_commit_available, false); assert.equal(persisted.exit_code, null);
      assert.equal(persisted.callback_id, "failure-demo-200-1"); assert.equal(persisted.callback.callback_id, persisted.callback_id);
      assert.equal(persisted.callback.chat_url, "https://chatgpt.com/c/chat-165"); assert.equal(persisted.callback.delivery_state, "PENDING"); assert.equal(persisted.delivery_state, "PENDING");
      assert.doesNotMatch(callbackText + ledgerText, /ENOSPC|log_DIAGNOSTIC_123456|chat-212/);
      assert.equal(fs.existsSync(logFile), false); assert.equal(fs.existsSync(path.join(f.repo, "argv")), false);
      assert.equal(fs.readFileSync(`${f.codex}.launches`, "utf8"), "launch\n");
      fs.renameSync = renameSync;
      await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /claimed|uncertain/);
      assert.equal(fs.readFileSync(`${f.codex}.launches`, "utf8"), "launch\n");
      assert.equal(fs.readFileSync(callbackFile, "utf8"), callbackText); assert.equal(fs.readFileSync(ledgerFile, "utf8"), ledgerText);
      assert.deepEqual(fs.readdirSync(outbox), ["failure-demo-200-1.json"]);
    } finally {
      clearTimeout(deadline); fs.renameSync = renameSync;
      if (old === undefined) delete process.env.HOME; else process.env.HOME = old;
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test("log failure reconciliation rejects and prevents rerun when persistence is unavailable", { timeout: 20000 }, async () => {
  for (const unavailable of ["outbox", "ledger", "both"]) {
    const f = fixture(); const old = process.env.HOME; const renameSync = fs.renameSync;
    const state = path.join(f.home, ".chatgpt-codex-orchestrator/instances/exec-test");
    const logFile = path.join(state, "macos-execution-logs/demo-200-1.json");
    const ledgerFile = path.join(state, "macos-execution-ledger/demo-200-1.json");
    const outbox = path.join(state, "failure-outbox"); const callbackFile = path.join(outbox, "failure-demo-200-1.json");
    const journalFile = path.join(outbox, "failure-demo-200-1.journal.json");
    const outboxUnavailable = unavailable !== "ledger"; const ledgerUnavailable = unavailable !== "outbox";
    const attempts = new Set(); let deadline;
    try {
      process.env.HOME = f.home;
      fs.writeFileSync(f.codex, "#!/bin/sh\nprintf 'launch\\n' >> \"$0.launches\"\ncat >/dev/null\nexit 0\n");
      const planned = planMacosCodexRun({ event: f.event(), controlRoot: f.control, controlRepository: "control/private", trustedGithubUsername: ["trusted"] });
      fs.renameSync = (from, to) => {
        attempts.add(to);
        if (to === logFile || (outboxUnavailable && to === callbackFile) || (ledgerUnavailable && to === ledgerFile)) throw Object.assign(new Error("ENOSPC secret=recovery_DIAGNOSTIC_123456"), { code: "ENOSPC" });
        return renameSync(from, to);
      };
      await assert.rejects(() => Promise.race([
        executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Reconciliation did not settle")), 3000); })
      ]), error => {
        assert.equal(error.code, "CODEX_LOG_PERSIST_FAILED"); assert.doesNotMatch(error.message, /ENOSPC|recovery_DIAGNOSTIC_123456/); return true;
      });
      clearTimeout(deadline);
      assert.equal(attempts.has(logFile), true); assert.equal(attempts.has(callbackFile), true); assert.equal(attempts.has(ledgerFile), true);
      // If storage refuses the UNKNOWN update, the original claim must still block execution.
      const ledgerText = fs.readFileSync(ledgerFile, "utf8"); const ledger = JSON.parse(ledgerText);
      assert.equal(ledger.execution_state, ledgerUnavailable ? "CLAIMED" : "UNKNOWN");
      assert.equal(ledger.project, "demo"); assert.equal(ledger.issue, 200); assert.equal(ledger.iteration, 1);
      const incidentFile = outboxUnavailable ? journalFile : callbackFile;
      const incidentText = fs.readFileSync(incidentFile, "utf8"); const record = JSON.parse(incidentText);
      const incident = outboxUnavailable ? record.failure : record;
      assert.equal(incident.stage, "unknown"); assert.equal(incident.code, "CODEX_LOG_PERSIST_FAILED"); assert.equal(incident.source_commit, null);
      assert.equal(incident.project, "demo"); assert.equal(incident.issue, 200); assert.equal(incident.iteration, 1);
      assert.equal(incident.callback_id, "failure-demo-200-1"); assert.equal(incident.callback.chat_url, "https://chatgpt.com/c/chat-165"); assert.equal(incident.callback.delivery_state, "PENDING");
      assert.doesNotMatch(incidentText, /ENOSPC|recovery_DIAGNOSTIC_123456/);
      assert.deepEqual(fs.readdirSync(outbox).filter(name => name.endsWith(".json")), [path.basename(incidentFile)]);
      fs.renameSync = renameSync;
      await assert.rejects(() => executeMacosCodexRun({ planned, repoPath: f.repo, codexExecutable: f.codex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 }), /claimed|uncertain/);
      assert.equal(fs.readFileSync(`${f.codex}.launches`, "utf8"), "launch\n");
      assert.equal(fs.readFileSync(ledgerFile, "utf8"), ledgerText); assert.equal(fs.readFileSync(incidentFile, "utf8"), incidentText);
      assert.deepEqual(fs.readdirSync(outbox).filter(name => name.endsWith(".json")), [path.basename(incidentFile)]);
    } finally {
      clearTimeout(deadline); fs.renameSync = renameSync;
      if (old === undefined) delete process.env.HOME; else process.env.HOME = old;
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  }
});
