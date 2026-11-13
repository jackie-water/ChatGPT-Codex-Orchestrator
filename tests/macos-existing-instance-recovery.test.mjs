import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { inspectMacosExistingInstanceRecovery, inspectMacosSelectedFreshInstance, approveMacosSelectedFreshInstance, isMacosFreshFirstInstallBootstrap } from "../src/lib/macos-existing-instance-recovery.mjs";
import { canonicalInstallationId, defaultLocalPaths } from "../src/lib/control-render.mjs";
import { MACOS_RUNNER_RUNTIME_PATH } from "../src/lib/macos-runner-bootstrap.mjs";

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

test("fresh-first-install bootstrap is limited to one untrusted historical instance and missing journal", () => {
  const recovery = { status: "NEEDS_VERIFICATION", instance_ids: ["1832f0bb"], instances: [{ instance_id: "1832f0bb", status: "NEEDS_VERIFICATION", identity: { instance_id: "1832f0bb", installation_id: "old-install" } }] };
  assert.equal(isMacosFreshFirstInstallBootstrap({ state: {}, recovery, installStateMissing: true }), true);
  assert.equal(isMacosFreshFirstInstallBootstrap({ state: { installation_id: "new" }, recovery, installStateMissing: true }), false);
  assert.equal(isMacosFreshFirstInstallBootstrap({ state: {}, recovery: { ...recovery, instances: [recovery.instances[0], recovery.instances[0]] }, installStateMissing: true }), false);
  assert.equal(isMacosFreshFirstInstallBootstrap({ state: {}, recovery, installStateMissing: false }), false);
});

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

test("three instance roots remain a conflict and preserve every root", t => {
  const f = fixture(t);
  for (const id of ["first", "second", "third"]) fs.mkdirSync(path.join(f.instances, id), { mode: 0o700 });
  const before = fs.readdirSync(f.instances).sort();
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.deepEqual(result.instance_ids, before);
  assert.deepEqual(fs.readdirSync(f.instances).sort(), before);
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

test("selected runtime browser-profile singleton links are opaque live-session leaves only", t => {
  const f = selectedFixture(t);
  const profile = path.join(f.instance, "browser-profile");
  fs.mkdirSync(path.join(profile, "Default", "Local Storage"), { recursive: true, mode: 0o700 });
  const targets = {
    SingletonLock: "synthetic-mac-4242",
    SingletonSocket: path.join(f.home, "synthetic-chromium-runtime", "SingletonSocket"),
    SingletonCookie: "13751948561234567890"
  };
  const singletonPaths = new Set(Object.keys(targets).map(name => path.join(profile, name)));
  const targetPaths = Object.values(targets).map(target => path.resolve(profile, target));
  for (const [name, target] of Object.entries(targets)) fs.symlinkSync(target, path.join(profile, name));
  assert.equal(inspectSelected(f).status, "NEEDS_USER_ACTION");
  approveSelected(f);
  const forbiddenAccesses = [];
  const fsImpl = { ...fs };
  for (const operation of ["lstatSync", "statSync", "realpathSync", "readlinkSync", "readFileSync", "readdirSync", "openSync"]) {
    fsImpl[operation] = (file, ...args) => {
      if (typeof file === "string" && ((operation !== "lstatSync" && singletonPaths.has(file)) || targetPaths.some(target => file === target || file.startsWith(`${target}${path.sep}`)))) {
        forbiddenAccesses.push({ operation, file });
        throw new Error("singleton links and targets must remain opaque");
      }
      return fs[operation](file, ...args);
    };
  }
  const result = inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl });
  assert.equal(result.status, "SELECTED_FRESH_INSTANCE_VERIFIED");
  assert.deepEqual(forbiddenAccesses, []);
  // The historical/global inspection does not acquire this selected-only policy.
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
});

test("selected runtime browser-profile policy rejects arbitrary nested escape and identity symlink aliases", t => {
  for (const relative of [
    "browser-profile/Preferences",
    "browser-profile/Default/SingletonLock",
    "browser-profile/SingletonSocket/nested",
    "browser-profile/escape",
    "browser-profile",
    "instance.json",
    "chat-routes.json",
    "migration-intent.json",
    "selected-fresh-instance-approval-v1.json",
    "runner/SingletonSocket",
    "SingletonCookie"
  ]) {
    const f = selectedFixture(t);
    approveSelected(f);
    const alias = path.join(f.instance, relative);
    fs.mkdirSync(path.dirname(alias), { recursive: true, mode: 0o700 });
    if (fs.existsSync(alias)) fs.rmSync(alias, { recursive: true });
    // The path-escape target and proof aliases confer no authority, even when
    // a legitimate live-session singleton has also been created beside them.
    fs.symlinkSync(relative === "browser-profile/escape" ? "../../../outside-profile" : path.join(f.control, "instance.json"), alias);
    if (relative !== "browser-profile") {
      const profile = path.join(f.instance, "browser-profile");
      fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
      fs.symlinkSync("synthetic-mac-4242", path.join(profile, "SingletonLock"));
    }
    assert.deepEqual(inspectSelected(f).missing_verification_gates, ["safe_selected_instance_tree"], relative);
  }
});

test("selected runtime browser-profile singleton links require current ownership and a single link", t => {
  const f = selectedFixture(t);
  const profile = path.join(f.instance, "browser-profile");
  fs.mkdirSync(profile, { mode: 0o700 });
  const singleton = path.join(profile, "SingletonLock");
  fs.symlinkSync("synthetic-mac-4242", singleton);
  for (const kind of ["owner", "hardlinked-symlink"]) {
    if (kind === "owner" && typeof process.getuid !== "function") continue;
    const fsImpl = { ...fs, lstatSync: file => {
      const stat = fs.lstatSync(file);
      if (file === singleton) Object.defineProperty(stat, kind === "owner" ? "uid" : "nlink", { value: kind === "owner" ? process.getuid() + 1 : 2 });
      return stat;
    } };
    const result = inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl });
    assert.deepEqual(result.missing_verification_gates, ["safe_selected_instance_tree"], kind);
  }
  fs.unlinkSync(singleton);
  fs.writeFileSync(singleton, "not a live Chromium link", { mode: 0o600 });
  fs.linkSync(singleton, path.join(f.home, "hardlinked-singleton"));
  assert.deepEqual(inspectSelected(f).missing_verification_gates, ["safe_selected_instance_tree"]);
});

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

