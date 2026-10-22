import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { inspectMacosExistingInstanceRecovery, inspectMacosSelectedFreshInstance, approveMacosSelectedFreshInstance } from "../src/lib/macos-existing-instance-recovery.mjs";
import { canonicalInstallationId, defaultLocalPaths } from "../src/lib/control-render.mjs";

function fixture(t) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "codex-macos-recovery-"));
  fs.chmodSync(home, 0o700);
  const instances = path.join(home, ".chatgpt-codex-orchestrator", "instances");
  fs.mkdirSync(instances, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(home, ".chatgpt-codex-orchestrator"), 0o700);
  fs.chmodSync(instances, 0o700);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, instances };
}

function writeJson(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode });
  fs.chmodSync(file, mode);
}

test("empty canonical instance tree is ABSENT and read-only", t => {
  const f = fixture(t);
  const before = fs.readdirSync(f.home, { recursive: true }).sort();
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "ABSENT");
  assert.equal(result.mutations_performed, false);
  assert.deepEqual(fs.readdirSync(f.home, { recursive: true }).sort(), before);
});

test("single partial instance is NEEDS_VERIFICATION and never exposes the Chat URL", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "1832f0bb");
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "chat-routes.json"), { routes: [{ route: "chat-333", chat_url: "https://chatgpt.com/c/secret-token" }] });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  const serialized = JSON.stringify(result);
  assert.equal(result.status, "NEEDS_VERIFICATION");
  assert.deepEqual(result.instance_ids, ["1832f0bb"]);
  assert.deepEqual(result.instances[0].route_names, ["chat-333"]);
  assert.equal(serialized.includes("secret-token"), false);
  assert.equal(serialized.includes("chatgpt.com"), false);
});

test("multiple instances are CONFLICT", t => {
  const f = fixture(t);
  for (const id of ["first", "second"]) fs.mkdirSync(path.join(f.instances, id), { mode: 0o700 });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.deepEqual(result.instance_ids, ["first", "second"]);
});

test("symlinked candidate and odd private modes fail closed", t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.home, "outside"), { mode: 0o700 });
  try { fs.symlinkSync(path.join(f.home, "outside"), path.join(f.instances, "linked")); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) return t.skip("symlinks unavailable"); throw error; }
  fs.mkdirSync(path.join(f.instances, "open"), { mode: 0o755 });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
});

test("nested external browser-profile symlink fails closed", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "nested");
  const outside = path.join(f.home, "outside-profile");
  fs.mkdirSync(path.join(instance, "browser-profile"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(outside, { mode: 0o700 });
  try { fs.symlinkSync(outside, path.join(instance, "browser-profile", "Preferences")); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) return t.skip("symlinks unavailable"); throw error; }
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.ok(result.missing_verification_gates.includes("safe_instance_tree"));
});

test("Chromium browser-profile names with ASCII spaces remain safe tree evidence", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "spaced");
  fs.mkdirSync(path.join(instance, "Local Storage", "leveldb"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(instance, "Session Storage"), { mode: 0o700 });
  fs.mkdirSync(path.join(instance, "Code Cache"), { mode: 0o700 });
  fs.writeFileSync(path.join(instance, "Local Storage", "leveldb", "000003.log"), "x", { mode: 0o600 });
  fs.chmodSync(path.join(instance, "Local Storage", "leveldb", "000003.log"), 0o600);
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "NEEDS_VERIFICATION");
  assert.equal(result.missing_verification_gates.includes("safe_instance_tree"), false);
});

test("control-character browser-profile names fail closed", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "control-name");
  fs.mkdirSync(instance, { mode: 0o700 });
  fs.mkdirSync(path.join(instance, "Local\nStorage"), { mode: 0o700 });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.ok(result.missing_verification_gates.includes("safe_instance_tree"));
});

test("private dot-named native-helper lock remains safe instance evidence", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "locked");
  fs.mkdirSync(instance, { mode: 0o700 });
  const lock = path.join(instance, ".macos-native-helper-install.lock");
  fs.writeFileSync(lock, "{}", { mode: 0o600 });
  fs.chmodSync(lock, 0o600);
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "NEEDS_VERIFICATION");
  assert.deepEqual(result.instances[0].missing_verification_gates.includes("safe_instance_tree"), false);
});

