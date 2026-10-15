import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planMacosCodexRun, recordMacosPreflightFailure } from "../src/lib/macos-codex-run-contract.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "macos-preflight-"));
  const home = path.join(root, "home"), control = path.join(root, "control"); fs.mkdirSync(home); fs.mkdirSync(control);
  fs.writeFileSync(path.join(control, "instance.json"), JSON.stringify({ instance_id: "test-instance" }));
  fs.writeFileSync(path.join(control, "projects.json"), JSON.stringify({ projects: { demo: { enabled: true, repository: "jackie-water/ChatGPT-Codex-Orchestrator", default_branch: "main", max_iterations: 5, allowed_validation_executables: ["node"], default_validation_steps: [{ name: "tests", command: "node", arguments: ["--test"] }] } } }));
  const state = path.join(home, ".chatgpt-codex-orchestrator", "instances", "test-instance"); fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "chat-routes.json"), JSON.stringify({ routes: [{ project: "demo", route: "chat-165", status: "active", chat_url: "https://chatgpt.com/c/chat-165" }] }));
  const event = body => ({ repository: { full_name: "jackie-water/control-private" }, issue: { title: "[CODEX-RUN] demo", number: 165, user: { login: "trusted" }, body: JSON.stringify({ project: "demo", iteration: 1, review_route: "chat-165", prompt: "Implement the task", target_branch: "feat/task", ...body }) } });
  return { root, home, control, event };
}
function withHome(home, fn) { const old = process.env.HOME; process.env.HOME = home; try { return fn(); } finally { process.env.HOME = old; } }

test("good event plans without filesystem side effects", () => {
  const f = fixture(); const before = fs.readdirSync(f.home); const p = withHome(f.home, () => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] }));
  assert.equal(p.plan.repository, "jackie-water/ChatGPT-Codex-Orchestrator"); assert.equal(p.plan.review_route, "chat-165"); assert.deepEqual(fs.readdirSync(f.home), before);
});

test("normal prose punctuation is allowed but executable routine lines are rejected", () => {
  const f = fixture();
  assert.doesNotThrow(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ prompt: "Fix the callback (without changing API), and preserve $ behavior." }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ prompt: "Please do this:\n- npm test" }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
});

test("iteration controls request kind and prompt limit", () => {
  const f = fixture();
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ iteration: 2, request: "initial", prompt: "x".repeat(7000) }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ max_iterations: 6 }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ max_iterations: 0 }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ iteration: 2, max_iterations: 1, request: "revise", prompt: "x" }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
});

test("Git-invalid dotted and lock branch components reject while valid components succeed", () => {
  const f = fixture();
  for (const target_branch of ["feat/task/.hidden", "feat/a/.dot", "feat/.hidden", "feat/a..b", "feat/a.lock", "feat/a."]) assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ target_branch }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  for (const target_branch of ["feat/a/b", "feat/a.b/c-d"]) assert.doesNotThrow(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ target_branch }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
});

test("invalid configured default Git ref fails closed", () => {
  for (const default_branch of ["main/.hidden", "main/a..b", "main/a.lock", "main/a."]) {
    const f = fixture(); const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8"));
    projects.projects.demo.default_branch = default_branch; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
    assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  }
});

test("corrupt unrelated and symlinked run state fails closed", () => {
  const f = fixture(); const dir = path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "test-instance", "run-state"); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "unrelated.json"), "corrupt");
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
});

test("symlinked state directories fail closed before traversal", () => {
  const f = fixture(); const base = path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "test-instance");
  for (const dir of ["codex-runs", "run-state", "runs", "failure-outbox"]) {
    fs.symlinkSync(path.join(f.root, `unrelated-${dir}`), path.join(base, dir), "dir");
    assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
    fs.unlinkSync(path.join(base, dir));
  }
  const failure = path.join(base, "failure-outbox"); fs.mkdirSync(failure);
  fs.writeFileSync(path.join(failure, "failure-demo-165-1.json"), JSON.stringify({ execution_state: "TERMINAL_FAILURE", project: "demo", issue: 165, iteration: 1, callback_id: "failure-demo-165-1", callback: { callback_id: "failure-demo-165-1", delivery_state: "PENDING" } }));
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
});

test("configured max_iterations is limited to 20", () => {
  for (const max_iterations of [21, 30]) {
    const f = fixture(); const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8"));
    projects.projects.demo.max_iterations = max_iterations; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
    assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ iteration: 20, request: "revise" }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  }
  const f = fixture(); const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8"));
  projects.projects.demo.max_iterations = 20; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
  assert.doesNotThrow(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ iteration: 20, request: "revise" }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
});

test("matching completed or malformed run state is never rerun", () => {
  const f = fixture(); const dir = path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "test-instance", "run-state"); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ project: "demo", issue: 165, iteration: 1, execution_state: "COMPLETED" }));
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  fs.rmSync(path.join(dir, "run.json")); fs.writeFileSync(path.join(dir, "codex-demo-165-1.json"), "not-json");
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
});

test("default validation steps remain and user argv is appended and deduped", () => {
  const f = fixture(); const p = withHome(f.home, () => planMacosCodexRun({ event: f.event({ validation_steps: [{ name: "same", command: "node", arguments: ["--test"] }] }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] }));
  assert.equal(p.plan.validation_steps.length, 1);
  assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event({ validation_steps: [{ name: "bad", command: "npm", arguments: ["test; rm -rf /"] }] }), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
});

