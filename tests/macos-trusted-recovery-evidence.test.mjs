import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { issueTrustedRecoveryEvidence, verifyTrustedRecoveryEvidence, verifyMacosGeneratedRepositoryIdentity, githubReadOnlyApi } from "../src/lib/macos-trusted-recovery-evidence.mjs";
import { defaultLocalPaths } from "../src/lib/control-render.mjs";
import { ensureInstallerChatRegistration } from "../src/lib/chat-registration.mjs";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-recovery-v1-"));
  fs.chmodSync(home, 0o700);
  const instance = path.join(home, ".chatgpt-codex-orchestrator", "instances", "install-a");
  const control = defaultLocalPaths({ home, installationId: "install-a", projectKey: "sandbox-a" }).control;
  fs.mkdirSync(control, { recursive: true, mode: 0o700 });
  fs.mkdirSync(instance, { recursive: true, mode: 0o700 });
  const state = { schema_version: 1, macos_setup_approved: true, github_plugin_authorization_verified: true, installation_id: "install-a", instance_id: "install-a", instance_root: instance, control_clone_path: control, control_repository: "owner/control-a", sandbox_repository: "owner/sandbox-a", sandbox_project_key: "sandbox-a", sandbox_review_route: "chat-369", reviewer_chat_url: "https://chatgpt.com/c/chat-369", chat_route_file: path.join(instance, "chat-routes.json"), sandbox_verified: false, target_environment_ready: false };
  fs.writeFileSync(path.join(control, "instance.json"), JSON.stringify({ schema_version: 1, instance_id: state.instance_id, installation_id: state.installation_id, control_repository: state.control_repository, sandbox_repository: state.sandbox_repository, role: "control" }) + "\n", { mode: 0o600 });
  fs.writeFileSync(path.join(instance, "migration-intent.json"), JSON.stringify({ schema_version: 1, phase: "PREPARED", installation_id: state.installation_id, generated_repositories: { control: state.control_repository, sandbox: state.sandbox_repository } }) + "\n", { mode: 0o600 });
  fs.writeFileSync(state.chat_route_file, JSON.stringify({ version: 1, routes: [{ route: state.sandbox_review_route, project: state.sandbox_project_key, status: "active", chat_url: state.reviewer_chat_url, registration_issue: 51 }] }) + "\n", { mode: 0o600 });
  const githubCalls = [];
  const githubApi = { getRepository: repository => { githubCalls.push(["repository", repository]); return repository === state.control_repository ? { id: 101, name: "control-a", full_name: repository, visibility: "PRIVATE", owner: { login: "owner" } } : { id: 202, name: "sandbox-a", full_name: repository, visibility: "PRIVATE", owner: { login: "owner" } }; }, getIssue: () => { githubCalls.push(["issue"]); return { number: 51, user: { login: "owner" }, body: JSON.stringify({ project: state.sandbox_project_key, chat_url: state.reviewer_chat_url, installation_id: state.installation_id }) }; } };
  return { home, instance, control, state, githubApi, githubCalls };
}

