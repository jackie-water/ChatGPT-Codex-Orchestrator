import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { inspectMacosExistingInstanceRecovery } from "../src/lib/macos-existing-instance-recovery.mjs";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-macos-recovery-"));
  const instances = path.join(home, ".chatgpt-codex-orchestrator", "instances");
  fs.mkdirSync(instances, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(home, ".chatgpt-codex-orchestrator"), 0o700);
  fs.chmodSync(instances, 0o700);
  return { home, instances };
}

function writeJson(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode });
  fs.chmodSync(file, mode);
}

test("empty canonical instance tree is ABSENT and read-only", () => {
  const f = fixture();
  const before = fs.readdirSync(f.home, { recursive: true }).sort();
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "ABSENT");
  assert.equal(result.mutations_performed, false);
  assert.deepEqual(fs.readdirSync(f.home, { recursive: true }).sort(), before);
});

test("single partial instance is NEEDS_VERIFICATION and never exposes the Chat URL", () => {
  const f = fixture();
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

test("multiple instances are CONFLICT", () => {
  const f = fixture();
  for (const id of ["first", "second"]) fs.mkdirSync(path.join(f.instances, id), { mode: 0o700 });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.deepEqual(result.instance_ids, ["first", "second"]);
});

test("symlinked candidate and odd private modes fail closed", t => {
  const f = fixture();
  fs.mkdirSync(path.join(f.home, "outside"), { mode: 0o700 });
  try { fs.symlinkSync(path.join(f.home, "outside"), path.join(f.instances, "linked")); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) return t.skip("symlinks unavailable"); throw error; }
  fs.mkdirSync(path.join(f.instances, "open"), { mode: 0o755 });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
});

test("mismatched instance and installation identifiers fail closed", () => {
  const f = fixture();
  const instance = path.join(f.instances, "expected");
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "instance.json"), { instance_id: "other", installation_id: "install-a" });
  writeJson(path.join(instance, "chat-routes.json"), { instance_id: "expected", installation_id: "install-b", routes: [] });
  const result = inspectMacosExistingInstanceRecovery({ home: f.home });
  assert.equal(result.status, "CONFLICT");
  assert.ok(result.missing_verification_gates.includes("matching_instance_identifier"));
});

test("recovery-preflight is an exposed read-only CLI command", () => {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "src/cli.mjs"), "recovery-preflight", "--json"], { encoding: "utf8", env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "codex-cli-home-")), CHATGPT_CODEX_ORCHESTRATOR_HOME: path.join(os.tmpdir(), "codex-no-write-state") } });
  assert.match(result.stdout, /existing_instance_recovery|UNSUPPORTED/);
  assert.doesNotMatch(result.stdout, /chatgpt\.com\/c\//);
});

test("Darwin setup and resume stop before installer state or external commands for an unbound instance", { skip: process.platform !== "darwin" }, () => {
  const f = fixture();
  const instance = path.join(f.instances, "1832f0bb");
  fs.mkdirSync(instance, { mode: 0o700 });
  writeJson(path.join(instance, "chat-routes.json"), { routes: [{ route: "chat-333", chat_url: "https://chatgpt.com/c/redacted" }] });
  const sentinels = fs.mkdtempSync(path.join(os.tmpdir(), "codex-command-sentinels-"));
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