test("validation executable allowlist defaults only when omitted", () => {
  const configure = (f, allow, steps) => {
    const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8"));
    if (allow === "omitted") delete projects.projects.demo.allowed_validation_executables;
    else projects.projects.demo.allowed_validation_executables = allow;
    projects.projects.demo.default_validation_steps = steps;
    fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
  };
  const plan = (f, body = {}) => withHome(f.home, () => planMacosCodexRun({ event: f.event(body), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] }));

  let f = fixture(); configure(f, "omitted", [{ name: "git", command: "git", arguments: ["status", "--short"] }]);
  assert.doesNotThrow(() => plan(f));

  f = fixture(); configure(f, [], [{ name: "git", command: "git", arguments: ["status", "--short"] }]);
  assert.throws(() => plan(f), /Validation executable is not allowed/);

  f = fixture(); configure(f, ["node"], [{ name: "node", command: "node", arguments: ["--version"] }]);
  assert.doesNotThrow(() => plan(f));
  f = fixture(); configure(f, ["node"], [{ name: "git", command: "git", arguments: ["status", "--short"] }]);
  assert.throws(() => plan(f), /Validation executable is not allowed/);

  f = fixture(); configure(f, ["node"], [{ name: "node", command: "node", arguments: ["--version"] }]);
  assert.deepEqual(plan(f).plan.validation_steps, [{ name: "node", command: "node", arguments: ["--version"] }]);
});

test("unsafe inputs reject before callback creation", () => {
  const f = fixture(); for (const body of [{ target_branch: "main" }, { iteration: 6 }, { prompt: "run bash -c evil" }, { validation_steps: [{ name: "x", command: "sh", arguments: ["-c", "evil"] }] }]) assert.throws(() => withHome(f.home, () => planMacosCodexRun({ event: f.event(body), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] })));
  assert.equal(fs.existsSync(path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "test-instance", "failure-outbox")), false);
});

test("trusted preflight failure is durable and idempotent without source SHA", () => {
  const f = fixture(); withHome(f.home, () => { const p = planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] }); const a = recordMacosPreflightFailure({ planned: p, controlRoot: f.control, trustedGithubUsername: ["trusted"], code: "SAFE_PREFLIGHT" }); const b = recordMacosPreflightFailure({ planned: p, controlRoot: f.control, trustedGithubUsername: ["trusted"], code: "SAFE_PREFLIGHT" }); assert.equal(a.state.callback.delivery_state, "PENDING"); assert.equal(a.state.source_commit, null); assert.equal(b.reused, true); });
});

test("preflight recording requires the private validated plan binding", () => {
  const f = fixture(); withHome(f.home, () => {
    const args = { controlRoot: f.control, trustedGithubUsername: ["trusted"], code: "SAFE_PREFLIGHT" };
    assert.throws(() => recordMacosPreflightFailure({ planned: { normalized: { event: f.event({ target_branch: "main", prompt: "npm test" }) } }, ...args }));
    assert.equal(fs.existsSync(path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "test-instance", "failure-outbox")), false);
  });
});

test("preflight recording uses the immutable authorized snapshot and rejects mismatched authority", () => {
  const f = fixture(); withHome(f.home, () => {
    const p = planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] });
    p.normalized.event.issue.body = JSON.stringify({ project: "demo", iteration: 1, review_route: "chat-165", target_branch: "main", prompt: "npm test" });
    p.plan.project = "forged";
    assert.throws(() => recordMacosPreflightFailure({ planned: p, controlRoot: f.control, trustedGithubUsername: ["other"], code: "SAFE_PREFLIGHT" }));
    assert.throws(() => recordMacosPreflightFailure({ planned: p, controlRoot: path.join(f.control, "other"), trustedGithubUsername: ["trusted"], code: "SAFE_PREFLIGHT" }));
    const result = recordMacosPreflightFailure({ planned: p, controlRoot: f.control, trustedGithubUsername: ["trusted"], code: "SAFE_PREFLIGHT" });
    assert.equal(result.state.project, "demo");
    assert.equal(result.state.source_commit, null);
    assert.equal(recordMacosPreflightFailure({ planned: p, controlRoot: f.control, trustedGithubUsername: ["trusted"], code: "SAFE_PREFLIGHT" }).reused, true);
  });
});

test("failure outbox and prepared journals suppress only the exact instance task", () => {
  const f = fixture(); withHome(f.home, () => {
    const p = planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] });
    recordMacosPreflightFailure({ planned: p, controlRoot: f.control, trustedGithubUsername: ["trusted"], code: "SAFE_PREFLIGHT" });
    assert.throws(() => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] }));
    const base = path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "test-instance", "failure-outbox"); fs.rmSync(base, { recursive: true }); fs.mkdirSync(base, { recursive: true });
    const failure = { execution_state: "TERMINAL_FAILURE", project: "demo", issue: 165, iteration: 1, callback_id: "failure-demo-165-1", callback: { callback_id: "failure-demo-165-1", delivery_state: "PENDING" } };
    fs.writeFileSync(path.join(base, "failure-demo-165-1.journal.json"), JSON.stringify({ version: 1, phase: "prepared", callback_id: failure.callback_id, failure }));
    assert.throws(() => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] }));
    fs.rmSync(path.join(base, "failure-demo-165-1.journal.json")); fs.writeFileSync(path.join(base, "other.json"), JSON.stringify({ execution_state: "TERMINAL_FAILURE", project: "demo", issue: 999, iteration: 1, callback_id: "failure-demo-999-1", callback: { callback_id: "failure-demo-999-1", delivery_state: "DELIVERED" } }));
    assert.doesNotThrow(() => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] }));
    fs.writeFileSync(path.join(base, "bad.json"), "not-json"); assert.throws(() => planMacosCodexRun({ event: f.event({}), controlRoot: f.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["trusted"] }));
  });
});