function registrationPendingFixture(t, { installationId = "abcd1234-pending-install", instanceId = "abcd1234" } = {}) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "trusted-first-registration-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.chmodSync(home, 0o700);
  const instance = path.join(home, ".chatgpt-codex-orchestrator", "instances", instanceId);
  const project = `sandbox-${instanceId}`;
  const control = defaultLocalPaths({ home, installationId, projectKey: project }).control;
  fs.mkdirSync(control, { recursive: true, mode: 0o700 });
  fs.mkdirSync(instance, { recursive: true, mode: 0o700 });
  const state = {
    schema_version: 1, installation_id: installationId, instance_id: instanceId,
    instance_platform: "darwin", instance_arch: "arm64", instance_root: instance,
    control_clone_path: control, chat_route_file: path.join(instance, "chat-routes.json"),
    github_login: "owner", github_owner_id: "42", control_repository_id: "101", sandbox_repository_id: "202",
    control_repository: `owner/chatgpt-codex-orchestrator-control-${instanceId}`,
    sandbox_repository: `owner/chatgpt-codex-orchestrator-sandbox-${instanceId}`,
    sandbox_project_key: project, reviewer_chat_url: "https://chatgpt.com/c/pending-first-registration",
    macos_setup_approved: true, github_plugin_authorized: true, github_plugin_authorization_verified: true,
    generated_repo_authorized: true, control_environment_ready: true, target_environment_ready: false,
    sandbox_only: true, sandbox_verified: false
  };
  Object.assign(state, {
    github_plugin_authorization_installation_id: installationId,
    github_plugin_authorization_control_repository: state.control_repository,
    github_plugin_authorization_sandbox_repository: state.sandbox_repository,
    github_plugin_authorization_chat_url: state.reviewer_chat_url
  });
  const issueNumber = 51;
  state.sandbox_chat_registration_issue = `https://github.com/${state.control_repository}/issues/${issueNumber}`;
  const metadata = {
    schema_version: 1, instance_id: instanceId, installation_id: installationId,
    platform: "darwin", arch: "arm64", instance_root: instance, chat_route_file: state.chat_route_file,
    control_repository: state.control_repository, sandbox_repository: state.sandbox_repository,
    control_repository_id: state.control_repository_id, sandbox_repository_id: state.sandbox_repository_id,
    github_owner_id: state.github_owner_id, trusted_github_username: state.github_login, role: "control"
  };
  const intent = {
    schema_version: 1, phase: "PREPARED", installation_id: installationId,
    generated_repositories: { control: state.control_repository, sandbox: state.sandbox_repository },
    destination: { path: instance }
  };
  const route = {
    route: `chat-${issueNumber}`, project, status: "active", chat_url: state.reviewer_chat_url,
    registration_issue: issueNumber, installation_id: installationId
  };
  const issue = {
    number: issueNumber, state: "open", html_url: state.sandbox_chat_registration_issue,
    url: state.sandbox_chat_registration_issue, user: { login: "owner", id: 42 },
    title: `[CHAT-REGISTER] INSTALL-CHAT-${instanceId}-${project}-${crypto.createHash("sha256").update(state.reviewer_chat_url).digest("hex").slice(0, 16)}`,
    body: JSON.stringify({ project, chat_url: state.reviewer_chat_url, installation_id: installationId })
  };
  const repositories = Object.fromEntries(["control", "sandbox"].map(role => {
    const repository = state[`${role}_repository`];
    return [repository, {
      id: Number(state[`${role}_repository_id`]), private: true, visibility: "private",
      name: repository.split("/")[1], full_name: repository, owner: { login: "owner", id: 42 },
      description: `ChatGPT Codex Orchestrator ${role} installation ${installationId}`
    }];
  }));
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value) + "\n", { mode: 0o600 });
  const controlFile = path.join(control, "instance.json");
  const intentFile = path.join(instance, "migration-intent.json");
  writeJson(controlFile, metadata);
  writeJson(intentFile, intent);
  writeJson(state.chat_route_file, { version: 1, routes: [] });
  const calls = [];
  const f = { home, instance, control, state, metadata, intent, route, issue, repositories, calls, writeJson, controlFile, intentFile };
  f.githubApi = {
    getAuthenticatedUser: () => { calls.push(["user"]); return { login: "owner", id: 42 }; },
    getRepository: repository => { calls.push(["repository", repository]); return repositories[repository]; },
    getIssue: (repository, number) => { calls.push(["issue", repository, number]); return f.issue; }
  };
  f.queue = () => writeJson(state.chat_route_file, { version: 1, routes: [f.route] });
  f.callbackId = `chat-register-${project}-${issueNumber}`;
  f.outbox = path.join(instance, "pending-wakes", `${f.callbackId}.json`);
  f.deliveryJournal = path.join(instance, "registration-delivery", `${f.callbackId}.json`);
  f.writeDeliveryProof = () => {
    fs.mkdirSync(path.dirname(f.outbox), { mode: 0o700 });
    fs.mkdirSync(path.dirname(f.deliveryJournal), { mode: 0o700 });
    writeJson(f.outbox, {
      delivery_state: "DELIVERED", delivery_owner: "register-chat.mjs", callback_id: f.callbackId,
      chat_url: state.reviewer_chat_url, verified_by: "existing-user-message"
    });
    writeJson(f.deliveryJournal, {
      schema_version: 1, status: "DELIVERED", verified_role: "user", verified_by: "existing-user-message",
      callback_id: f.callbackId, chat_url: state.reviewer_chat_url,
      callback_state_sha256: crypto.createHash("sha256").update(fs.readFileSync(f.outbox)).digest("hex")
    });
  };
  f.verify = (options = {}) => verifyTrustedRecoveryEvidence({ state, home, githubApi: f.githubApi, requireReceipt: false, ...options });
  return f;
}

function registrationPendingSnapshot(f) {
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push([path.relative(f.home, file), fs.lstatSync(file).mode, fs.readFileSync(file).toString("hex")]);
    }
  };
  walk(f.home);
  return JSON.stringify({ state: f.state, files });
}

test("first install issues an exact receipt and idempotent resume verifies it", () => {
  const f = fixture();
  try {
    const issued = issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(issued.status, "VERIFIED");
    assert.equal(issued.manifest.status, "VERIFIED");
    assert.equal(new Date(issued.manifest.issued_at).toISOString(), issued.manifest.issued_at);
    const verified = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(verified.status, "VERIFIED");
    const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
    const before = fs.readFileSync(receipt);
    const issuedAgain = issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(issuedAgain.idempotent, true);
    assert.deepEqual(fs.readFileSync(receipt), before);
    assert.equal(issuedAgain.manifest.issued_at, issued.manifest.issued_at);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("valid object-map route registries issue and verify", () => {
  const f = fixture();
  try {
    const route = JSON.parse(fs.readFileSync(f.state.chat_route_file, "utf8")).routes[0];
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify({ version: 1, routes: { [route.route]: { ...route, route: undefined } } }) + "\n", { mode: 0o600 });
    assert.equal(issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }).status, "VERIFIED");
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }).status, "VERIFIED");
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("unsafe extra array route is rejected before issuance or GitHub queries", () => {
  const f = fixture();
  try {
    const routeFile = JSON.parse(fs.readFileSync(f.state.chat_route_file, "utf8"));
    routeFile.routes.push({ route: "../foreign", project: f.state.sandbox_project_key, status: "active", chat_url: f.state.reviewer_chat_url });
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify(routeFile) + "\n", { mode: 0o600 });
    const callsBefore = f.githubCalls.length;
    assert.throws(() => issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }), /malformed record/);
    assert.equal(f.githubCalls.length, callsBefore);
    assert.equal(fs.existsSync(path.join(f.instance, "trusted-recovery-evidence-v1.json")), false);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("missing-route extra record is rejected after issuance without receipt or GitHub mutation", () => {
  const f = fixture();
  try {
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
    const beforeReceipt = fs.readFileSync(receipt);
    const routeFile = JSON.parse(fs.readFileSync(f.state.chat_route_file, "utf8"));
    routeFile.routes.push({ project: f.state.sandbox_project_key, status: "active", chat_url: f.state.reviewer_chat_url });
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify(routeFile) + "\n", { mode: 0o600 });
    const callsBefore = f.githubCalls.length;
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.missing_verification_gates, ["chat_route_registry_integrity"]);
    assert.equal(result.mutations_performed, false);
    assert.equal(f.githubCalls.length, callsBefore);
    assert.deepEqual(fs.readFileSync(receipt), beforeReceipt);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("malformed object-map route records are rejected before GitHub queries", () => {
  for (const routes of [
    { "../foreign": { project: "sandbox-a", status: "active" } },
    { "chat-369": { route: "other-route", project: "sandbox-a", status: "active" } }
  ]) {
    const f = fixture();
    try {
      fs.writeFileSync(f.state.chat_route_file, JSON.stringify({ version: 1, routes }) + "\n", { mode: 0o600 });
      const callsBefore = f.githubCalls.length;
      const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false });
      assert.equal(result.status, "CONFLICT");
      assert.deepEqual(result.missing_verification_gates, ["chat_route_registry_integrity"]);
      assert.equal(f.githubCalls.length, callsBefore);
      assert.equal(fs.existsSync(path.join(f.instance, "trusted-recovery-evidence-v1.json")), false);
    } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
  }
});