test("selected recovery permits only the owned singly linked runner .env at 0400 without chmod", t => {
  const f = selectedFixture(t);
  approveSelected(f);
  fs.mkdirSync(path.join(f.instance, "runner"), { mode: 0o700 });
  const file = path.join(f.instance, "runner", ".env");
  fs.writeFileSync(file, "LANG=C\nLC_ALL=C\n", { mode: 0o400 });
  const before = fs.lstatSync(file), bytes = fs.readFileSync(file);
  const fsImpl = { ...fs, chmodSync: () => { throw new Error("selected recovery must never chmod .env"); } };
  const report = inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl });
  assert.equal(report.status, "SELECTED_FRESH_INSTANCE_VERIFIED");
  assert.equal(fs.lstatSync(file).mode, before.mode);
  assert.equal(fs.lstatSync(file).ino, before.ino);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
});

test("selected recovery .env 0400 exception rejects aliases ownership and every unrelated private path", t => {
  for (const kind of ["symlink", "hardlink", "foreign-owner", "directory", "readonly-mode", "executable-mode", "special-mode", "root-env", "nested-env", "runner-config", "credentials", "other-file"]) {
    if (kind === "foreign-owner" && typeof process.getuid !== "function") continue;
    const f = selectedFixture(t);
    approveSelected(f);
    const relative = kind === "root-env" ? ".env" : kind === "nested-env" ? "runner/nested/.env" : kind === "runner-config" ? "runner/.runner" : kind === "credentials" ? "runner/.credentials" : kind === "other-file" ? "runner/other" : "runner/.env";
    const file = path.join(f.instance, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (kind === "directory") fs.mkdirSync(file, { mode: 0o400 });
    else if (kind === "symlink") {
      const target = path.join(f.home, "outside-env");
      fs.writeFileSync(target, "LANG=C\n", { mode: 0o400 });
      fs.symlinkSync(target, file);
    } else {
      fs.writeFileSync(file, "LANG=C\n", { mode: 0o600 });
      fs.chmodSync(file, kind === "readonly-mode" ? 0o444 : kind === "executable-mode" ? 0o500 : kind === "special-mode" ? 0o4400 : 0o400);
      if (kind === "hardlink") fs.linkSync(file, path.join(f.home, "hardlinked-env"));
    }
    const fsImpl = { ...fs, lstatSync: target => {
      const stat = fs.lstatSync(target);
      if (kind === "foreign-owner" && target === file) Object.defineProperty(stat, "uid", { value: process.getuid() + 1 });
      return stat;
    } };
    const report = inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl });
    assert.deepEqual(report.missing_verification_gates, ["safe_selected_instance_tree"], kind);
    if (kind === "directory") fs.chmodSync(file, 0o700);
  }
});