test("private hidden instance descendants remain safe tree evidence", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "hidden-descendants");
  fs.mkdirSync(path.join(instance, ".git", "objects"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(instance, ".orchestrator-sandbox", "state"), { recursive: true, mode: 0o700 });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "NEEDS_VERIFICATION");
  assert.equal(result.missing_verification_gates.includes("safe_instance_tree"), false);
});

test("symlinked hidden instance descendant fails closed", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "hidden-symlink");
  const outside = path.join(f.home, "outside-hidden");
  fs.mkdirSync(instance, { mode: 0o700 });
  fs.mkdirSync(outside, { mode: 0o700 });
  try { fs.symlinkSync(outside, path.join(instance, ".git")); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) return t.skip("symlinks unavailable"); throw error; }
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.ok(result.missing_verification_gates.includes("safe_instance_tree"));
});

test("duplicate active and inactive route identifiers fail closed", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "duplicate-route");
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "chat-routes.json"), {
    routes: [
      { route: "chat-duplicate", project: "sandbox-duplicate", status: "active", installation_id: "install-duplicate" },
      { route: "chat-duplicate", project: "sandbox-duplicate", status: "inactive", installation_id: "install-duplicate" }
    ]
  });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.ok(result.missing_verification_gates.includes("unique_route_identifiers"));
});

test("missing route and migration evidence never becomes an admissible recovery", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "evidence");
  fs.mkdirSync(path.join(instance, "browser-profile", "nested"), { recursive: true, mode: 0o700 });
  writeJson(path.join(instance, "instance.json"), {
    instance_id: "evidence",
    installation_id: "install-evidence",
    control_repository: "org/control-evidence",
    sandbox_repository: "org/sandbox-evidence"
  });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "NEEDS_VERIFICATION");
  assert.ok(result.missing_verification_gates.includes("chat_routes_metadata"));
  assert.ok(result.missing_verification_gates.includes("migration_snapshot_metadata"));
  assert.ok(result.missing_verification_gates.includes("registered_route_evidence"));
});

test("migration snapshots with contradictory Control or Sandbox roles fail closed", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "roles");
  const snapshot = path.join(instance, "control-routing-migration-install-roles");
  fs.mkdirSync(snapshot, { recursive: true, mode: 0o700 });
  writeJson(path.join(instance, "instance.json"), { instance_id: "roles", installation_id: "install-roles", control_repository: "org/control-a", sandbox_repository: "org/sandbox-a" });
  writeJson(path.join(instance, "chat-routes.json"), { routes: [{ route: "chat-roles", project: "sandbox-roles", status: "active", installation_id: "install-roles" }] });
  writeJson(path.join(snapshot, "instance.json"), { instance_id: "roles", installation_id: "install-roles", control_repository: "org/control-b", sandbox_repository: "org/sandbox-a" });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.ok(result.missing_verification_gates.includes("matching_instance_identifier"));
});

test("distinct control and sandbox repositories are accepted when each role is consistent", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "expected");
  const snapshot = path.join(instance, "control-routing-migration-install-a");
  fs.mkdirSync(snapshot, { recursive: true, mode: 0o700 });
  const identity = { instance_id: "expected", installation_id: "install-a", control_repository: "org/control-a", sandbox_repository: "org/sandbox-a" };
  writeJson(path.join(instance, "instance.json"), identity);
  writeJson(path.join(snapshot, "instance.json"), identity);
  writeJson(path.join(instance, "chat-routes.json"), { ...identity, routes: [{ route: "chat-expected", project: "sandbox-expected", status: "active", ...identity }] });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "NEEDS_VERIFICATION");
  assert.deepEqual(result.missing_verification_gates, []);
  assert.deepEqual(result.instances[0].route_bindings, [{
    route: "chat-expected",
    status: "active",
    project: "sandbox-expected",
    instance_id: "expected",
    installation_id: "install-a",
    control_repository: "org/control-a",
    sandbox_repository: "org/sandbox-a"
  }]);
});