test("receipt mode must remain exactly 0600 for verification and idempotent issuance", () => {
  const f = fixture();
  try {
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
    const beforeReceipt = fs.readFileSync(receipt);
    const beforeState = JSON.stringify(f.state);
    fs.chmodSync(receipt, 0o700);
    const callsBeforeVerify = f.githubCalls.length;
    const verified = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(verified.status, "CONFLICT");
    assert.deepEqual(verified.missing_verification_gates, ["trusted_manifest_integrity"]);
    assert.equal(verified.mutations_performed, false);
    assert.equal(f.githubCalls.length, callsBeforeVerify);
    assert.throws(() => issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }), /local trust evidence is contradictory/);
    assert.equal(JSON.stringify(f.state), beforeState);
    assert.deepEqual(fs.readFileSync(receipt), beforeReceipt);
    fs.chmodSync(receipt, 0o600);
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }).status, "VERIFIED");
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("selected route Chat URL must match the independently registered Chat before and after issuance", () => {
  const f = fixture();
  try {
    const routeFile = JSON.parse(fs.readFileSync(f.state.chat_route_file, "utf8"));
    routeFile.routes[0].chat_url = "https://chatgpt.com/c/another-conversation";
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify(routeFile) + "\n", { mode: 0o600 });
    assert.throws(() => issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }), /provenance/);
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false }).status, "NEEDS_HUMAN_LEGACY");

    routeFile.routes[0].chat_url = f.state.reviewer_chat_url;
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify(routeFile) + "\n", { mode: 0o600 });
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    routeFile.routes[0].chat_url = "https://chatgpt.com/c/another-conversation";
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify(routeFile) + "\n", { mode: 0o600 });
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.missing_verification_gates, ["independent_github_provenance"]);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("identical private repository identities refuse issuance and verification", () => {
  const f = fixture();
  try {
    f.state.sandbox_repository = f.state.control_repository;
    fs.writeFileSync(path.join(f.control, "instance.json"), JSON.stringify({ schema_version: 1, instance_id: f.state.instance_id, installation_id: f.state.installation_id, control_repository: f.state.control_repository, sandbox_repository: f.state.sandbox_repository, role: "control" }) + "\n", { mode: 0o600 });
    const migrationIntentFile = path.join(f.instance, "migration-intent.json");
    const migrationIntent = JSON.parse(fs.readFileSync(migrationIntentFile, "utf8"));
    migrationIntent.generated_repositories.sandbox = f.state.sandbox_repository;
    fs.writeFileSync(migrationIntentFile, JSON.stringify(migrationIntent) + "\n", { mode: 0o600 });
    assert.equal(fs.statSync(migrationIntentFile).mode & 0o777, 0o600);
    assert.equal(migrationIntent.installation_id, f.state.installation_id);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.control, "instance.json"), "utf8")).role, "control");
    assert.throws(() => issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }), /trust domains are not distinct/);
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false });
    assert.equal(result.status, "NEEDS_HUMAN_LEGACY");
    assert.equal(result.mutations_performed, false);
    assert.equal(fs.existsSync(path.join(f.instance, "trusted-recovery-evidence-v1.json")), false);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("distinct repository names with one immutable GitHub ID refuse issuance and verification", () => {
  const f = fixture();
  try {
    f.githubApi.getRepository = repository => ({ id: 101, name: repository === f.state.control_repository ? "control-a" : "sandbox-a", full_name: repository, visibility: "PRIVATE", owner: { login: "owner" } });
    assert.throws(() => issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }), /trust domains are not distinct/);
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false });
    assert.equal(result.status, "NEEDS_HUMAN_LEGACY");
    assert.equal(result.mutations_performed, false);
    assert.equal(fs.existsSync(path.join(f.instance, "trusted-recovery-evidence-v1.json")), false);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("previously valid receipt rejects a post-issuance immutable GitHub ID collision without mutation", () => {
  const f = fixture();
  try {
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
    const beforeReceipt = fs.readFileSync(receipt);
    const beforeState = JSON.stringify(f.state);
    const callsBeforeVerify = f.githubCalls.length;
    f.githubApi.getRepository = repository => { f.githubCalls.push(["repository", repository]); return { id: 101, name: repository === f.state.control_repository ? "control-a" : "sandbox-a", full_name: repository, visibility: "PRIVATE", owner: { login: "owner" } }; };
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.missing_verification_gates, ["independent_github_provenance"]);
    assert.equal(result.mutations_performed, false);
    assert.equal(JSON.stringify(f.state), beforeState);
    assert.deepEqual(fs.readFileSync(receipt), beforeReceipt);
    assert.deepEqual(f.githubCalls.slice(callsBeforeVerify), [
      ["repository", f.state.control_repository],
      ["repository", f.state.sandbox_repository]
    ]);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("persisted Control role tampering conflicts without receipt mutation", () => {
  const f = fixture();
  try {
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
    const before = fs.readFileSync(receipt);
    const controlFile = path.join(f.control, "instance.json");
    const control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
    control.role = "sandbox";
    fs.writeFileSync(controlFile, JSON.stringify(control) + "\n", { mode: 0o600 });
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.missing_verification_gates, ["control_clone_role"]);
    assert.equal(result.mutations_performed, false);
    assert.deepEqual(fs.readFileSync(receipt), before);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

for (const field of ["origin", "remote_origin"]) {
  test(`tampered persisted Control ${field} conflicts without receipt mutation`, () => {
    const f = fixture();
    try {
      issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
      const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
      const before = fs.readFileSync(receipt);
      const controlFile = path.join(f.control, "instance.json");
      const control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
      control[field] = "https://github.com/attacker/unrelated";
      fs.writeFileSync(controlFile, JSON.stringify(control) + "\n", { mode: 0o600 });
      const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
      assert.equal(result.status, "CONFLICT");
      assert.deepEqual(result.missing_verification_gates, [`control_clone_${field}`]);
      assert.equal(result.mutations_performed, false);
      assert.deepEqual(fs.readFileSync(receipt), before);
    } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
  });
}

test("pre-issuance Control role and origins are required", () => {
  for (const mutation of [
    { role: "sandbox" },
    { origin: "https://github.com/attacker/unrelated" },
    { remote_origin: "https://github.com/attacker/unrelated" }
  ]) {
    const f = fixture();
    try {
      const controlFile = path.join(f.control, "instance.json");
      const control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
      Object.assign(control, mutation);
      fs.writeFileSync(controlFile, JSON.stringify(control) + "\n", { mode: 0o600 });
      assert.throws(() => issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }), /local trust evidence is incomplete/);
      assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false }).status, "NEEDS_HUMAN_LEGACY");
      assert.equal(fs.existsSync(path.join(f.instance, "trusted-recovery-evidence-v1.json")), false);
    } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
  }
});