const packageHash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function selectedPackageArchive(entries) {
  const chunks = [];
  for (const { name, bytes = Buffer.alloc(0), mode = 0o700, type = "0", link = "" } of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write(mode.toString(8).padStart(7, "0") + "\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header[156] = type.charCodeAt(0);
    header.write(link, 157, 100);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

function selectedPackageFixture(t, { extraDependencies = 0, candidateOnly = false } = {}) {
  const f = selectedFixture(t);
  approveSelected(f);
  const runner = path.join(f.instance, "runner"), executable = path.join(runner, "bin", "Runner.Listener");
  Object.assign(f.state, {
    runner_path: runner, runner_owner: f.state.installation_id,
    runner_label: `codex-orchestrator-${f.state.instance_id}`, launch_agent_label: `com.chatgpt.codex.${f.state.instance_id}`,
    control_repository_id: "101", sandbox_repository_id: "202",
    browser_profile: path.join(f.instance, "browser-profile"), browser_port: 13333, pending_wake_outbox: path.join(f.instance, "pending-wakes")
  });
  const native = Buffer.alloc(32);
  native.writeUInt32LE(0xfeedfacf, 0);
  native.writeUInt32LE(0x0100000c, 4);
  native.writeUInt32LE(2, 12);
  const template = Buffer.from('#!/bin/bash\nSVC_NAME="{{SvcNameVar}}"\nSVC_DESCRIPTION="{{SvcDescription}}"\n# Synthetic official service template; never executed.\n');
  const entries = [
    { name: "bin/Runner.Listener", bytes: native },
    { name: "bin/Runner.Worker", bytes: native },
    { name: "bin/darwin.svc.sh.template", bytes: template, mode: 0o600 },
    { name: "run.sh", bytes: Buffer.from("#!/bin/sh\n# Synthetic official runner script; never executed.\n") }
  ];
  for (const runtime of ["node20", "node24"]) {
    const base = `externals/${runtime}`;
    entries.push(
      { name: `${base}/bin/node`, bytes: native },
      { name: `${base}/lib/node_modules/npm/bin/npm-cli.js`, bytes: Buffer.from("// synthetic npm CLI\n"), mode: 0o600 },
      { name: `${base}/lib/node_modules/npm/bin/npx-cli.js`, bytes: Buffer.from("// synthetic npx CLI\n"), mode: 0o600 },
      { name: `${base}/lib/node_modules/corepack/dist/corepack.js`, bytes: Buffer.from("// synthetic corepack CLI\n"), mode: 0o600 },
      { name: `${base}/lib/node_modules/npm/node_modules/@npmcli/fs/lib/index.js`, bytes: Buffer.from("// synthetic scoped package\n"), mode: 0o600 },
      { name: `${base}/lib/node_modules/npm/node_modules/package+variant/index.js`, bytes: Buffer.from("// synthetic package variant\n"), mode: 0o600 },
      { name: `${base}/bin/npm`, type: "2", link: "../lib/node_modules/npm/bin/npm-cli.js", mode: 0o777 },
      { name: `${base}/bin/npx`, type: "2", link: "../lib/node_modules/npm/bin/npx-cli.js", mode: 0o777 },
      { name: `${base}/bin/corepack`, type: "2", link: "../lib/node_modules/corepack/dist/corepack.js", mode: 0o777 }
    );
  }
  for (let index = 0; index < extraDependencies; index++) entries.push({ name: `externals/node24/lib/node_modules/npm/node_modules/@npmcli/fs/data-${index}.js`, bytes: Buffer.from(`// dependency ${index}\n`), mode: 0o600 });
  for (const entry of entries) {
    const file = path.join(runner, entry.name);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (entry.type === "2") {
      fs.symlinkSync(entry.link, file);
      if (typeof fs.lchmodSync === "function") fs.lchmodSync(file, entry.mode);
    } else fs.writeFileSync(file, entry.bytes, { mode: entry.mode ?? 0o700 });
  }
  const repository = f.state.control_repository.replace(/[^0-9a-zA-Z._-]/g, "-");
  const service = Buffer.from(template.toString("utf8").replaceAll("{{SvcDescription}}", `GitHub Actions Runner (${repository}.${f.state.runner_label})`).replaceAll("{{SvcNameVar}}", `actions.runner.${repository}.${f.state.runner_label}`));
  fs.writeFileSync(path.join(runner, "svc.sh"), service, { mode: 0o755 });
  const archive = selectedPackageArchive(entries), archivePath = path.join(f.instance, "runner-package.tar.gz");
  fs.writeFileSync(archivePath, archive, { mode: 0o600 });
  const approval = {
    schema_version: 1, installation_id: f.state.installation_id, instance_id: f.state.instance_id, instance_path: f.instance,
    project: f.state.sandbox_project_key, control_repository: f.state.control_repository, sandbox_repository: f.state.sandbox_repository,
    control_repository_id: "101", sandbox_repository_id: "202", runner_path: runner, runner_executable: executable,
    runner_label: f.state.runner_label, launch_agent_label: f.state.launch_agent_label, browser_profile: f.state.browser_profile,
    browser_port: f.state.browser_port, pending_wake_outbox: f.state.pending_wake_outbox, runtime_path: MACOS_RUNNER_RUNTIME_PATH,
    source_version: "2.999.0", source_url: "https://github.com/actions/runner/releases/download/v2.999.0/actions-runner-osx-arm64-2.999.0.tar.gz",
    source_release_id: "505", source_asset_id: "606", archive_sha256: packageHash(archive), executable_sha256: packageHash(native),
    binary_manifest: Object.fromEntries(entries.map(entry => [entry.name, packageHash(entry.type === "2" ? Buffer.from(entry.link) : entry.bytes)])),
    env_sha256: null, approved_action: "use-existing-official-macos-arm64-runner", approved_by: f.state.github_login,
    approval_id: "human-synthetic-fixture", approved_at: "2026-10-22T00:00:00.000Z"
  };
  const packageReceipt = path.join(f.instance, candidateOnly ? "macos-runner-candidate.json" : "macos-runner-approval.json");
  writeJson(packageReceipt, approval);
  return { ...f, runner, entries, archivePath, packageReceipt, approval, service };
}

test("selected recovery admits only archive-bound official npm npx corepack links and generated service as inert leaves", t => {
  for (const candidateOnly of [false, true]) {
    const f = selectedPackageFixture(t, { candidateOnly });
    const links = new Set(f.entries.filter(entry => entry.type === "2").map(entry => path.join(f.runner, entry.name)));
    const dereferences = [], fsImpl = { ...fs };
    for (const operation of ["statSync", "realpathSync", "readFileSync", "openSync", "readdirSync"]) {
      fsImpl[operation] = (file, ...args) => {
        if (typeof file === "string" && links.has(file)) {
          dereferences.push({ operation, file });
          throw new Error("archive package links must never be dereferenced");
        }
        if (operation === "openSync") assert.ok(args[0] & fs.constants.O_NOFOLLOW);
        return fs[operation](file, ...args);
      };
    }
    const report = inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl });
    assert.equal(report.status, "SELECTED_FRESH_INSTANCE_VERIFIED");
    assert.deepEqual(dereferences, []);
    assert.equal(fs.lstatSync(path.join(f.runner, "svc.sh")).mode & 0o7777, 0o755);
    assert.deepEqual(fs.readFileSync(path.join(f.runner, "svc.sh")), f.service);
    assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
  }
});

test("selected recovery budgets the separately bounded official package without expanding historical scans", t => {
  const f = selectedPackageFixture(t, { extraDependencies: 4100 });
  assert.equal(inspectSelected(f).status, "SELECTED_FRESH_INSTANCE_VERIFIED");
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
  const fsImpl = { ...fs, readdirSync: (directory, options) => {
    const entries = fs.readdirSync(directory, options);
    return directory === f.instance && options?.withFileTypes === true
      ? [...entries, ...Array.from({ length: 4097 }, (_, index) => ({ name: `unrelated-${index}` }))]
      : entries;
  } };
  assert.deepEqual(inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl }).missing_verification_gates,
    ["safe_selected_instance_tree"], "package inventory must not lend its allowance to unrelated instance data");
});

test("selected recovery rejects unbound package links aliases names and generated executables", t => {
  for (const kind of ["absolute-link", "escape-link", "foreign-identity", "extra-link", "credential-link", "missing-archive", "archive-digest", "manifest-digest", "scoped-name-outside-package", "service-bytes", "service-link", "service-mode", "extra-generated"]) {
    const f = selectedPackageFixture(t), npm = path.join(f.runner, "externals", "node24", "bin", "npm"), service = path.join(f.runner, "svc.sh");
    if (["absolute-link", "escape-link", "foreign-identity"].includes(kind)) {
      fs.unlinkSync(npm);
      fs.symlinkSync(kind === "absolute-link" ? path.join(f.runner, "externals/node24/lib/node_modules/npm/bin/npm-cli.js") : kind === "escape-link" ? "../../../../../outside" : "../../../../instance.json", npm);
    }
    if (kind === "extra-link") fs.symlinkSync("../lib/node_modules/npm/bin/npm-cli.js", path.join(f.runner, "externals/node24/bin/npm-extra"));
    if (kind === "credential-link") fs.symlinkSync(path.join(f.control, "instance.json"), path.join(f.runner, ".credentials"));
    if (kind === "missing-archive") fs.unlinkSync(f.archivePath);
    if (kind === "archive-digest") fs.appendFileSync(f.archivePath, "modified archive");
    if (kind === "manifest-digest") { f.approval.binary_manifest["externals/node24/bin/npm"] = "0".repeat(64); writeJson(f.packageReceipt, f.approval); }
    if (kind === "scoped-name-outside-package") fs.mkdirSync(path.join(f.instance, "@npmcli"), { mode: 0o700 });
    if (kind === "service-bytes") fs.appendFileSync(service, "# forged service\n");
    if (kind === "service-link") { fs.unlinkSync(service); fs.symlinkSync("bin/darwin.svc.sh.template", service); }
    if (kind === "service-mode") fs.chmodSync(service, 0o700);
    if (kind === "extra-generated") fs.writeFileSync(path.join(f.runner, "svc-extra.sh"), f.service, { mode: 0o755 });
    f.calls.length = 0;
    assert.deepEqual(inspectSelected(f).missing_verification_gates, ["safe_selected_instance_tree"], kind);
    assert.deepEqual(f.calls, [], kind);
  }
});

