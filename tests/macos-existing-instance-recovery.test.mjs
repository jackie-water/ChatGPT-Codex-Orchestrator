import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { inspectMacosExistingInstanceRecovery } from "../src/lib/macos-existing-instance-recovery.mjs";

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

test("distinct control and sandbox repositories are accepted when each role is consistent", t => {
  const f = fixture(t);
  const instance = path.join(f.instances, "expected");
  fs.mkdirSync(instance, { mode: 0o700 });
  const identity = { instance_id: "expected", installation_id: "install-a", control_repository: "org/control-a", sandbox_repository: "org/sandbox-a" };
  writeJson(path.join(instance, "instance.json"), identity);
  writeJson(path.join(instance, "chat-routes.json"), identity);
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "NEEDS_VERIFICATION");
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

test("recovery-preflight is an exposed read-only CLI command", t => {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "codex-cli-home-"));
  fs.chmodSync(home, 0o700);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "src/cli.mjs"), "recovery-preflight", "--json"], { encoding: "utf8", env: { ...process.env, HOME: home, CHATGPT_CODEX_ORCHESTRATOR_HOME: path.join(home, "codex-no-write-state") } });
  assert.match(result.stdout, /existing_instance_recovery|UNSUPPORTED/);
  assert.doesNotMatch(result.stdout, /chatgpt\.com\/c\//);
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
    assert.match(result.stdout, /MACOS-EXISTING-INSTANCE-REVIEW/);
    assert.equal(fs.readFileSync(path.join(stateRoot, "install-state.json"), "utf8"), before);
    assert.equal(fs.existsSync(marker), false);
  }
});