test("mutated receipt status fails closed without external verification", () => {
  const f = fixture();
  try {
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
    const beforeReceipt = fs.readFileSync(receipt);
    const beforeState = JSON.stringify(f.state);
    const manifest = JSON.parse(beforeReceipt);
    manifest.status = "INVALID";
    fs.writeFileSync(receipt, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    const tamperedReceipt = fs.readFileSync(receipt);
    const githubCallsBeforeVerify = f.githubCalls.length;
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false });
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.missing_verification_gates, ["trusted_manifest_status"]);
    assert.notEqual(result.status, "VERIFIED");
    assert.equal(result.mutations_performed, false);
    assert.deepEqual(fs.readFileSync(receipt), tamperedReceipt);
    assert.notDeepEqual(tamperedReceipt, beforeReceipt);
    assert.equal(JSON.stringify(f.state), beforeState);
    assert.equal(f.githubCalls.length, githubCallsBeforeVerify);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("deleted receipt issued_at fails closed without external verification", () => {
  const f = fixture();
  try {
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
    const beforeReceipt = fs.readFileSync(receipt);
    const beforeState = JSON.stringify(f.state);
    const manifest = JSON.parse(beforeReceipt);
    delete manifest.issued_at;
    fs.writeFileSync(receipt, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    const tamperedReceipt = fs.readFileSync(receipt);
    const githubCallsBeforeVerify = f.githubCalls.length;
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false });
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.missing_verification_gates, ["trusted_manifest_issued_at"]);
    assert.notEqual(result.status, "VERIFIED");
    assert.equal(result.mutations_performed, false);
    assert.deepEqual(fs.readFileSync(receipt), tamperedReceipt);
    assert.notDeepEqual(tamperedReceipt, beforeReceipt);
    assert.equal(JSON.stringify(f.state), beforeState);
    assert.equal(f.githubCalls.length, githubCallsBeforeVerify);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("bogus receipt issued_at fails closed without external verification", () => {
  const f = fixture();
  try {
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    const receipt = path.join(f.instance, "trusted-recovery-evidence-v1.json");
    const beforeReceipt = fs.readFileSync(receipt);
    const beforeState = JSON.stringify(f.state);
    const manifest = JSON.parse(beforeReceipt);
    manifest.issued_at = "not-a-timestamp";
    fs.writeFileSync(receipt, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    const tamperedReceipt = fs.readFileSync(receipt);
    const githubCallsBeforeVerify = f.githubCalls.length;
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false });
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.missing_verification_gates, ["trusted_manifest_issued_at"]);
    assert.notEqual(result.status, "VERIFIED");
    assert.equal(result.mutations_performed, false);
    assert.deepEqual(fs.readFileSync(receipt), tamperedReceipt);
    assert.notDeepEqual(tamperedReceipt, beforeReceipt);
    assert.equal(JSON.stringify(f.state), beforeState);
    assert.equal(f.githubCalls.length, githubCallsBeforeVerify);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("receipt absence is ABSENT before generated identity and legacy proof needs a human", () => {
  const f = fixture();
  try {
    assert.equal(verifyTrustedRecoveryEvidence({ state: {}, home: f.home, githubApi: f.githubApi }).status, "ABSENT");
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }).status, "NEEDS_HUMAN_LEGACY");
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("new install control preparation is bounded until its own Sandbox route exists", () => {
  const f = fixture();
  try {
    Object.assign(f.state, {
      control_environment_ready: true,
      github_plugin_authorized: true,
      github_plugin_authorization_installation_id: f.state.installation_id,
      github_plugin_authorization_control_repository: f.state.control_repository,
      github_plugin_authorization_sandbox_repository: f.state.sandbox_repository,
      github_plugin_authorization_chat_url: f.state.reviewer_chat_url
    });
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify({ version: 1, routes: [] }) + "\n", { mode: 0o600 });
    const awaiting = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false });
    assert.equal(awaiting.status, "NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE");
    assert.equal(awaiting.mutations_performed, false);

    f.state.sandbox_review_route = "sandbox-install-route";
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify({ version: 1, routes: [{ route: f.state.sandbox_review_route, project: f.state.sandbox_project_key, status: "active", chat_url: f.state.reviewer_chat_url, registration_issue: 51 }] }) + "\n", { mode: 0o600 });
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false }).status, "NEW_INSTALL_PREPARED");
    assert.equal(issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }).status, "VERIFIED");
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }).status, "VERIFIED");
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("bootstrap proof denies offline, forged Control role/origin, and historical no-proof states", () => {
  const f = fixture();
  try {
    Object.assign(f.state, { control_environment_ready: true, github_plugin_authorized: true });
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify({ version: 1, routes: [] }) + "\n", { mode: 0o600 });
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: { getRepository: () => { throw new Error("offline"); } }, requireReceipt: false }).status, "NEEDS_HUMAN_LEGACY");
    fs.writeFileSync(path.join(f.control, "instance.json"), JSON.stringify({ instance_id: f.state.instance_id, installation_id: f.state.installation_id, control_repository: f.state.control_repository, sandbox_repository: f.state.sandbox_repository, role: "sandbox", origin: "https://github.com/attacker/forged" }) + "\n", { mode: 0o600 });
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false }).status, "NEEDS_HUMAN_LEGACY");
    assert.equal(verifyTrustedRecoveryEvidence({ state: {}, home: f.home, githubApi: f.githubApi, requireReceipt: false }).status, "ABSENT");
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("installer state cannot forge VERIFIED while independent proof is offline", () => {
  const f = fixture();
  try {
    Object.assign(f.state, { trusted_recovery_evidence_status: "VERIFIED", control_environment_ready: true, github_plugin_authorized: true });
    fs.writeFileSync(f.state.chat_route_file, JSON.stringify({ version: 1, routes: [] }) + "\n", { mode: 0o600 });
    const result = verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: { getRepository: () => { throw new Error("offline"); } }, requireReceipt: false });
    assert.equal(result.status, "NEEDS_HUMAN_LEGACY");
    assert.deepEqual(result.missing_verification_gates, ["trusted_manifest_version"]);
    assert.equal(result.mutations_performed, false);
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("offline, wrong private repository, issue, route, symlink, and tamper fail closed", () => {
  const f = fixture();
  try {
    issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: { getRepository: () => { throw new Error("offline"); } } }).status, "CONFLICT");
    fs.appendFileSync(path.join(f.instance, "trusted-recovery-evidence-v1.json"), "tamper");
    assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }).status, "CONFLICT");
    fs.writeFileSync(path.join(f.instance, "logs.txt"), "passive 0644\n", { mode: 0o644 });
  } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
});