test("selected recovery rechecks link and generated service inode after independent package inspection", t => {
  for (const kind of ["link", "service"]) {
    const f = selectedPackageFixture(t), file = path.join(f.runner, kind === "link" ? "externals/node24/bin/npm" : "svc.sh");
    let replaced = false;
    const fsImpl = { ...fs, readdirSync: (directory, options) => {
      if (!replaced && directory === f.instance && options?.withFileTypes === true) {
        replaced = true;
        fs.renameSync(file, path.join(f.home, "retained-original-package-leaf"));
        if (kind === "link") fs.symlinkSync("../lib/node_modules/npm/bin/npm-cli.js", file);
        else fs.writeFileSync(file, f.service, { mode: 0o755 });
      }
      return fs.readdirSync(directory, options);
    } };
    f.calls.length = 0;
    const report = inspectMacosSelectedFreshInstance({ state: f.state, home: f.home, githubApi: f.githubApi, fsImpl });
    assert.equal(replaced, true, kind);
    assert.deepEqual(report.missing_verification_gates, ["safe_selected_instance_tree"], kind);
    assert.deepEqual(f.calls, [], kind);
  }
});


test("G3 legacy evidence isolation: diagnostics are opaque and preserved", t => {
  const f = fixture(t), root = path.join(f.instances, "1832ffbb".replace("ff", "f0"));
  fs.mkdirSync(path.join(root, "short-turn-evidence", "nested"), { recursive: true, mode: 0o700 });
  const log = path.join(root, "short-turn-evidence", "nested", "worker.log");
  fs.writeFileSync(log, "historic", { mode: 0o644 });
  fs.chmodSync(log, 0o644);
  const executable = path.join(root, "short-turn-evidence", "nested", "process-identity");
  fs.writeFileSync(executable, "old", { mode: 0o700 });
  const before = [log, executable].map(file => ({ bytes: fs.readFileSync(file, "hex"), stat: fs.lstatSync(file) }));
  const state = { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
  const result = inspectMacosExistingInstanceRecovery({ home: f.home, state });
  assert.equal(result.legacy_evidence_isolation.classification, "OPAQUE_PRESERVED_NONAUTHORITY");
  assert.equal(result.status, "CONFLICT");
  assert.equal(isMacosFreshFirstInstallBootstrap({ state, recovery: result }), true);
  [log, executable].forEach((file, index) => { const stat = fs.lstatSync(file); assert.equal(fs.readFileSync(file, "hex"), before[index].bytes); assert.equal(stat.ino, before[index].stat.ino); assert.equal(stat.mode, before[index].stat.mode); });
});

test("G3 legacy evidence isolation: opaque descendants are never accessed", t => {
  const f = fixture(t), root = path.join(f.instances, "1832f0bb"), diag = path.join(root, "short-turn-evidence");
  fs.mkdirSync(path.join(diag, "nested"), { recursive: true, mode: 0o700 });
  fs.symlinkSync("/does-not-exist", path.join(diag, "nested", "link"));
  const proxy = new Proxy(fs, { get(target, key) { const value = target[key]; if (typeof value !== "function") return value; return (...args) => { if (typeof args[0] === "string" && args[0].startsWith(diag + path.sep)) throw Error("opaque descendant accessed"); return value(...args); }; } });
  const state = { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state, fsImpl: proxy }).legacy_evidence_isolation.classification, "OPAQUE_PRESERVED_NONAUTHORITY");
});

test("G3 legacy evidence isolation: rejection is terminal and receipts remain untouched", t => {
  const f = fixture(t), root = path.join(f.instances, "1832f0bb");
  fs.mkdirSync(path.join(root, "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const state = { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
  const receipt = path.join(root, "selected-fresh-instance-approval-v1.json");
  fs.writeFileSync(receipt, "{}", { mode: 0o600 });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home, state });
  assert.equal(result.legacy_evidence_isolation.classification, "REJECTED");
  assert.equal(result.instances[0].fresh_first_install_candidate, false);
  assert.equal(fs.readFileSync(receipt, "utf8"), "{}");
});

test("G3 legacy evidence isolation: malformed identity metadata and partial continuation reject", t => {
  const f = fixture(t), root = path.join(f.instances, "1832f0bb");
  fs.mkdirSync(path.join(root, "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const state = { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
  const metadata = path.join(root, "instance.json");
  fs.writeFileSync(metadata, '{"instance_id":"1832f0bb","instance_\u0069d":"1832f0bb"}', { mode: 0o600 });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state }).legacy_evidence_isolation.classification, "REJECTED");
  fs.unlinkSync(metadata);
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: { ...state, installation_id: "abcd1234" } }).legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: unsafe names, roots, modes and metadata reject", t => {
  const state = { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
  const cases = [
    ["unknown directory", root => fs.mkdirSync(path.join(root, "unknown"))],
    ["unknown file", root => fs.writeFileSync(path.join(root, "unknown"), "x")],
    ["legacy receipt", root => fs.writeFileSync(path.join(root, "trusted-recovery-evidence-v1.json"), "{}")],
    ["outside executable", root => { fs.mkdirSync(path.join(root, "logs")); fs.writeFileSync(path.join(root, "logs", "helper"), "x", { mode: 0o700 }); }],
    ["outside symlink", root => fs.symlinkSync("/does-not-exist", path.join(root, "logs"))],
    ["invalid UTF-8", root => fs.writeFileSync(path.join(root, "instance.json"), Buffer.from([0xff]), { mode: 0o600 })],
    ["oversize JSON", root => fs.writeFileSync(path.join(root, "instance.json"), Buffer.alloc(1024 * 1024 + 1, 0x20), { mode: 0o600 })],
    ["duplicate routes", root => writeJson(path.join(root, "chat-routes.json"), { routes: [{ route: "chat-A" }, { route: "chat-a" }] })],
    ["conflicting identity", root => writeJson(path.join(root, "instance.json"), { instance_id: "foreign" })],
    ["writable diagnostics", root => fs.chmodSync(path.join(root, "short-turn-evidence"), 0o777)]
  ];
  for (const [name, setup] of cases) {
    const f = fixture(t), root = path.join(f.instances, "1832f0bb");
    fs.mkdirSync(path.join(root, "short-turn-evidence"), { recursive: true, mode: 0o700 });
    setup(root);
    const result = inspectMacosExistingInstanceRecovery({ home: f.home, state });
    assert.equal(result.legacy_evidence_isolation.classification, "REJECTED", name);
    assert.equal(result.fresh_first_install_candidate, false, name);
  }
});