test("same-role repository contradictions fail closed", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "expected");
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "instance.json"), { instance_id: "expected", installation_id: "install-a", control_repository: "org/control-a", sandbox_repository: "org/sandbox-a" });
  writeJson(path.join(instance, "chat-routes.json"), { instance_id: "expected", installation_id: "install-a", control_repository: "org/control-b", sandbox_repository: "org/sandbox-a", routes: [] });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.ok(result.missing_verification_gates.includes("matching_instance_identifier"));
});

test("route Control or Sandbox role mismatch fails closed", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "route-roles");
  const snapshot = path.join(instance, "control-routing-migration-install-route-roles");
  const identity = { instance_id: "route-roles", installation_id: "install-route-roles", control_repository: "org/control-a", sandbox_repository: "org/sandbox-a" };
  fs.mkdirSync(snapshot, { recursive: true, mode: 0o700 });
  writeJson(path.join(instance, "instance.json"), identity);
  writeJson(path.join(snapshot, "instance.json"), identity);
  writeJson(path.join(instance, "chat-routes.json"), { ...identity, routes: [{ route: "chat-route-roles", project: "sandbox-route-roles", status: "active", ...identity, sandbox_repository: "org/sandbox-b" }] });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.ok(result.missing_verification_gates.includes("matching_route_identity"));
});

test("recovery-preflight is an exposed read-only CLI command", t => {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "codex-cli-home-"));
  fs.chmodSync(home, 0o700);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "src/cli.mjs"), "recovery-preflight", "--json"], { encoding: "utf8", env: { ...process.env, HOME: home, CHATGPT_CODEX_ORCHESTRATOR_HOME: path.join(home, "codex-no-write-state") } });
  assert.match(result.stdout, /existing_instance_recovery|UNSUPPORTED/);
  assert.doesNotMatch(result.stdout, /chatgpt\.com\/c\//);
});

test("Darwin dry-run explicitly refuses unbound existing-instance evidence", { skip: process.platform !== "darwin" }, t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "dry-run-unbound");
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "chat-routes.json"), { routes: [{ route: "chat-dry-run", project: "sandbox-dry-run", status: "active" }] });
  const stateRoot = path.join(f.home, "dry-run-state");
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "src/cli.mjs"), "dry-run", "--json"], { encoding: "utf8", env: { ...process.env, HOME: f.home, CHATGPT_CODEX_ORCHESTRATOR_HOME: stateRoot } });
  const payload = JSON.parse(result.stdout);
  assert.ok(["NEEDS_USER_ACTION", "ERROR"].includes(payload.status));
  assert.equal(payload.error_id, "MACOS-EXISTING-INSTANCE-REVIEW");
  assert.equal(payload.mutations_performed, false);
  assert.deepEqual(payload.plan, []);
});

test("Darwin setup and resume stop before installer state or external commands for an unbound instance", { skip: process.platform !== "darwin" }, t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "1832f0bb");
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "chat-routes.json"), { routes: [{ route: "chat-333", chat_url: "https://chatgpt.com/c/redacted" }] });
  const sentinels = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "codex-command-sentinels-"));
  t.after(() => fs.rmSync(sentinels, { recursive: true, force: true }));
  const marker = path.join(sentinels, "invoked");
  for (const command of ["git", "node", "gh", "codex"]) {
    const file = path.join(sentinels, command);
    fs.writeFileSync(file, `#!/bin/sh\nprintf invoked > ${marker}\nexit 0\n`, { mode: 0o700 });
    fs.chmodSync(file, 0o700);
  }
  for (const action of ["setup", "resume"]) {
    const result = spawnSync(process.execPath, [path.join(process.cwd(), "src/cli.mjs"), action, "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: f.home, PATH: sentinels, CHATGPT_CODEX_ORCHESTRATOR_HOME: path.join(f.home, "dev-state") }
    });
    assert.match(result.stdout, /MACOS-EXISTING-INSTANCE-REVIEW/);
    assert.match(result.stdout, /mutations_performed/);
    assert.equal(fs.existsSync(path.join(f.home, "dev-state", "install-state.json")), false);
    assert.equal(fs.existsSync(marker), false);
  }
});