test("foreign or alternate owned trust paths are rejected without receipt writes", () => {
  for (const alternate of ["foreign-control", "other-instance-control", "alternate-route"]) {
    const f = fixture();
    try {
      const before = fs.readdirSync(f.instance);
      if (alternate === "alternate-route") {
        f.state.chat_route_file = path.join(f.home, "routes.json");
        fs.writeFileSync(f.state.chat_route_file, fs.readFileSync(path.join(f.instance, "chat-routes.json")), { mode: 0o600 });
      } else {
        f.state.control_clone_path = path.join(f.home, alternate);
        fs.mkdirSync(f.state.control_clone_path, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(f.state.control_clone_path, "instance.json"), fs.readFileSync(path.join(f.control, "instance.json")), { mode: 0o600 });
      }
      assert.equal(verifyTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi, requireReceipt: false }).status, "CONFLICT");
      assert.throws(() => issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }), /canonical/);
      assert.deepEqual(fs.readdirSync(f.instance), before);
    } finally { fs.rmSync(f.home, { recursive: true, force: true }); }
  }
});

test("fresh selected repository proof uses independent immutable owner and distinct repository IDs without a Chat issue", () => {
  const installationId = "fresh-identity-a";
  const instanceId = "freshide";
  const state = {
    installation_id: installationId, instance_id: instanceId, github_login: "owner",
    control_repository: `owner/chatgpt-codex-orchestrator-control-${instanceId}`,
    sandbox_repository: `owner/chatgpt-codex-orchestrator-sandbox-${instanceId}`,
    reviewer_chat_url: "https://chatgpt.com/c/fresh-identity",
    macos_setup_approved: true, github_plugin_authorized: true, github_plugin_authorization_verified: true,
    generated_repo_authorized: true, target_environment_ready: false, sandbox_only: true
  };
  Object.assign(state, {
    github_plugin_authorization_installation_id: installationId,
    github_plugin_authorization_control_repository: state.control_repository,
    github_plugin_authorization_sandbox_repository: state.sandbox_repository,
    github_plugin_authorization_chat_url: state.reviewer_chat_url
  });
  const calls = [];
  const api = {
    getAuthenticatedUser: () => { calls.push("user"); return { login: "owner", id: 42 }; },
    getRepository: repository => {
      calls.push(repository);
      const role = repository === state.control_repository ? "control" : "sandbox";
      return { id: role === "control" ? 101 : 202, private: true, visibility: "private", full_name: repository, name: repository.split("/")[1], owner: { login: "owner", id: 42 }, description: `ChatGPT Codex Orchestrator ${role} installation ${installationId}` };
    },
    getIssue: () => { throw new Error("first registration must not depend on its own Chat issue"); }
  };
  assert.deepEqual(verifyMacosGeneratedRepositoryIdentity({ state, githubApi: api }), { github_login: "owner", github_user_id: "42", control_repository_id: "101", sandbox_repository_id: "202" });
  assert.deepEqual(calls, ["user", state.control_repository, state.sandbox_repository]);
  assert.throws(() => verifyMacosGeneratedRepositoryIdentity({ state: { ...state, github_plugin_authorization_installation_id: "foreign" }, githubApi: api }), /exact first-install authorization/);
  assert.equal(calls.length, 3);
});