test("G3 legacy evidence isolation: exact intent is required", t => {
  const f = fixture(t), root = path.join(f.instances, "1832f0bb");
  fs.mkdirSync(path.join(root, "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const state = { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
  for (const bad of [{ ...state, macos_setup_approved: "true" }, { ...state, fresh_first_install_bootstrap: "true" }, { ...state, fresh_first_install_legacy_instance_id: "other" }, {}]) {
    assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: bad }).legacy_evidence_isolation, undefined);
  }
  fs.mkdirSync(path.join(f.instances, "other"), { mode: 0o700 });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state }).legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: diagnostics owner and drift fail closed", t => {
  const f = fixture(t), root = path.join(f.instances, "1832f0bb"), diag = path.join(root, "short-turn-evidence");
  fs.mkdirSync(diag, { recursive: true, mode: 0o700 });
  const state = { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
  for (const kind of ["foreign", "drift"]) {
    let seen = 0;
    const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync") return target[key]; return (...args) => { const stat = target.lstatSync(...args); if (args[0] !== diag) return stat; const changed = ++seen > 1; return new Proxy(stat, { get(object, prop) { if (kind === "foreign" && prop === "uid") return (process.getuid?.() ?? 0) + 1; if (kind === "drift" && changed && prop === "ctimeMs") return object.ctimeMs + 1; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); }; } });
    assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state, fsImpl: proxy }).legacy_evidence_isolation.classification, "REJECTED", kind);
  }
});

const g3Intent = { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
function g3Fixture(t) {
  const f = fixture(t), root = path.join(f.instances, "1832f0bb"), diagnostics = path.join(root, "short-turn-evidence");
  fs.mkdirSync(diagnostics, { recursive: true, mode: 0o700 });
  return { ...f, root, diagnostics };
}

test("G3 legacy evidence isolation: full observed historical paths and queue bytes are preserved", t => {
  const f = g3Fixture(t);
  const files = [
    ["shortturn-fixture-chat267-20261017-01/worker.log", 0o644],
    ["native-pid500-real-libproc-proof-20261018-v1/isolated-helper-home/.chatgpt-codex-orchestrator/instances/diag500a/runtime/native/macos/process-identity", 0o700]
  ].map(([relative, mode]) => { const file = path.join(f.diagnostics, relative); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, "historical bytes", { mode }); fs.chmodSync(file, mode); return file; });
  writeJson(path.join(f.root, "chat-routes.json"), { routes: [{ route: "chat-old", status: "active", chat_url: "https://chatgpt.com/c/private-old" }] });
  for (const directory of ["pending-wakes", "registration-delivery"]) { const file = path.join(f.root, directory, "old.json"); fs.mkdirSync(path.dirname(file), { mode: 0o700 }); fs.writeFileSync(file, "queue bytes", { mode: 0o600 }); files.push(file); }
  const before = files.map(file => ({ bytes: fs.readFileSync(file, "hex"), stat: fs.lstatSync(file) }));
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home }).status, "CONFLICT");
  const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent });
  assert.equal(report.status, "CONFLICT"); assert.equal(report.legacy_evidence_isolation.classification, "OPAQUE_PRESERVED_NONAUTHORITY");
  assert.equal(Object.hasOwn(report.instances[0], "identity"), false); assert.equal(JSON.stringify(report).includes("private-old"), false);
  for (let i = 0; i < files.length; i++) { const now = fs.lstatSync(files[i]); assert.equal(fs.readFileSync(files[i], "hex"), before[i].bytes); for (const key of ["mode", "dev", "ino"]) assert.equal(now[key], before[i].stat[key]); }
  assert.deepEqual(g3Intent, { macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
});

test("G3 legacy evidence isolation: no opaque enumeration or passive payload read is attempted", t => {
  const f = g3Fixture(t), deep = path.join(f.diagnostics, "fake", "instances", "new");
  fs.mkdirSync(deep, { recursive: true, mode: 0o700 }); fs.symlinkSync("/unreadable-target", path.join(deep, "link")); fs.writeFileSync(path.join(deep, "bad\u0001name"), "data");
  const payloads = ["pending-wakes", "logs"].map(name => { const dir = path.join(f.root, name); fs.mkdirSync(dir, { mode: 0o700 }); const file = path.join(dir, "payload"); fs.writeFileSync(file, "never read", { mode: 0o600 }); return file; });
  const violations = [], proxy = new Proxy(fs, { get(target, key) { const original = target[key]; if (typeof original !== "function") return original; return (...args) => { const p = args[0]; if (typeof p === "string" && (p.startsWith(f.diagnostics + path.sep) || (p === f.diagnostics && ["readdirSync", "opendirSync", "openSync", "readFileSync"].includes(key)) || (payloads.includes(p) && ["readFileSync", "openSync"].includes(key)))) { violations.push([key, p]); throw Error("forbidden observation"); } return original(...args); }; } });
  const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy });
  assert.equal(report.legacy_evidence_isolation.classification, "OPAQUE_PRESERVED_NONAUTHORITY"); assert.deepEqual(violations, []);
});

