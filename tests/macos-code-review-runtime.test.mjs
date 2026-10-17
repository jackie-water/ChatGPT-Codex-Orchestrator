import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { callbackRecord, ensurePendingCallback, parseReviewEvidence, pendingWakesPath, publicationIntentPath, validateReviewEvent } from "../src/lib/macos-code-review-runtime.mjs";

const sha = "9203170f74b57dade7702fb0530e994ecf531c17";
function fixture() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "macos-review-runtime-"));
  const home = path.join(root, "home"), control = path.join(root, "control"), instance = "fixture01";
  const instanceRoot = path.join(home, ".chatgpt-codex-orchestrator", "instances", instance);
  const automation = path.join(instanceRoot, "automation", `sandbox-${instance}`);
  fs.mkdirSync(control, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(automation), { recursive: true, mode: 0o700 });
  fs.mkdirSync(automation, { recursive: true, mode: 0o700 });
  spawnSync("git", ["-C", automation, "init", "-q"]);
  spawnSync("git", ["-C", automation, "remote", "add", "origin", `https://github.com/trusted/chatgpt-codex-orchestrator-sandbox-${instance}.git`]);
  const instanceJson = { schema_version: 1, instance_id: instance, trusted_github_username: "trusted", control_repository: "trusted/control", platform: "darwin", arch: "arm64", runner_label: "codex-orchestrator-fixture" };
  const projects = { projects: { [`sandbox-${instance}`]: { enabled: true, repository: `trusted/chatgpt-codex-orchestrator-sandbox-${instance}`, local_path_key: `sandbox-${instance}`, default_branch: "main", checkpoint_branch: "codex/checkpoints", code_review: { enabled: true, review_model: "gpt-5.6-luna", review_reasoning: "medium" } }, target: { enabled: false, repository: "trusted/target" } } };
  fs.writeFileSync(path.join(control, "instance.json"), JSON.stringify(instanceJson), { mode: 0o644 });
  fs.writeFileSync(path.join(control, "projects.json"), JSON.stringify(projects), { mode: 0o644 });
  fs.mkdirSync(instanceRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(instanceRoot, "chat-routes.json"), JSON.stringify({ routes: [{ route: "chat-232", project: `sandbox-${instance}`, chat_url: "https://chatgpt.com/g/project/c/chat-232", status: "active" }] }), { mode: 0o600 });
  const event = body => ({ repository: { full_name: "trusted/control" }, issue: { title: "[CODE-REVIEW] native adapter", number: 258, user: { login: "trusted" }, body: JSON.stringify({ project: `sandbox-${instance}`, source_branch: "feat/task", reviewed_commit: sha, review_route: "chat-232", ...body }) } });
  return { root, home, control, instanceRoot, event };
}

test("accepts prefix title, 0644 Control metadata, and exact Sandbox project Chat URL", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const value = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  assert.equal(value.req.review_route, "chat-232");
});

test("rejects wrong author, target enablement, route collision, repo, and untrusted path", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  assert.throws(() => validateReviewEvent({ event: { ...f.event({}), issue: { ...f.event({}).issue, user: { login: "attacker" } } }, controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /UNTRUSTED_REVIEW_AUTHOR/);
  const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8")); projects.projects.target.enabled = true; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
  assert.throws(() => validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /NON_SANDBOX_PROJECT_ENABLED/);
  projects.projects.target.enabled = false; projects.projects["sandbox-fixture01"] = { ...projects.projects["sandbox-fixture01"], local_path_key: "wrong" }; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
  assert.throws(() => validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /INVALID_AUTOMATION_PATH_KEY|TARGET_ROUTING_FORBIDDEN|AUTOMATION_CLONE_MISSING/);
  const routes = JSON.parse(fs.readFileSync(path.join(f.instanceRoot, "chat-routes.json"), "utf8")); routes.routes.push(routes.routes[0]); fs.writeFileSync(path.join(f.instanceRoot, "chat-routes.json"), JSON.stringify(routes));
  projects.projects["sandbox-fixture01"].local_path_key = "sandbox-fixture01"; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
  assert.throws(() => validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /ROUTE_REGISTRY_NOT_UNIQUE/);
});

test("accepts the generated checkpoint ref and rejects malformed or protected refs before clone use", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const projectFile = path.join(f.control, "projects.json");
  const original = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }).project.checkpoint_branch, "codex/checkpoints");
  for (const checkpoint_branch of ["main", "../checkpoint", "codex//checkpoints", "codex/..", "codex/checkpoints.lock", "codex/check@{points}", "codex/check points", "/codex/checkpoints"]) {
    const next = structuredClone(original); next.projects["sandbox-fixture01"].checkpoint_branch = checkpoint_branch; fs.writeFileSync(projectFile, JSON.stringify(next));
    assert.throws(() => validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /TARGET_ROUTING_FORBIDDEN/);
  }
});

test("evidence parser requires exact immutable fields and one Status", () => {
  const base = `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n- project: sandbox-fixture01\n- repository: trusted/chatgpt-codex-orchestrator-sandbox-fixture01\n- source_branch: feat/task\n- reviewed_commit: ${sha}\n\nStatus: CODE_REVIEW_COMPLETE\n`;
  assert.equal(parseReviewEvidence(base, { project: "sandbox-fixture01", repository: "trusted/chatgpt-codex-orchestrator-sandbox-fixture01", sourceBranch: "feat/task", reviewedCommit: sha }).status, "CODE_REVIEW_COMPLETE");
  assert.equal(parseReviewEvidence(`${base}Status: CODE_REVIEW_FAILED\n`, { project: "sandbox-fixture01", repository: "trusted/chatgpt-codex-orchestrator-sandbox-fixture01", sourceBranch: "feat/task", reviewedCommit: sha }), null);
  assert.equal(parseReviewEvidence(base.replace(sha, "0".repeat(40)), { project: "sandbox-fixture01", repository: "trusted/chatgpt-codex-orchestrator-sandbox-fixture01", sourceBranch: "feat/task", reviewedCommit: sha }), null);
});

test("callback recovery preserves immutable delivery state", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const v = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  const record = callbackRecord(v, { status: "CODE_REVIEW_COMPLETE" }, "a".repeat(40));
  const file = path.join(f.instanceRoot, "pending-wakes", `${record.callback_id}.json`); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ ...record, delivery_state: "SUBMISSION_ATTEMPTED", verified_by: "not-a-receipt" }), { mode: 0o600 });
  const recovered = ensurePendingCallback(file, record);
  assert.equal(recovered.delivery_state, "SUBMISSION_ATTEMPTED");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).verified_by, "not-a-receipt");
});

test("publication intent is outside the callback-only pending-wakes directory", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const v = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  const intent = publicationIntentPath(v, sha);
  assert.notEqual(path.dirname(intent), pendingWakesPath(v));
  fs.mkdirSync(path.dirname(intent), { recursive: true, mode: 0o700 });
  fs.writeFileSync(intent, JSON.stringify({ reviewed_commit: sha, state: "PUBLISHED" }), { mode: 0o600 });
  const callback = callbackRecord(v, { status: "CODE_REVIEW_COMPLETE" }, "a".repeat(40));
  fs.mkdirSync(pendingWakesPath(v), { recursive: true, mode: 0o700 });
  ensurePendingCallback(path.join(pendingWakesPath(v), `${callback.callback_id}.json`), callback);
  assert.deepEqual(fs.readdirSync(pendingWakesPath(v)), [`${callback.callback_id}.json`]);
});