test("read-only GitHub adapter pins user, repository, and issue provenance to github.com", () => {
  const calls = [];
  const api = githubReadOnlyApi({ run: args => { calls.push(args); return { ok: true, stdout: JSON.stringify({ login: "synthetic", id: 42 }) }; } });
  assert.deepEqual(api.getAuthenticatedUser(), { login: "synthetic", id: 42 });
  api.getRepository("synthetic/control");
  api.getIssue("synthetic/control", 410);
  assert.deepEqual(calls, [
    ["api", "--hostname", "github.com", "user"],
    ["api", "--hostname", "github.com", "repos/synthetic/control"],
    ["api", "--hostname", "github.com", "repos/synthetic/control/issues/410"]
  ]);
});

test("ordinary fresh install reaches its saved first registration without treating the registry as delivery", t => {
  const f = registrationPendingFixture(t);
  assert.equal(f.verify().status, "NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE");
  f.queue();
  const before = registrationPendingSnapshot(f);
  const pending = f.verify();
  assert.equal(pending.status, "NEW_INSTALL_REGISTRATION_PENDING");
  assert.deepEqual(pending.missing_verification_gates, ["registration_delivery_receipt", "trusted_manifest"]);
  assert.equal(pending.mutations_performed, false);
  assert.equal(registrationPendingSnapshot(f), before);
  assert.equal(fs.existsSync(path.join(f.instance, "trusted-recovery-evidence-v1.json")), false);
  assert.throws(() => issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }), /complete installer identity/);
  assert.ok(f.calls.some(call => call[0] === "issue" && call[1] === f.state.control_repository && call[2] === 51));
  assert.notEqual(f.verify({ requireReceipt: true }).status, "VERIFIED");

  let creates = 0;
  const waiting = ensureInstallerChatRegistration(f.state, {
    projectKey: f.state.sandbox_project_key,
    commandRunner: args => {
      assert.equal(args[0], "issue");
      if (args[1] === "create") { creates++; assert.fail("the exact existing registration must not be resubmitted"); }
      assert.equal(args[1], "list");
      return { ok: true, stdout: JSON.stringify([f.issue]) };
    }
  });
  assert.equal(waiting.status, "WAITING");
  assert.equal(waiting.issue.url, f.state.sandbox_chat_registration_issue);
  assert.equal(creates, 0);
  assert.equal(registrationPendingSnapshot(f), before);

  // These private mock files represent the canonical owner's observed user turn;
  // the registry itself never writes or substitutes for this delivery evidence.
  f.writeDeliveryProof();
  const ready = ensureInstallerChatRegistration(f.state, {
    projectKey: f.state.sandbox_project_key,
    commandRunner: () => assert.fail("a genuine local delivery receipt must be consumed without an issue submission")
  });
  assert.equal(ready.status, "READY");
  assert.equal(ready.route, "chat-51");
  assert.equal(f.state.sandbox_review_route, undefined, "the pre-registration check does not persist a route");
  f.state.sandbox_review_route = ready.route;
  assert.equal(issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi }).status, "VERIFIED");
  assert.equal(f.verify({ requireReceipt: true }).status, "VERIFIED");
});

test("undefined, null, and empty saved routes share the narrow first-registration pending state", t => {
  for (const route of [undefined, null, ""]) {
    const f = registrationPendingFixture(t);
    if (route !== undefined) f.state.sandbox_review_route = route;
    f.queue();
    const before = registrationPendingSnapshot(f);
    assert.equal(f.verify().status, "NEW_INSTALL_REGISTRATION_PENDING");
    assert.equal(registrationPendingSnapshot(f), before);
  }
});

