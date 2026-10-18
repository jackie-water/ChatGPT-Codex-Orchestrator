import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { preflightMacosSandboxMerge } from "../src/lib/macos-sandbox-merge-runtime.mjs";

const git = (cwd, args, encoding = "utf8") => spawnSync("/usr/bin/git", ["-C", cwd, ...args], { encoding }).stdout;
const run = (cwd, args) => { const result = spawnSync("/usr/bin/git", ["-C", cwd, ...args], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const sha = cwd => run(cwd, ["rev-parse", "HEAD"]);

function fixture(t, { forkCheckpoint = false } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sandbox-merge-") ); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home"), control = path.join(root, "control"), bare = path.join(root, "sandbox.git");
  const instance = "fixture01", project = `sandbox-${instance}`, instanceRoot = path.join(home, ".chatgpt-codex-orchestrator", "instances", instance), automation = path.join(instanceRoot, "automation", project), work = path.join(root, "work");
  for (const dir of [control, path.dirname(automation)]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  run(root, ["init", "--bare", "-q", bare]); run(root, ["init", "-q", "-b", "main", work]);
  run(work, ["config", "user.name", "fixture"]); run(work, ["config", "user.email", "fixture@example.invalid"]);
  fs.writeFileSync(path.join(work, "README.md"), "base\n"); run(work, ["add", "."]); run(work, ["commit", "-q", "-m", "base"]);
  const base = sha(work); run(work, ["branch", "feat/task"]);
  fs.writeFileSync(path.join(work, "change.txt"), "change\n"); run(work, ["checkout", "-q", "feat/task"]); run(work, ["add", "."]); run(work, ["commit", "-q", "-m", "change"]); const approved = sha(work);
  const review = `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n# Review\n\n- project: ${project}\n- repository: trusted/chatgpt-codex-orchestrator-sandbox-${instance}\n- source_branch: feat/task\n- reviewed_commit: ${approved}\n- checkpoint_branch: codex/checkpoints\n\nStatus: CODE_REVIEW_COMPLETE\n`;
  run(work, ["branch", "codex/checkpoints", forkCheckpoint ? base : approved]); run(work, ["checkout", "-q", "codex/checkpoints"]); fs.mkdirSync(path.join(work, ".codex/reviews/by-commit"), { recursive: true }); fs.writeFileSync(path.join(work, ".codex/reviews/by-commit", `${approved}.md`), review); run(work, ["add", "."]); run(work, ["commit", "-q", "-m", "review"]); const checkpoint = sha(work);
  run(work, ["remote", "add", "origin", bare]); run(work, ["push", "-q", "origin", "main", "feat/task", "codex/checkpoints"]);
  run(root, ["clone", "-q", bare, automation]); run(automation, ["config", "core.filemode", "false"]);
  fs.writeFileSync(path.join(control, "instance.json"), JSON.stringify({ instance_id: instance, trusted_github_username: "trusted", control_repository: "trusted/control", platform: "darwin", arch: "arm64" }));
  fs.writeFileSync(path.join(control, "projects.json"), JSON.stringify({ projects: { [project]: { enabled: true, repository: `trusted/chatgpt-codex-orchestrator-sandbox-${instance}`, local_path_key: project, default_branch: "main", checkpoint_branch: "codex/checkpoints" }, target: { enabled: false, repository: "trusted/target" } } }));
  fs.mkdirSync(instanceRoot, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(instanceRoot, "chat-routes.json"), JSON.stringify({ routes: [{ route: "chat-303", project, status: "active", chat_url: "https://chatgpt.com/c/chat-303" }] }), { mode: 0o600 });
  const body = () => ({ project, source_branch: "feat/task", approved_commit: approved, review_route: "chat-303" });
  const event = overrides => ({ repository: { full_name: "trusted/control" }, issue: { title: "[MERGE-APPROVE] fixture", number: 303, user: { login: "trusted" }, body: JSON.stringify({ ...body(), ...overrides }) } });
  const refs = () => run(bare, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]);
  return { root, home, control, bare, automation, project, approved, checkpoint, event, refs };
}

function call(f, event = f.event({})) { return preflightMacosSandboxMerge({ event, controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home, sandboxOrigin: f.bare }); }

test("valid exact approval returns a read-only merge plan", t => { const f = fixture(t); const before = f.refs(); const defaultRecord = git(f.automation, ["ls-remote", "origin", "refs/heads/main"]).trim(); const [defaultSha, defaultRef] = defaultRecord.split(/\s+/); assert.match(defaultSha, /^[0-9a-f]{40}$/); assert.equal(defaultRef, "refs/heads/main"); const plan = call(f); assert.deepEqual(plan, { approved_sha: f.approved, remote_default_before: defaultSha, remote_source: f.approved, checkpoint: f.checkpoint, review_file: `.codex/reviews/by-commit/${f.approved}.md`, route: "https://chatgpt.com/c/chat-303" }); assert.equal(f.refs(), before); });

test("accepts an independently forked checkpoint with exact review evidence", t => {
  const f = fixture(t, { forkCheckpoint: true });
  const before = f.refs();
  const plan = call(f);
  assert.equal(plan.approved_sha, f.approved);
  assert.equal(plan.checkpoint, f.checkpoint);
  assert.equal(f.refs(), before);
});

test("fetches newly advanced remote objects from a stale automation clone", t => {
  const f = fixture(t);
  const publisher = path.join(f.root, "publisher");
  run(f.root, ["clone", "-q", f.bare, publisher]);
  run(publisher, ["config", "user.name", "fixture"]);
  run(publisher, ["config", "user.email", "fixture@example.invalid"]);
  run(publisher, ["checkout", "-q", "-B", "feat/task", "origin/feat/task"]);
  fs.writeFileSync(path.join(publisher, "advanced.txt"), "advanced\n");
  run(publisher, ["add", "."]); run(publisher, ["commit", "-q", "-m", "advanced source"]);
  const advanced = sha(publisher);
  run(publisher, ["checkout", "-q", "-B", "codex/checkpoints", "origin/codex/checkpoints"]);
  const review = `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n# Review\n\n- project: ${f.project}\n- repository: trusted/chatgpt-codex-orchestrator-sandbox-fixture01\n- source_branch: feat/task\n- reviewed_commit: ${advanced}\n- checkpoint_branch: codex/checkpoints\n\nStatus: CODE_REVIEW_COMPLETE\n`;
  fs.writeFileSync(path.join(publisher, ".codex/reviews/by-commit", `${advanced}.md`), review);
  run(publisher, ["add", "."]); run(publisher, ["commit", "-q", "-m", "advanced review"]);
  const advancedCheckpoint = sha(publisher);
  run(publisher, ["push", "-q", "origin", "feat/task", "codex/checkpoints"]);
  const before = f.refs();
  const plan = call(f, f.event({ approved_commit: advanced }));
  assert.deepEqual({ approved_sha: plan.approved_sha, remote_source: plan.remote_source, checkpoint: plan.checkpoint }, { approved_sha: advanced, remote_source: advanced, checkpoint: advancedCheckpoint });
  assert.equal(f.refs(), before);
});

test("rejects a checkpoint branch that drifts to an unreviewed head", t => {
  const f = fixture(t);
  const publisher = path.join(f.root, "checkpoint-drift");
  run(f.root, ["clone", "-q", f.bare, publisher]);
  run(publisher, ["checkout", "-q", "-B", "codex/checkpoints", "origin/main"]);
  fs.writeFileSync(path.join(publisher, "drift.txt"), "drift\n");
  run(publisher, ["add", "."]); run(publisher, ["commit", "-q", "-m", "drifted checkpoint"]);
  run(publisher, ["push", "-q", "--force", "origin", "codex/checkpoints"]);
  const before = f.refs();
  assert.throws(() => call(f), /REVIEW_EVIDENCE_MISSING/);
  assert.equal(f.refs(), before);
});

for (const [name, mutate, code] of [
  ["stale approved SHA", f => ({ event: f.event({ approved_commit: "0000000000000000000000000000000000000000" }) }), "APPROVED_SHA_STALE"],
  ["other project", f => ({ event: f.event({ project: "target" }) }), "SANDBOX_PROJECT_REQUIRED"],
  ["unregistered route", f => ({ event: f.event({ review_route: "chat-999" }) }), "ACTIVE_EXACT_CHAT_ROUTE_REQUIRED"],
  ["tampered review", f => { const tamper = path.join(f.root, "tamper"); run(f.root, ["clone", "-q", f.bare, tamper]); run(tamper, ["config", "user.name", "fixture"]); run(tamper, ["config", "user.email", "fixture@example.invalid"]); run(tamper, ["checkout", "-q", "-b", "codex/checkpoints-tampered", "origin/codex/checkpoints"]); const file = path.join(tamper, ".codex/reviews/by-commit", `${f.approved}.md`); fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("CODE_REVIEW_COMPLETE", "CODE_REVIEW_FAILED")); run(tamper, ["add", "."]); run(tamper, ["commit", "-q", "-m", "tampered review fixture"]); run(tamper, ["push", "-q", "origin", "HEAD:refs/heads/codex/checkpoints-tampered"]); const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8")); projects.projects[f.project].checkpoint_branch = "codex/checkpoints-tampered"; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects)); run(f.automation, ["fetch", "-q", "origin", "refs/heads/codex/checkpoints-tampered:refs/remotes/origin/codex/checkpoints-tampered"]); return { event: f.event({}) }; }, "REVIEW_EVIDENCE_INVALID"]
]) test(`rejects ${name} without changing bare refs`, t => { const f = fixture(t); const x = mutate(f); const afterSetup = f.refs(); assert.throws(() => call(f, x.event), new RegExp(code)); assert.equal(f.refs(), afterSetup); });

test("rejects dirty or symlinked automation clone", t => { const f = fixture(t); const before = f.refs(); fs.writeFileSync(path.join(f.automation, "dirty"), "x"); assert.throws(() => call(f), /AUTOMATION_CLONE_DIRTY/); fs.rmSync(path.join(f.automation, "dirty")); fs.renameSync(f.automation, `${f.automation}.real`); fs.symlinkSync(`${f.automation}.real`, f.automation); assert.throws(() => call(f), /SYMLINKED_PRIVATE_PATH/); assert.equal(f.refs(), before); });

test("rejects wrong origin and an extra push URL", t => { const f = fixture(t); const before = f.refs(); run(f.automation, ["remote", "set-url", "origin", "/tmp/not-the-configured-sandbox.git"]); assert.throws(() => call(f), /ORIGIN_IDENTITY_MISMATCH/); run(f.automation, ["remote", "set-url", "origin", f.bare]); run(f.automation, ["config", "remote.origin.pushurl", f.bare]); assert.throws(() => call(f), /ORIGIN_PUSHURL_FORBIDDEN/); assert.equal(f.refs(), before); });

test("rejects non-fast-forward source and malformed configured refs", t => { const f = fixture(t); const divergent = path.join(f.root, "divergent"); run(f.root, ["clone", "-q", f.bare, divergent]); run(divergent, ["config", "user.name", "fixture"]); run(divergent, ["config", "user.email", "fixture@example.invalid"]); fs.writeFileSync(path.join(divergent, "diverge"), "x\n"); run(divergent, ["add", "."]); run(divergent, ["commit", "-q", "-m", "diverge"]); run(divergent, ["push", "-q", "origin", "HEAD:refs/heads/feat/non-ff"]); const afterDivergentPush = f.refs(); assert.throws(() => call(f, f.event({ source_branch: "feat/non-ff" })), /NON_FAST_FORWARD_SOURCE|APPROVED_SHA_STALE/); assert.equal(f.refs(), afterDivergentPush); const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8")); projects.projects[f.project].checkpoint_branch = "codex/../checkpoint"; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects)); assert.throws(() => call(f), /SANDBOX_PROJECT_REQUIRED/); assert.equal(f.refs(), afterDivergentPush); });

test("does not use a project or control default route", t => { const f = fixture(t); const before = f.refs(); const routes = JSON.parse(fs.readFileSync(path.join(f.home, ".chatgpt-codex-orchestrator/instances/fixture01/chat-routes.json"), "utf8")); routes.routes[0].route = "chat-default"; fs.writeFileSync(path.join(f.home, ".chatgpt-codex-orchestrator/instances/fixture01/chat-routes.json"), JSON.stringify(routes)); assert.throws(() => call(f, f.event({ review_route: "chat-303" })), /ACTIVE_EXACT_CHAT_ROUTE_REQUIRED/); assert.equal(f.refs(), before); });

test("rejects activation of the real target project", t => { const f = fixture(t); const before = f.refs(); const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8")); projects.projects.target.target_enabled = true; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects)); assert.throws(() => call(f), /NON_SANDBOX_PROJECT_ENABLED/); assert.equal(f.refs(), before); });
