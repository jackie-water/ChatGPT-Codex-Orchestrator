import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("PowerShell callback fixture is executable on Windows", { skip: process.platform !== "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callback-fixture-"));
  const script = path.resolve("runtime/scripts/wake-chat.ps1");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-ReconcileOnly", "-CallbackId", "bad/id"], { encoding: "utf8", cwd: process.cwd() });
  assert.match(output, /Invalid CallbackId|ERROR|NOT_FOUND/);
  fs.rmSync(dir, { recursive: true, force: true });
});