test("G3 legacy evidence isolation: exact intent matrix", t => {
for (const [name, mutate] of [
  ["missing setup", s => delete s.macos_setup_approved], ["false setup", s => s.macos_setup_approved = false], ["numeric setup", s => s.macos_setup_approved = 1], ["string setup", s => s.macos_setup_approved = "true"],
  ["missing bootstrap", s => delete s.fresh_first_install_bootstrap], ["false bootstrap", s => s.fresh_first_install_bootstrap = false], ["numeric bootstrap", s => s.fresh_first_install_bootstrap = 1], ["string bootstrap", s => s.fresh_first_install_bootstrap = "true"], ["wrong legacy", s => s.fresh_first_install_legacy_instance_id = "other"]
]) { const f = g3Fixture(t), state = { ...g3Intent }; mutate(state); assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state }).legacy_evidence_isolation, undefined); }
});

test("G3 legacy evidence isolation: unsafe entries matrix", t => {
for (const [name, setup] of [
  ["invalid JSON", f => fs.writeFileSync(path.join(f.root, "instance.json"), "{", { mode: 0o600 })],
  ["nonobject JSON", f => fs.writeFileSync(path.join(f.root, "instance.json"), "[]", { mode: 0o600 })],
  ["escaped duplicate key", f => fs.writeFileSync(path.join(f.root, "instance.json"), String.raw`{"instance_id":"1832f0bb","instance_\u0069d":"1832f0bb"}`, { mode: 0o600 })],
  ["empty snapshot suffix", f => fs.mkdirSync(path.join(f.root, "control-routing-migration-"), { mode: 0o700 })],
  ["authorization receipt", f => fs.writeFileSync(path.join(f.root, "selected-fresh-instance-approval-v1.json"), "{}", { mode: 0o600 })],
  ["trusted receipt", f => fs.writeFileSync(path.join(f.root, "trusted-recovery-evidence-v1.json"), "{}", { mode: 0o600 })],
  ["second root", f => fs.mkdirSync(path.join(f.instances, "another"), { mode: 0o700 })],
  ["diagnostic file", f => { fs.rmdirSync(f.diagnostics); fs.writeFileSync(f.diagnostics, "x", { mode: 0o600 }); }],
  ["diagnostic symlink", f => { fs.rmdirSync(f.diagnostics); fs.symlinkSync(f.home, f.diagnostics); }],
  ["diagnostic special mode", f => fs.chmodSync(f.diagnostics, 0o1700)],
  ["hard link", f => { const d = path.join(f.root, "logs"); fs.mkdirSync(d, { mode: 0o700 }); fs.writeFileSync(path.join(d, "a"), "x", { mode: 0o600 }); fs.linkSync(path.join(d, "a"), path.join(d, "b")); }]
]) { const f = g3Fixture(t); setup(f); const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }); assert.equal(report.legacy_evidence_isolation.classification, "REJECTED"); assert.equal(report.fresh_first_install_candidate, false); assert.equal(isMacosFreshFirstInstallBootstrap({ state: g3Intent, recovery: report }), false); }
});

test("G3 legacy evidence isolation: casefold root alias rejects", t => {
  const f = g3Fixture(t), proxy = new Proxy(fs, { get(target, key) { if (key !== "readdirSync") return target[key]; return (...args) => { const entries = target.readdirSync(...args); return args[0] === f.instances ? [...entries, { name: "1832F0BB" }] : entries; }; } });
  const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }); assert.equal(report.legacy_evidence_isolation.classification, "REJECTED"); assert.equal(report.fresh_first_install_candidate, false);
});

test("G3 legacy evidence isolation: initial audit marker and gates cannot be tampered", t => {
  const f = g3Fixture(t), report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent });
  assert.equal(isMacosFreshFirstInstallBootstrap({ state: g3Intent, recovery: report }), true);
  for (const key of ["schema_version", "classification", "instance_id", "diagnostics_subtree", "historical_instances_are_authority", "descendants_inspected", "runtime_activity_verified", "reason"]) {
    for (const place of ["aggregate", "historical"]) { const changed = structuredClone(report); const marker = place === "aggregate" ? changed.legacy_evidence_isolation : changed.instances[0].legacy_evidence_isolation; marker[key] = "tampered"; assert.equal(isMacosFreshFirstInstallBootstrap({ state: g3Intent, recovery: changed }), false, `${place} ${key}`); }
  }
  for (const mutate of [r => { r.instances[0].identity = {}; }, r => { r.instances[0].missing_verification_gates.push("other"); }, r => { r.missing_verification_gates.push("other"); }, r => { r.instances[0].fresh_first_install_candidate = false; }, r => { r.instance_ids.push("other"); }, r => { r.mutations_performed = true; }]) { const changed = structuredClone(report); mutate(changed); assert.equal(isMacosFreshFirstInstallBootstrap({ state: g3Intent, recovery: changed }), false); }
  for (const [key, value] of [["control_environment_ready", true], ["target_environment_ready", true], ["review_route", "chat-old"], ["chat_route_file", "/tmp/foreign"]]) assert.equal(isMacosFreshFirstInstallBootstrap({ state: { ...g3Intent, [key]: value }, recovery: report }), false, key);
});

test("G3 legacy evidence isolation: falsey initial audit matrix", t => {
for (const value of [null, false, 0, ""]) for (const location of ["aggregate", "historical"]) {
  const f = g3Fixture(t), report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent });
  if (location === "aggregate") report.legacy_evidence_isolation = value; else report.instances[0].legacy_evidence_isolation = value;
  assert.equal(isMacosFreshFirstInstallBootstrap({ state: g3Intent, recovery: report }), false);
}
});

test("G3 legacy evidence isolation: diagnostic drift matrix", t => {
for (const field of ["dev", "ino", "uid", "gid", "mode", "mtimeMs", "ctimeMs"]) {
  const f = g3Fixture(t); let count = 0;
  const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync") return target[key]; return (...args) => { const stat = target.lstatSync(...args); if (args[0] !== f.diagnostics) return stat; count++; const changed = count > 1; return new Proxy(stat, { get(object, prop) { if (changed && prop === field) return object[prop] + 1; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); }; } });
  const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }); assert.equal(report.legacy_evidence_isolation.classification, "REJECTED"); assert.ok(count > 1);
}
});

