import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diagnoseMacosControlRunnerReadiness } from "../src/lib/macos-control-runner-readiness.mjs";

function fixture({ runner = true, workflow = "enabled", registration = true, launch = true, callback = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "macos-readiness-fixture-"));
  const runnerPath = path.join(root, "runner");
  if (runner) {
    fs.mkdirSync(runnerPath, { mode: 0o700 });
    fs.writeFileSync(path.join(runnerPath, ".runner"), JSON.stringify({ agentId: 7, listenerId: 9 }), { mode: 0o600 });
  }
  const state = {
    control_repository: "jackie/control-instance01",
    control_clone_path: path.join(root, "control"),
    instance_id: "instance01",
    runner_label: "instance01-runner",
    runner_path: runner ? runnerPath : path.join(root, "missing-runner"),
    launch_agent_label: "com.chatgpt.codex.instance01",
    workflow_state: workflow,
    project_key: "orchestrator-dev",
    review_route: "chat-267",
    instance_root: path.join(root, "instance"),
    callback_observation: { known: true, pending: callback }
  };
  const observations = {
    control: { repository: state.control_repository, instance_id: state.instance_id },
    workflow: { state: workflow, fresh: true },
    runner: registration ? {
      repository: state.control_repository,
      instance_id: state.instance_id,
      labels: ["self-hosted", "macOS", process.arch === "arm64" ? "ARM64" : "X64", state.runner_label],
      status: "online",
      fresh: true
    } : null,
    launchAgent: { label: state.launch_agent_label, owned: launch, loaded: launch },
    route: { status: "active", project: state.project_key, route: state.review_route }
  };
  return { root, state, observations };
}

test("missing runner is not configured and performs no mutation", () => {
  const f = fixture({ runner: false, registration: false, launch: false });
  const before = fs.readdirSync(f.root);
  const result = diagnoseMacosControlRunnerReadiness(f);
  assert.equal(result.status, "RUNNER_NOT_CONFIGURED");
  assert.equal(result.ready, false);
  assert.equal(result.evidence.mutations_performed, false);
  assert.deepEqual(fs.readdirSync(f.root), before);
});

test("disabled workflow is distinguished from a Codex or runner failure", () => {
  const result = diagnoseMacosControlRunnerReadiness(fixture({ workflow: "disabled_manually", registration: false }));
  assert.equal(result.status, "WORKFLOW_DISABLED");
});

test("offline, verified-empty, unknown, and mismatched-label inventories fail closed", () => {
  const offline = fixture();
  offline.observations.runner.status = "offline";
  assert.equal(diagnoseMacosControlRunnerReadiness(offline).status, "RUNNER_OFFLINE");

  const empty = fixture({ registration: false });
  empty.observations.runner = { inventory_status: "verified_empty", runners: [], fresh: true };
  assert.equal(diagnoseMacosControlRunnerReadiness(empty).status, "RUNNER_UNREGISTERED");

  const unknown = fixture({ registration: false });
  unknown.observations.runner = { reachable: false, fresh: true };
  assert.equal(diagnoseMacosControlRunnerReadiness(unknown).status, "UNKNOWN");

  const mismatch = fixture();
  mismatch.observations.runner.labels = ["self-hosted", { name: "macOS" }, { name: "wrong-instance" }];
  assert.equal(diagnoseMacosControlRunnerReadiness(mismatch).status, "CONFLICT");
});

test("Actions runner label objects are normalized without accepting malformed labels", () => {
  const active = fixture();
  active.observations.runner.labels = active.observations.runner.labels.map(name => ({ name }));
  assert.equal(diagnoseMacosControlRunnerReadiness(active).status, "READY");

  const malformed = fixture();
  malformed.observations.runner.labels = ["self-hosted", { value: "macOS" }];
  assert.equal(diagnoseMacosControlRunnerReadiness(malformed).status, "CONFLICT");
});

test("matching active runner is READY only with owned LaunchAgent and exact route", () => {
  const result = diagnoseMacosControlRunnerReadiness(fixture());
  assert.equal(result.status, "READY");
  assert.equal(result.ready, true);
  assert.equal(result.evidence.credentials_used, false);
});

test("LaunchAgent ownership conflict, stale path, read failure, and pending callback are explicit", () => {
  const conflict = fixture();
  conflict.observations.launchAgent.ownership_conflict = true;
  assert.equal(diagnoseMacosControlRunnerReadiness(conflict).status, "CONFLICT");

  assert.equal(diagnoseMacosControlRunnerReadiness(fixture({ runner: false })).status, "RUNNER_NOT_CONFIGURED");

  const readFailure = fixture();
  const failingFs = { ...fs, readFileSync() { const error = new Error("permission denied"); error.code = "EACCES"; throw error; } };
  assert.equal(diagnoseMacosControlRunnerReadiness({ ...readFailure, deps: { fs: failingFs } }).status, "RUNNER_NOT_CONFIGURED");

  const pending = fixture({ callback: true });
  assert.equal(diagnoseMacosControlRunnerReadiness(pending).status, "CALLBACK_PENDING");

  const delivered = fixture();
  delete delivered.state.callback_observation;
  fs.mkdirSync(path.join(delivered.state.instance_root, "pending-wakes"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(delivered.state.instance_root, "pending-wakes", "callback.json"), JSON.stringify({ delivery_state: "DELIVERED", verified_by: "committed-user-turn" }), { mode: 0o600 });
  assert.equal(diagnoseMacosControlRunnerReadiness(delivered).status, "READY");

  const unverified = fixture();
  delete unverified.state.callback_observation;
  fs.mkdirSync(path.join(unverified.state.instance_root, "pending-wakes"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(unverified.state.instance_root, "pending-wakes", "callback.json"), JSON.stringify({ delivery_state: "DELIVERED" }), { mode: 0o600 });
  assert.notEqual(diagnoseMacosControlRunnerReadiness(unverified).status, "READY");

  const malformed = fixture();
  delete malformed.state.callback_observation;
  fs.mkdirSync(path.join(malformed.state.instance_root, "pending-wakes"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(malformed.state.instance_root, "pending-wakes", "callback.json"), "not-json", { mode: 0o600 });
  assert.equal(diagnoseMacosControlRunnerReadiness(malformed).status, "UNKNOWN");

  const symlinked = fixture();
  delete symlinked.state.callback_observation;
  fs.mkdirSync(path.join(symlinked.state.instance_root, "pending-wakes"), { recursive: true, mode: 0o700 });
  const target = path.join(symlinked.root, "outside-callback.json");
  fs.writeFileSync(target, JSON.stringify({ delivery_state: "DELIVERED", verified_by: "committed-user-turn" }), { mode: 0o600 });
  fs.symlinkSync(target, path.join(symlinked.state.instance_root, "pending-wakes", "callback.json"));
  assert.equal(diagnoseMacosControlRunnerReadiness(symlinked).status, "UNKNOWN");

  const staleFalse = fixture();
  fs.mkdirSync(path.join(staleFalse.state.instance_root, "pending-wakes"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(staleFalse.state.instance_root, "pending-wakes", "callback.json"), JSON.stringify({ delivery_state: "PENDING" }), { mode: 0o600 });
  assert.equal(diagnoseMacosControlRunnerReadiness(staleFalse).status, "CALLBACK_PENDING");

  const stale = fixture();
  stale.observations.workflow = { state: "enabled", fresh: false };
  assert.notEqual(diagnoseMacosControlRunnerReadiness(stale).status, "READY");
});
