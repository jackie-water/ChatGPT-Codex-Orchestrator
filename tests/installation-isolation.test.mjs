import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("installer prepares only the sandbox before sandbox verification",()=>{
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  const sandboxSetup=cli.indexOf('const setupSandbox=spawnSafeSync("powershell.exe"');
  const sandboxGate=cli.indexOf("if (!state.sandbox_verified)");
  const targetSetup=cli.indexOf('const setupTarget=spawnSafeSync("powershell.exe"');

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


test("generated control registry disables the real project until activation",()=>{
  const source=fs.readFileSync(new URL("../src/lib/control-env.mjs",import.meta.url),"utf8");
  const targetBlock=source.match(/const targetEntry=projectEntry\(\{[\s\S]*?\}\);/)?.[0]||"";
  const sandboxBlock=source.match(/const sandboxEntry=projectEntry\(\{[\s\S]*?\}\);/)?.[0]||"";
  assert.match(targetBlock,/enabled:false/);
  assert.match(sandboxBlock,/enabled:true/);
  assert.match(source,/export function activateTargetProject/);
});


test("setup requires ChatGPT access to generated private repos before Codex trust",()=>{
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  const authGate=cli.indexOf('action(state,"generated_repo_authorization"');
  const codexTrust=cli.indexOf('action(state,"codex_trust_sandbox"');
  assert.ok(authGate>=0,"generated repository authorization gate must exist");
  assert.ok(codexTrust>authGate,"generated repository authorization must occur before sandbox Codex trust");
  assert.match(cli,/repositories:\[state\.control_repository,state\.sandbox_repository\]/);
});


test("sandbox Chat registration happens before sandbox CODEX-RUN",()=>{
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  const registration=cli.indexOf('ensureInstallerChatRegistration(state,{projectKey:state.sandbox_project_key})');
  const smoke=cli.indexOf("startSandboxSmoke(state)");
  assert.ok(registration>=0,"sandbox registration must exist");
  assert.ok(smoke>registration,"sandbox CODEX-RUN must wait for explicit Chat registration");
  assert.match(cli,/state\.sandbox_review_route=sandboxRegistration\.route/);
});

test("real project Chat registration happens only after sandbox activation and before READY",()=>{
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  const sandboxGate=cli.indexOf("if (!state.sandbox_verified)");
  const targetActivation=cli.indexOf("activateTargetProject({");
  const targetRegistration=cli.indexOf('ensureInstallerChatRegistration(state,{projectKey:state.project_key})');
  const ready=cli.indexOf('state.current_step="ready"');
  assert.ok(targetActivation>sandboxGate,"target activation must remain after sandbox gate");
  assert.ok(targetRegistration>targetActivation,"target Chat registers only after sandbox completion/activation");
  assert.ok(ready>targetRegistration,"READY requires target Chat registration");
  assert.match(cli,/state\.target_review_route=targetRegistration\.route/);
});