test("G3 legacy evidence isolation: private owner and mode matrix", t => {
for (const [name, which] of [["project", "project"], ["instances", "instances"], ["legacy", "root"], ["diagnostics", "diagnostics"]]) for (const property of ["uid", "mode"]) {
  const f = g3Fixture(t); f.project = path.dirname(f.instances); const targetPath = f[which];
  const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync") return target[key]; return (...args) => { const stat = target.lstatSync(...args); if (args[0] !== targetPath) return stat; return new Proxy(stat, { get(object, prop) { if (prop === property) return property === "uid" ? (process.getuid?.() ?? 0) + 1 : object.mode | 0o020; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); }; } });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }).legacy_evidence_isolation.classification, "REJECTED");
}
});

test("G3 legacy evidence isolation: partial state matrix", t => {
for (const [name, field, value] of [["installation", "installation_id", "partial"], ["instance", "instance_id", "partial"], ["instance path", "instance_root", "/tmp/partial"], ["control", "control_repository", "owner/partial"], ["sandbox", "sandbox_repository", "owner/partial"], ["control ID", "control_repository_id", "1"], ["sandbox ID", "sandbox_repository_id", "2"], ["route", "review_route", "chat-old"], ["route path", "chat_route_file", "/tmp/route"], ["target ready", "target_environment_ready", true], ["control ready", "control_environment_ready", true]]) {
  const f = g3Fixture(t), state = { ...g3Intent, [field]: value }, report = inspectMacosExistingInstanceRecovery({ home: f.home, state });
  assert.equal(report.legacy_evidence_isolation.classification, "REJECTED"); assert.equal(isMacosFreshFirstInstallBootstrap({ state, recovery: report }), false);
}
});

test("G3 legacy evidence isolation: first-install intent does not grant selected approval", t => {
  const f = selectedFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  const before = inspectSelected(f); assert.notEqual(before.status, "SELECTED_FRESH_INSTANCE_VERIFIED"); assert.ok(before.approval_challenge);
  assert.throws(() => approveSelected(f, "wrong approval"), /exact selected-fresh-instance approval/);
  const after = approveSelected(f, before.approval_challenge); assert.equal(after.status, "SELECTED_FRESH_INSTANCE_VERIFIED");
});

test("G3 legacy evidence isolation: traversal entry budget accepts boundary and rejects overflow", t => {
  const f = g3Fixture(t), logs = path.join(f.root, "logs"); fs.mkdirSync(logs, { mode: 0o700 });
  for (let i = 0; i < 4095; i++) fs.writeFileSync(path.join(logs, `entry-${i}`), "", { mode: 0o600 });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }).legacy_evidence_isolation.classification, "OPAQUE_PRESERVED_NONAUTHORITY");
  fs.writeFileSync(path.join(logs, "overflow"), "", { mode: 0o600 });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }).legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: traversal rejects excessive depth", t => {
  const f = g3Fixture(t); let dir = path.join(f.root, "logs"); fs.mkdirSync(dir, { mode: 0o700 });
  for (let i = 0; i < 64; i++) { dir = path.join(dir, "x"); fs.mkdirSync(dir, { mode: 0o700 }); }
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }).legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: metadata identity matrix", t => {
for (const [name, value] of [
  ["wrong instance", { instance_id: "other" }], ["wrong installation", { installation_id: "other" }],
  ["wrong control role", { control_repository: "owner/chatgpt-codex-orchestrator-sandbox-1832f0bb" }],
  ["wrong role suffix", { sandbox_repository: "owner/chatgpt-codex-orchestrator-sandbox-other" }],
  ["negative repository ID", { control_repository_id: -1 }], ["unsafe repository ID", { control_repository_id: 9007199254740992 }],
  ["nonnumeric repository ID", { control_repository_id: "wrong" }], ["equal repository IDs", { control_repository_id: 101, sandbox_repository_id: 101 }],
  ["conflicting generated identity", { control_repository: "owner/chatgpt-codex-orchestrator-control-1832f0bb", generated_repositories: { control: "different/chatgpt-codex-orchestrator-control-1832f0bb" } }],
  ["foreign destination", { destination: { path: "/tmp/foreign" } }]
]) { const f = g3Fixture(t); writeJson(path.join(f.root, "instance.json"), value); assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }).legacy_evidence_isolation.classification, "REJECTED"); }
});

test("G3 legacy evidence isolation: route validity matrix", t => {
for (const [name, routes] of [
  ["nonstring", [{ route: 42 }]], ["unsafe", [{ route: "../route" }]], ["case duplicate", [{ route: "chat-old" }, { route: "CHAT-OLD" }]],
  ["object key mismatch", { "chat-one": { route: "chat-two" } }]
]) { const f = g3Fixture(t); writeJson(path.join(f.root, "chat-routes.json"), { routes }); assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }).legacy_evidence_isolation.classification, "REJECTED"); }
});

test("G3 legacy evidence isolation: home canonicality matrix", t => {
for (const [name, pathFor] of [["relative home", f => path.relative(process.cwd(), f.home)], ["dot-dot home", f => `${f.home}/../${path.basename(f.home)}`]]) {
  const f = g3Fixture(t), home = pathFor(f), report = inspectMacosExistingInstanceRecovery({ home, state: g3Intent });
  assert.equal(report.legacy_evidence_isolation.classification, "REJECTED");
}
});

test("G3 legacy evidence isolation: diagnostic inode alias rejects", t => {
  const f = g3Fixture(t), oldStat = fs.lstatSync(f.root);
  const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync") return target[key]; return (...args) => { const stat = target.lstatSync(...args); if (args[0] !== f.diagnostics) return stat; return new Proxy(stat, { get(object, prop) { if (prop === "dev" || prop === "ino") return oldStat[prop]; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); }; } });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }).legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: metadata read failures and drift reject", t => {
  for (const mode of ["open-error", "read-error", "fstat-drift"]) {
    const f = g3Fixture(t), file = path.join(f.root, "instance.json"); writeJson(file, { instance_id: "1832f0bb" }); let fd = null, checks = 0;
    const proxy = new Proxy(fs, { get(target, key) {
      if (key === "openSync") return (...args) => { if (args[0] === file && mode === "open-error") throw Error("synthetic read error"); const result = target.openSync(...args); if (args[0] === file) fd = result; return result; };
      if (key === "readSync") return (...args) => { if (args[0] === fd && mode === "read-error") throw Error("synthetic read error"); return target.readSync(...args); };
      if (key === "fstatSync") return (...args) => { const stat = target.fstatSync(...args); if (args[0] !== fd || mode !== "fstat-drift" || ++checks < 2) return stat; return new Proxy(stat, { get(object, prop) { if (prop === "mtimeMs") return object.mtimeMs + 1; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); };
      return target[key];
    } });
    const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }); assert.equal(report.legacy_evidence_isolation.classification, "REJECTED", mode); assert.equal(JSON.stringify(report).includes("synthetic read error"), false, mode);
  }
});

test("G3 legacy evidence isolation: valid historical array and object routes stay nonauthoritative", t => {
  for (const routes of [[{ route: "chat-old", active: true }], { "chat-old": { status: "active" } }]) {
    const f = g3Fixture(t); writeJson(path.join(f.root, "chat-routes.json"), { routes });
    const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }); assert.equal(report.legacy_evidence_isolation.classification, "OPAQUE_PRESERVED_NONAUTHORITY"); assert.equal(Object.hasOwn(report.instances[0], "identity"), false);
  }
});