test("Darwin setup rejects a fully populated state bound to another existing instance before prerequisites", { skip: process.platform !== "darwin" }, t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "1832f0bb");
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "chat-routes.json"), { routes: [{ route: "chat-333" }] });
  const stateRoot = path.join(f.home, "dev-state");
  const state = { schema_version: 1, preferred_language: "en", installation_id: "another-installation", instance_id: "another", instance_root: path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "another") };
  writeJson(path.join(stateRoot, "install-state.json"), state);
  const before = fs.readFileSync(path.join(stateRoot, "install-state.json"), "utf8");
  const sentinels = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "codex-command-sentinels-"));
  const marker = path.join(sentinels, "invoked");
  t.after(() => fs.rmSync(sentinels, { recursive: true, force: true }));
  for (const command of ["git", "node", "gh", "codex"]) {
    const file = path.join(sentinels, command);
    fs.writeFileSync(file, `#!/bin/sh\nprintf invoked > ${marker}\nexit 0\n`, { mode: 0o700 });
    fs.chmodSync(file, 0o700);
  }
  for (const action of ["setup", "resume"]) {
    const result = spawnSync(process.execPath, [path.join(process.cwd(), "src/cli.mjs"), action, "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: f.home, PATH: sentinels, CHATGPT_CODEX_ORCHESTRATOR_HOME: stateRoot }
    });
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error_id, "MACOS-EXISTING-INSTANCE-REVIEW");
    assert.equal(payload.mutations_performed, false);
    assert.equal(fs.readFileSync(path.join(stateRoot, "install-state.json"), "utf8"), before);
    assert.equal(fs.existsSync(marker), false);
  }
});

test("Darwin dry-run rejects the requested inactive route even when another route is active", { skip: process.platform !== "darwin" }, t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "route-state");
  const identity = { instance_id: "route-state", installation_id: "install-route-state", control_repository: "owner/control", sandbox_repository: "owner/sandbox" };
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "instance.json"), identity);
  writeJson(path.join(instance, "chat-routes.json"), {
    ...identity,
    routes: [
      { route: "chat-active", project: "sandbox-route-state", status: "active", installation_id: identity.installation_id },
      { route: "chat-inactive", project: "sandbox-route-state", status: "inactive", installation_id: identity.installation_id }
    ]
  });
  const stateRoot = path.join(f.home, "dev-state");
  writeJson(path.join(stateRoot, "install-state.json"), {
    installation_id: identity.installation_id,
    instance_id: identity.instance_id,
    instance_root: instance,
    control_repository: identity.control_repository,
    sandbox_repository: identity.sandbox_repository,
    sandbox_project_key: "sandbox-route-state",
    sandbox_review_route: "chat-inactive"
  });
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "src/cli.mjs"), "dry-run", "--json"], {
    encoding: "utf8",
    env: { ...process.env, HOME: f.home, CHATGPT_CODEX_ORCHESTRATOR_HOME: stateRoot }
  });
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error_id, "MACOS-EXISTING-INSTANCE-REVIEW");
  assert.equal(payload.mutations_performed, false);
  assert.deepEqual(payload.plan, []);
});

