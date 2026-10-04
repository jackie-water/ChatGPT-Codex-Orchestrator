import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("PowerShell callback fixture is executable on Windows", { skip: process.platform !== "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callback-fixture-"));
  try {
    const scripts = path.join(dir, "control", "scripts");
    const instance = path.join(dir, "home", ".chatgpt-codex-orchestrator", "instances", "fixture");
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(instance, { recursive: true });
    for (const name of ["wake-chat.ps1", "runtime-context.ps1", "wake-chat.mjs", "callback-receipt.mjs"]) {
      fs.copyFileSync(path.resolve("runtime/scripts", name), path.join(scripts, name));
    }
    fs.writeFileSync(path.join(dir, "control", "instance.json"), JSON.stringify({ instance_id: "fixture" }));
    fs.writeFileSync(path.join(instance, "config.ps1"), "$env:ORCHESTRATOR_INSTANCE_ID = 'fixture'\n");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(scripts, "wake-chat.ps1"), "-ReconcileOnly", "-CallbackId", "bad/id"], {
      encoding: "utf8", cwd: process.cwd(), env: { ...process.env, HOME: path.join(dir, "home"), USERPROFILE: path.join(dir, "home") }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Invalid CallbackId/);
    assert.equal(fs.existsSync(path.join(instance, "pending-wakes", "bad_id.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