test("G3 legacy evidence isolation: private roots reject permissive and special modes", t => {
  for (const which of ["project", "instances", "root"]) for (const mode of [0o755, 0o1700]) {
    const f = g3Fixture(t); f.project = path.dirname(f.instances); fs.chmodSync(f[which], mode);
    const result = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }); assert.equal(result.legacy_evidence_isolation.classification, "REJECTED", `${which} ${mode.toString(8)}`);
  }
});

test("G3 legacy evidence isolation: symlink aliases for home and private roots reject", t => {
  for (const which of ["home", "project", "instances"]) {
    const f = g3Fixture(t); const project = path.dirname(f.instances); const target = which === "home" ? f.home : which === "project" ? project : f.instances;
    const alias = `${target}-retained`; fs.renameSync(target, alias); fs.symlinkSync(alias, target);
    try { const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }); assert.equal(report.legacy_evidence_isolation.classification, "REJECTED", which); } finally { fs.unlinkSync(target); fs.renameSync(alias, target); }
  }
});

test("G3 legacy evidence isolation: nonopaque special file proxy rejects", t => {
  const f = g3Fixture(t), directory = path.join(f.root, "logs"), file = path.join(directory, "payload"); fs.mkdirSync(directory, { mode: 0o700 }); fs.writeFileSync(file, "x", { mode: 0o600 });
  const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync") return target[key]; return (...args) => { const stat = target.lstatSync(...args); if (args[0] !== file) return stat; return new Proxy(stat, { get(object, prop) { if (prop === "isFile" || prop === "isDirectory" || prop === "isSymbolicLink") return () => false; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); }; } });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }).legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: growing metadata read is bounded and rejected", t => {
  const f = g3Fixture(t), file = path.join(f.root, "instance.json"); writeJson(file, {}); let targetFd, reads = 0;
  const proxy = new Proxy(fs, { get(target, key) {
    if (key === "openSync") return (...args) => { const fd = target.openSync(...args); if (args[0] === file) targetFd = fd; return fd; };
    if (key === "readSync") return (...args) => { if (args[0] !== targetFd) return target.readSync(...args); const count = target.readSync(...args); if (!count && reads++ === 0) { args[1][args[2]] = 0x20; return 1; } return count; };
    return target[key];
  } });
  const report = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }); assert.equal(report.legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: snapshot and route identities cannot conflict", t => {
  for (const source of ["snapshot", "route"]) {
    const f = g3Fixture(t), control = "owner/chatgpt-codex-orchestrator-control-1832f0bb", conflicting = "other/chatgpt-codex-orchestrator-control-1832f0bb";
    writeJson(path.join(f.root, "instance.json"), { control_repository: control });
    if (source === "snapshot") writeJson(path.join(f.root, "control-routing-migration-test", "instance.json"), { control_repository: conflicting });
    else writeJson(path.join(f.root, "chat-routes.json"), { routes: [{ route: "chat-old", control_repository: conflicting }] });
    assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent }).legacy_evidence_isolation.classification, "REJECTED", source);
  }
});

test("G3 legacy evidence isolation: metadata opens without following links", t => {
  const f = g3Fixture(t), file = path.join(f.root, "instance.json"), flagsSeen = []; writeJson(file, { instance_id: "1832f0bb" });
  const proxy = new Proxy(fs, { get(target, key) { if (key !== "openSync") return target[key]; return (...args) => { if (args[0] === file) flagsSeen.push(args[1]); return target.openSync(...args); }; } });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }); assert.equal(result.legacy_evidence_isolation.classification, "OPAQUE_PRESERVED_NONAUTHORITY"); assert.ok(flagsSeen.length); if (fs.constants.O_NOFOLLOW) assert.ok(flagsSeen.every(flags => (flags & fs.constants.O_NOFOLLOW) !== 0));
});

test("G3 legacy evidence isolation: traversal overflow stops before statting excess children", t => {
  const f = g3Fixture(t), logs = path.join(f.root, "logs"); fs.mkdirSync(logs, { mode: 0o700 });
  for (let i = 0; i < 4096; i++) fs.writeFileSync(path.join(logs, `entry-${i}`), "", { mode: 0o600 });
  let childStats = 0; const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync") return target[key]; return (...args) => { if (typeof args[0] === "string" && args[0].startsWith(logs + path.sep)) childStats++; return target.lstatSync(...args); }; } });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }).legacy_evidence_isolation.classification, "REJECTED"); assert.equal(childStats, 0);
});

test("G3 legacy evidence isolation: private metadata rejects permissive mode and foreign owner", t => {
  for (const kind of ["0644", "foreign uid"]) {
    const f = g3Fixture(t), file = path.join(f.root, "instance.json"); writeJson(file, { instance_id: "1832f0bb" }); if (kind === "0644") fs.chmodSync(file, 0o644);
    const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync" || kind !== "foreign uid") return target[key]; return (...args) => { const stat = target.lstatSync(...args); if (args[0] !== file) return stat; return new Proxy(stat, { get(object, prop) { if (prop === "uid") return (process.getuid?.() ?? 0) + 1; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); }; } });
    assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: g3Intent, fsImpl: proxy }).legacy_evidence_isolation.classification, "REJECTED", kind);
  }
});