function selectedFixture(t) {
  const f = fixture(t);
  const installationId = "fresh-install-20261022";
  const id = canonicalInstallationId(installationId);
  const instance = path.join(f.instances, id);
  const control = defaultLocalPaths({ home: f.home, installationId, projectKey: `sandbox-${id}` }).control;
  fs.mkdirSync(instance, { mode: 0o700 });
  const state = {
    selected_fresh_instance: true, macos_setup_approved: true,
    installation_id: installationId, instance_id: id, instance_root: instance,
    control_clone_path: control, chat_route_file: path.join(instance, "chat-routes.json"),
    github_login: "synthetic-owner", control_repository: `synthetic-owner/chatgpt-codex-orchestrator-control-${id}`,
    sandbox_repository: `synthetic-owner/chatgpt-codex-orchestrator-sandbox-${id}`,
    sandbox_project_key: `sandbox-${id}`, reviewer_chat_url: "https://chatgpt.com/c/synthetic-first-boot",
    control_environment_ready: true, target_environment_ready: false, sandbox_only: true,
    github_plugin_authorized: true, github_plugin_authorization_verified: true, generated_repo_authorized: true
  };
  Object.assign(state, {
    github_plugin_authorization_installation_id: installationId,
    github_plugin_authorization_control_repository: state.control_repository,
    github_plugin_authorization_sandbox_repository: state.sandbox_repository,
    github_plugin_authorization_chat_url: state.reviewer_chat_url
  });
  const identity = Object.fromEntries(["instance_id", "installation_id", "control_repository", "sandbox_repository"].map(key => [key, state[key]]));
  writeJson(path.join(control, "instance.json"), { schema_version: 1, ...identity, role: "control", platform: "darwin", arch: "arm64" });
  writeJson(path.join(instance, "migration-intent.json"), { schema_version: 1, phase: "PREPARED", installation_id: installationId, generated_repositories: { control: state.control_repository, sandbox: state.sandbox_repository }, destination: { path: instance } });
  writeJson(state.chat_route_file, { ...identity, routes: [] });
  const calls = [];
  const repositories = new Map(["control", "sandbox"].map((role, index) => [state[`${role}_repository`], {
    id: index === 0 ? 101 : 202, name: state[`${role}_repository`].split("/")[1],
    full_name: state[`${role}_repository`], private: true, visibility: "private", owner: { login: state.github_login, id: 303 },
    description: `ChatGPT Codex Orchestrator ${role} installation ${installationId}`
  }]));
  const githubApi = {
    getAuthenticatedUser: () => { calls.push("user"); return { login: state.github_login, id: 303 }; },
    getRepository: name => { calls.push(name); return repositories.get(name); }
  };
  return { ...f, instance, control, state, identity, calls, repositories, githubApi };
}

const inspectSelected = f => inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi });
const approveSelected = (f, approval = inspectSelected(f).approval_challenge) => approveMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, approval, now: () => new Date("2026-10-22T00:00:00.000Z") });

test("explicit selected fresh approval leaves unsafe historical bytes and modes untouched", t => {
  const f = selectedFixture(t);
  const legacy = path.join(f.instances, "1832f0bb");
  fs.mkdirSync(legacy, { mode: 0o755 });
  const old = path.join(legacy, "legacy.json");
  fs.writeFileSync(old, "historical #404 #405 #406 and closed #409\n", { mode: 0o644 });
  const before = fs.readFileSync(old);
  const oldMode = fs.statSync(old).mode;
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
  const preview = inspectSelected(f);
  assert.equal(preview.status, "NEEDS_USER_ACTION");
  assert.equal(preview.fresh_approval_eligible, true);
  assert.equal(fs.existsSync(preview.approval_path), false);
  assert.throws(() => approveSelected(f, "true"), /exact selected-fresh-instance approval/);
  const result = approveSelected(f);
  assert.equal(result.status, "SELECTED_FRESH_INSTANCE_VERIFIED");
  assert.equal(fs.statSync(result.approval_path).mode & 0o777, 0o600);
  const receipt = fs.readFileSync(result.approval_path);
  assert.equal(approveSelected(f).idempotent, true);
  assert.deepEqual(fs.readFileSync(result.approval_path), receipt);
  assert.deepEqual(fs.readFileSync(old), before);
  assert.equal(fs.statSync(old).mode, oldMode);
  assert.deepEqual(fs.readdirSync(legacy), ["legacy.json"]);
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
});

test("selected mode requires exact separate durable approval and rejects a bogus receipt", t => {
  const f = selectedFixture(t);
  f.state.selected_fresh_instance = false;
  assert.deepEqual(inspectSelected(f).missing_verification_gates, ["explicit_selected_fresh_instance"]);
  assert.equal(f.calls.length, 0);
  f.state.selected_fresh_instance = true;
  const preview = inspectSelected(f);
  writeJson(preview.approval_path, { schema_version: 1, kind: "SELECTED_FRESH_INSTANCE_HUMAN_APPROVAL", approval: preview.approval_challenge, status: "VERIFIED" });
  const before = fs.readFileSync(preview.approval_path);
  assert.equal(inspectSelected(f).status, "CONFLICT");
  assert.throws(() => approveSelected(f, preview.approval_challenge));
  assert.deepEqual(fs.readFileSync(preview.approval_path), before);
});

