import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("installer prepares only the sandbox before sandbox verification",()=>{
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  const sandboxSetup=cli.indexOf('const setupSandbox=spawnSync("powershell.exe"');
  const sandboxGate=cli.indexOf("if (!state.sandbox_verified)");
  const targetSetup=cli.indexOf('const setupTarget=spawnSync("powershell.exe"');

  assert.ok(sandboxSetup>=0,"sandbox setup call should exist");
  assert.ok(sandboxGate>sandboxSetup,"sandbox verification must happen after sandbox runtime setup");
  assert.ok(targetSetup>sandboxGate,"real project setup must occur only after sandbox verification logic");
  assert.doesNotMatch(
    cli.slice(0,sandboxGate),
    /setup-project-clone\.ps1"[\s\S]{0,300}-Project",\s*control\.project_key/,
    "real project checkpoint setup must not run before sandbox verification"
  );
});

test("all remote execution entrypoints block disabled projects",()=>{
  for(const path of [
    "runtime/scripts/run-codex.ps1",
    "runtime/scripts/run-code-review.ps1",
    "runtime/scripts/merge-approved.ps1",
    "runtime/scripts/setup-project-clone.ps1",
    "runtime/scripts/preflight.ps1"
  ]){
    const text=fs.readFileSync(new URL("../"+path,import.meta.url),"utf8");
    assert.match(text,/PROJECT_DISABLED/,path+" must enforce the activation gate");
  }
});