test("first-registration pending denies forged installer, route, issue, and immutable repository identity", t => {
  const changeControl = (f, changes) => f.writeJson(f.controlFile, { ...f.metadata, ...changes });
  const changeIntent = (f, changes) => f.writeJson(f.intentFile, { ...f.intent, ...changes });
  const changeBody = (f, changes) => { f.issue.body = JSON.stringify({ ...JSON.parse(f.issue.body), ...changes }); };
  const cases = [
    ["Windows identity", f => { f.state.instance_platform = "win32"; }],
    ["Intel identity", f => { f.state.instance_arch = "x64"; }],
    ["noncanonical instance", f => { f.state.instance_id = "other-instance"; }],
    ["changed installation", f => { f.state.installation_id = "other-installation"; }],
    ["foreign project", f => { f.state.sandbox_project_key = "sandbox-foreign"; }],
    ["foreign Control name", f => { f.state.control_repository = "owner/foreign-control"; }],
    ["foreign Sandbox name", f => { f.state.sandbox_repository = "owner/foreign-sandbox"; }],
    ["foreign login", f => { f.state.github_login = "foreign"; }],
    ["missing immutable owner", f => { delete f.state.github_owner_id; }],
    ["changed immutable owner", f => { f.state.github_owner_id = "43"; }],
    ["invalid immutable owner", f => { f.state.github_owner_id = "0"; }],
    ["conflicting optional user ID", f => { f.state.github_user_id = "43"; }],
    ["missing immutable Control ID", f => { delete f.state.control_repository_id; }],
    ["missing immutable Sandbox ID", f => { delete f.state.sandbox_repository_id; }],
    ["changed immutable Control ID", f => { f.state.control_repository_id = "103"; }],
    ["changed immutable Sandbox ID", f => { f.state.sandbox_repository_id = "203"; }],
    ["invalid immutable Control ID", f => { f.state.control_repository_id = "101x"; }],
    ["shared immutable repository ID", f => { f.state.sandbox_repository_id = f.state.control_repository_id; }],
    ["missing setup approval", f => { f.state.macos_setup_approved = false; }],
    ["missing plugin authorization", f => { f.state.github_plugin_authorized = false; }],
    ["unverified plugin authorization", f => { f.state.github_plugin_authorization_verified = false; }],
    ["missing generated repository approval", f => { delete f.state.generated_repo_authorized; }],
    ["foreign exact installation authorization", f => { f.state.github_plugin_authorization_installation_id = "foreign"; }],
    ["missing exact Control authorization", f => { delete f.state.github_plugin_authorization_control_repository; }],
    ["foreign exact Sandbox authorization", f => { f.state.github_plugin_authorization_sandbox_repository = "owner/foreign"; }],
    ["foreign exact Chat authorization", f => { f.state.github_plugin_authorization_chat_url = "https://chatgpt.com/c/foreign"; }],
    ["unprepared Control", f => { f.state.control_environment_ready = false; }],
    ["missing Sandbox boundary", f => { delete f.state.sandbox_only; }],
    ["disabled Sandbox boundary", f => { f.state.sandbox_only = false; }],
    ["missing target boundary", f => { delete f.state.target_environment_ready; }],
    ["enabled target", f => { f.state.target_environment_ready = true; }],
    ["selected-instance flow", f => { f.state.selected_fresh_instance = true; }],
    ["legacy route declaration", f => { f.state.review_route = "chat-51"; }],
    ["foreign saved route", f => { f.state.sandbox_review_route = "chat-52"; }],
    ["absent saved issue", f => { delete f.state.sandbox_chat_registration_issue; }],
    ["numeric saved issue", f => { f.state.sandbox_chat_registration_issue = 51; }],
    ["numeric string saved issue", f => { f.state.sandbox_chat_registration_issue = "51"; }],
    ["foreign saved issue repository", f => { f.state.sandbox_chat_registration_issue = "https://github.com/owner/foreign/issues/51"; }],
    ["foreign saved issue host", f => { f.state.sandbox_chat_registration_issue = `https://example.com/${f.state.control_repository}/issues/51`; }],
    ["saved issue query", f => { f.state.sandbox_chat_registration_issue += "?source=installer"; }],
    ["saved issue fragment", f => { f.state.sandbox_chat_registration_issue += "#issuecomment-1"; }],
    ["saved issue leading zero", f => { f.state.sandbox_chat_registration_issue = f.state.sandbox_chat_registration_issue.replace(/51$/, "051"); }],
    ["duplicate route", f => f.writeJson(f.state.chat_route_file, { version: 1, routes: [f.route, f.route] })],
    ["extra unrelated route", f => f.writeJson(f.state.chat_route_file, { version: 1, routes: [f.route, { ...f.route, route: "chat-52", project: "other", registration_issue: 52 }] })],
    ["object-map route", f => f.writeJson(f.state.chat_route_file, { version: 1, routes: { [f.route.route]: f.route } })],
    ["inactive route", f => { f.route.status = "inactive"; f.queue(); }],
    ["foreign route project", f => { f.route.project = "sandbox-foreign"; f.queue(); }],
    ["foreign route Chat", f => { f.route.chat_url = "https://chatgpt.com/c/foreign"; f.queue(); }],
    ["missing route installation", f => { delete f.route.installation_id; f.queue(); }],
    ["foreign route installation", f => { f.route.installation_id = "foreign"; f.queue(); }],
    ["wrong issue route pair", f => { f.route.route = "chat-52"; f.queue(); }],
    ["string route issue", f => { f.route.registration_issue = "51"; f.queue(); }],
    ["foreign route issue", f => { f.route.registration_issue = 52; f.queue(); }],
    ["missing Control metadata ID", f => { const metadata = { ...f.metadata }; delete metadata.control_repository_id; f.writeJson(f.controlFile, metadata); }],
    ["missing Sandbox metadata ID", f => { const metadata = { ...f.metadata }; delete metadata.sandbox_repository_id; f.writeJson(f.controlFile, metadata); }],
    ["missing Control metadata owner", f => { const metadata = { ...f.metadata }; delete metadata.github_owner_id; f.writeJson(f.controlFile, metadata); }],
    ["changed Control metadata ID", f => changeControl(f, { control_repository_id: "999" })],
    ["changed Sandbox metadata ID", f => changeControl(f, { sandbox_repository_id: "999" })],
    ["wrong Control platform", f => changeControl(f, { platform: "win32" })],
    ["wrong Control architecture", f => changeControl(f, { arch: "x64" })],
    ["foreign optional Control root", f => changeControl(f, { instance_root: path.join(f.home, "foreign-instance") })],
    ["foreign optional Control owner", f => changeControl(f, { github_owner_id: "999" })],
    ["foreign optional intent destination", f => changeIntent(f, { destination: { path: path.join(f.home, "foreign-instance") } })],
    ["foreign optional route instance", f => { f.route.instance_id = "foreign"; f.queue(); }],
    ["foreign optional route Control ID", f => { f.route.control_repository_id = "999"; f.queue(); }],
    ["foreign remote user", f => { f.githubApi.getAuthenticatedUser = () => ({ login: "foreign", id: 42 }); }],
    ["changed remote user ID", f => { f.githubApi.getAuthenticatedUser = () => ({ login: "owner", id: 43 }); }],
    ["changed remote Control ID", f => { f.repositories[f.state.control_repository].id = 999; }],
    ["changed remote Sandbox ID", f => { f.repositories[f.state.sandbox_repository].id = 999; }],
    ["shared remote repository ID", f => { f.repositories[f.state.sandbox_repository].id = 101; }],
    ["public remote Control", f => { f.repositories[f.state.control_repository].private = false; f.repositories[f.state.control_repository].visibility = "public"; }],
    ["foreign remote repository owner ID", f => { f.repositories[f.state.control_repository].owner.id = 43; }],
    ["foreign remote installation description", f => { f.repositories[f.state.sandbox_repository].description = "foreign installation"; }],
    ["closed remote issue", f => { f.issue.state = "closed"; }],
    ["missing remote issue URL", f => { delete f.issue.html_url; }],
    ["foreign remote issue URL", f => { f.issue.html_url = "https://github.com/owner/foreign/issues/51"; }],
    ["foreign remote issue number", f => { f.issue.number = 52; }],
    ["foreign remote issue author", f => { f.issue.user.login = "foreign"; }],
    ["foreign remote issue author ID", f => { f.issue.user.id = 43; }],
    ["missing remote issue author ID", f => { delete f.issue.user.id; }],
    ["foreign remote issue marker", f => { f.issue.title += "-foreign"; }],
    ["foreign remote issue installation", f => changeBody(f, { installation_id: "foreign" })],
    ["foreign remote issue project", f => changeBody(f, { project: "sandbox-foreign" })],
    ["foreign remote issue Chat", f => changeBody(f, { chat_url: "https://chatgpt.com/c/foreign" })],
    ["malformed remote issue body", f => { f.issue.body = "not-json"; }],
    ["pull request masquerading as registration", f => { f.issue.pull_request = {}; }],
    ["offline authenticated user", f => { f.githubApi.getAuthenticatedUser = () => { throw new Error("offline user"); }; }],
    ["offline repositories", f => { f.githubApi.getRepository = () => { throw new Error("offline repository"); }; }],
    ["offline registration issue", f => { f.githubApi.getIssue = () => { throw new Error("offline issue"); }; }]
  ];
  for (const [name, mutate] of cases) {
    const f = registrationPendingFixture(t);
    f.queue();
    mutate(f);
    const before = registrationPendingSnapshot(f);
    const result = f.verify();
    assert.notEqual(result.status, "NEW_INSTALL_REGISTRATION_PENDING", name);
    assert.notEqual(result.status, "VERIFIED", name);
    assert.equal(result.mutations_performed, false, name);
    assert.equal(registrationPendingSnapshot(f), before, name);
    assert.equal(fs.existsSync(path.join(f.instance, "trusted-recovery-evidence-v1.json")), false, name);
  }
  const historical = registrationPendingFixture(t, { installationId: "1832f0bb-pending-install", instanceId: "1832f0bb" });
  historical.queue();
  const before = registrationPendingSnapshot(historical);
  assert.notEqual(historical.verify().status, "NEW_INSTALL_REGISTRATION_PENDING");
  assert.equal(registrationPendingSnapshot(historical), before);
});