test("selected mode rejects missing or changed immutable GitHub trust domains and users", t => {
  for (const mutate of [
    f => { f.githubApi.getAuthenticatedUser = undefined; },
    f => { f.githubApi.getAuthenticatedUser = () => ({ login: "foreign", id: 303 }); },
    f => { delete f.repositories.get(f.state.control_repository).id; },
    f => { f.repositories.get(f.state.sandbox_repository).id = 101; },
    f => { f.repositories.get(f.state.control_repository).owner.id = 404; },
    f => { f.repositories.get(f.state.control_repository).private = false; f.repositories.get(f.state.control_repository).visibility = "public"; },
    f => { f.repositories.get(f.state.control_repository).description = "unrelated installation"; },
    f => { f.state.control_repository_id = "999"; },
    f => { f.state.github_plugin_authorization_chat_url = "https://chatgpt.com/c/foreign"; }
  ]) {
    const f = selectedFixture(t);
    mutate(f);
    assert.deepEqual(inspectSelected(f).missing_verification_gates, ["independent_generated_repository_identity"]);
    assert.equal(fs.existsSync(path.join(f.instance, "selected-fresh-instance-approval-v1.json")), false);
  }
});

test("selected approval pins repository IDs across resume instead of trusting a receipt label", t => {
  const f = selectedFixture(t);
  const approved = approveSelected(f);
  const before = fs.readFileSync(approved.approval_path);
  f.repositories.get(f.state.control_repository).id = 999;
  assert.deepEqual(inspectSelected(f).missing_verification_gates, ["selected_approval_identity"]);
  assert.deepEqual(fs.readFileSync(approved.approval_path), before);
});

test("selected mode rejects unsafe ancestors, instance permissions, links, and mismatched identities", t => {
  for (const kind of ["ancestor", "directory-mode", "symlink", "hardlink", "identity", "route-identity", "missing-intent", "missing-routes", "wrong-os", "wrong-arch", "origin", "repository-id"]) {
    const f = selectedFixture(t);
    if (kind === "ancestor") fs.chmodSync(path.join(f.home, ".chatgpt-codex-orchestrator"), 0o777);
    if (kind === "directory-mode") fs.chmodSync(f.instance, 0o755);
    if (kind === "identity") writeJson(path.join(f.instance, "instance.json"), { ...f.identity, installation_id: "foreign-installation" });
    if (kind === "route-identity") writeJson(f.state.chat_route_file, { ...f.identity, control_repository: "foreign/control", routes: [] });
    if (kind === "missing-intent") fs.rmSync(path.join(f.instance, "migration-intent.json"));
    if (kind === "missing-routes") fs.rmSync(f.state.chat_route_file);
    if (kind === "origin") writeJson(path.join(f.control, "instance.json"), { schema_version: 1, ...f.identity, role: "control", platform: "darwin", arch: "arm64", origin: `https://github.com/foreign/${f.state.control_repository}.git` });
    if (kind === "repository-id") writeJson(path.join(f.control, "instance.json"), { schema_version: 1, ...f.identity, role: "control", platform: "darwin", arch: "arm64", control_repository_id: 999 });
    if (kind === "wrong-os" || kind === "wrong-arch") writeJson(path.join(f.control, "instance.json"), { ...f.identity, role: "control", platform: kind === "wrong-os" ? "win32" : "darwin", arch: kind === "wrong-arch" ? "x64" : "arm64" });
    if (kind === "symlink") {
      const file = path.join(f.instance, "migration-intent.json");
      const outside = path.join(f.home, "outside.json");
      fs.renameSync(file, outside);
      fs.symlinkSync(outside, file);
    }
    if (kind === "hardlink") fs.linkSync(path.join(f.instance, "migration-intent.json"), path.join(f.home, "hardlinked-intent.json"));
    assert.equal(inspectSelected(f).status, "CONFLICT", kind);
  }
});

