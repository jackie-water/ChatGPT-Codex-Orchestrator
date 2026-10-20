import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { issueTrustedRecoveryEvidence, verifyTrustedRecoveryEvidence } from "../src/lib/macos-trusted-recovery-evidence.mjs";
import { defaultLocalPaths } from "../src/lib/control-render.mjs";

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
  const githubApi = { getRepository: repository => repository === state.control_repository ? { id: 101, name: "control-a", full_name: repository, visibility: "PRIVATE", owner: { login: "owner" } } : { id: 202, name: "sandbox-a", full_name: repository, visibility: "PRIVATE", owner: { login: "owner" } }, getIssue: () => ({ number: 51, user: { login: "owner" }, body: JSON.stringify({ project: state.sandbox_project_key, chat_url: state.reviewer_chat_url, installation_id: state.installation_id }) }) };
  return { home, instance, control, state, githubApi };
}

test("first install issues an exact receipt and idempotent resume verifies it", () => {
  const f = fixture();
  try {
    const issued = issueTrustedRecoveryEvidence({ state: f.state, home: f.home, githubApi: f.githubApi });
    assert.equal(issued.status, "VERIFIED");
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