test("missing or forged delivery proof stays WAITING without a second registration submission", t => {
  const updateProof = (f, file, changes) => f.writeJson(file, { ...JSON.parse(fs.readFileSync(file, "utf8")), ...changes });
  const cases = [
    ["no proof", f => { fs.rmSync(f.outbox); fs.rmSync(f.deliveryJournal); }],
    ["missing outbox", f => fs.rmSync(f.outbox)],
    ["missing journal", f => fs.rmSync(f.deliveryJournal)],
    ["pending outbox", f => updateProof(f, f.outbox, { delivery_state: "PENDING" })],
    ["unproven submission", f => updateProof(f, f.outbox, { verified_by: "submission-confirmed" })],
    ["foreign delivery owner", f => updateProof(f, f.outbox, { delivery_owner: "other-owner.mjs" })],
    ["assistant journal", f => updateProof(f, f.deliveryJournal, { verified_role: "assistant" })],
    ["foreign journal callback", f => updateProof(f, f.deliveryJournal, { callback_id: "foreign-callback" })],
    ["foreign journal Chat", f => updateProof(f, f.deliveryJournal, { chat_url: "https://chatgpt.com/c/foreign" })],
    ["forged outbox digest", f => updateProof(f, f.deliveryJournal, { callback_state_sha256: "0".repeat(64) })],
    ["public outbox", f => fs.chmodSync(f.outbox, 0o644)],
    ["public journal", f => fs.chmodSync(f.deliveryJournal, 0o644)]
  ];
  for (const [name, mutate] of cases) {
    const f = registrationPendingFixture(t);
    f.queue();
    f.writeDeliveryProof();
    mutate(f);
    const before = registrationPendingSnapshot(f);
    assert.equal(f.verify().status, "NEW_INSTALL_REGISTRATION_PENDING", name);
    let lookups = 0, creates = 0;
    const registration = ensureInstallerChatRegistration(f.state, {
      projectKey: f.state.sandbox_project_key,
      commandRunner: args => {
        if (args[1] === "create") { creates++; assert.fail(`${name}: duplicate registration submission`); }
        assert.equal(args[1], "list");
        lookups++;
        return { ok: true, stdout: JSON.stringify([f.issue]) };
      }
    });
    assert.equal(registration.status, "WAITING", name);
    assert.equal(registration.issue.url, f.state.sandbox_chat_registration_issue, name);
    assert.equal(lookups, 1, name);
    assert.equal(creates, 0, name);
    assert.equal(registrationPendingSnapshot(f), before, name);
  }
});