test("selected mode rejects historical identity and alias collisions without modifying either root", t => {
  for (const kind of ["installation", "repository-name", "repository-id", "alias"]) {
    const f = selectedFixture(t);
    const historical = path.join(f.instances, "1832f0bb");
    if (kind === "alias") fs.symlinkSync(f.instance, historical);
    else {
      fs.mkdirSync(historical, { mode: 0o700 });
      writeJson(path.join(historical, "instance.json"), kind === "installation" ? { installation_id: f.state.installation_id } : kind === "repository-name" ? { sandbox_repository: f.state.control_repository } : kind === "repository-id" ? { control_repository_id: 202 } : {});
    }
    assert.equal(inspectSelected(f).status, "CONFLICT", kind);
    assert.equal(fs.existsSync(path.join(f.instance, "selected-fresh-instance-approval-v1.json")), false);
  }
});

test("selected mode rejects case-folded instance-name collisions on every filesystem", t => {
  const f = selectedFixture(t);
  const fsImpl = { ...fs, readdirSync: (file, options) => file === f.instances && options === undefined ? [f.state.instance_id, f.state.instance_id.toUpperCase()] : fs.readdirSync(file, options) };
  const result = inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl });
  assert.deepEqual(result.missing_verification_gates, ["colliding_instance_name"]);
});

test("an already populated route registry cannot acquire fresh-instance approval", t => {
  const f = selectedFixture(t);
  writeJson(f.state.chat_route_file, { ...f.identity, routes: [{ route: "chat-existing", project: f.state.sandbox_project_key, status: "active", ...f.identity }] });
  const report = inspectSelected(f);
  assert.equal(report.status, "NEEDS_USER_ACTION");
  assert.equal(report.fresh_approval_eligible, false);
  assert.throws(() => approveSelected(f, report.approval_challenge), /unused fresh instance/);
});

test("approved selected instance can resume after first registration without making that route its authority", t => {
  const f = selectedFixture(t);
  const result = approveSelected(f);
  const before = fs.readFileSync(result.approval_path);
  writeJson(f.state.chat_route_file, { ...f.identity, routes: [{ route: "chat-new", project: f.state.sandbox_project_key, status: "active", ...f.identity }] });
  assert.equal(inspectSelected(f).status, "SELECTED_FRESH_INSTANCE_VERIFIED");
  assert.deepEqual(fs.readFileSync(result.approval_path), before);
});

test("selected instance ownership is current-user authority rather than root or a foreign uid", t => {
  if (typeof process.getuid !== "function") return t.skip("uid ownership is unavailable");
  const f = selectedFixture(t);
  const fsImpl = { ...fs, lstatSync: file => {
    const stat = fs.lstatSync(file);
    if (file === f.instance) Object.defineProperty(stat, "uid", { value: process.getuid() + 1 });
    return stat;
  } };
  const result = inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl });
  assert.deepEqual(result.missing_verification_gates, ["private_owned_selected_instance"]);
  assert.equal(f.calls.length, 0);
});

test("selected-only passive Runner work accepts owned checkout modes and still refuses hardlinks", t => {
  const f = selectedFixture(t);
  approveSelected(f);
  fs.mkdirSync(path.join(f.instance, "runner"), { mode: 0o700 });
  fs.mkdirSync(path.join(f.instance, "runner", "_work"), { mode: 0o755 });
  const checkout = path.join(f.instance, "runner", "_work", "README.md");
  fs.writeFileSync(checkout, "synthetic checked-out bytes\n", { mode: 0o644 });
  assert.equal(inspectSelected(f).status, "SELECTED_FRESH_INSTANCE_VERIFIED");
  // The global legacy scan retains its stricter existing policy.
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
  fs.linkSync(checkout, path.join(f.home, "outside-checkout-hardlink"));
  assert.deepEqual(inspectSelected(f).missing_verification_gates, ["safe_selected_instance_tree"]);
});

