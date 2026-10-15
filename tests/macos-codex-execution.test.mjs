import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { planMacosCodexRun } from "../src/lib/macos-codex-run-contract.mjs";
import { executeMacosCodexRun } from "../src/lib/macos-codex-execution.mjs";

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
