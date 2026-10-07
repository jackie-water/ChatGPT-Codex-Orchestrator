import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime=file=>fs.readFileSync(new URL("../runtime/scripts/"+file,import.meta.url),"utf8");

test("runtime context derives config and queues from instance metadata",()=>{
  const text=runtime("runtime-context.ps1");
  assert.match(text,/instance\.json/);
  assert.match(text,/\.chatgpt-codex-orchestrator\\instances/);
  assert.match(text,/Get-OrchestratorConfigPath/);
  assert.match(text,/Get-OrchestratorPendingWakeDir/);
  assert.match(text,/Get-OrchestratorChatRoutePath/);
});

test("runtime entrypoints do not read the old shared config path",()=>{
  for(const file of [
    "run-codex.ps1","run-code-review.ps1","merge-approved.ps1","preflight.ps1",
    "setup-project-clone.ps1","start-orchestrator-session.ps1","register-chat.ps1","wake-chat.ps1"
  ]){
    const text=runtime(file);
    assert.match(text,/runtime-context\.ps1/,file+" must load instance context");
    assert.doesNotMatch(text,/\.chatgpt-codex-orchestrator\\config\.ps1/,file+" must not use shared config");
  }
});

test("callback queues are scoped to the installation instance",()=>{
  const wake=runtime("wake-chat.ps1");
  const retry=runtime("retry-pending-callbacks.ps1");
  assert.match(wake,/Get-OrchestratorPendingWakeDir/);
  assert.match(retry,/Get-OrchestratorPendingWakeDir/);
  assert.match(retry,/Get-OrchestratorRetiredPendingWakeDir/);
});

test("control environment writes instance metadata and an instance-scoped config",()=>{
  const text=fs.readFileSync(new URL("../src/lib/control-env.mjs",import.meta.url),"utf8");
  assert.match(text,/writeInstanceMetadata/);
  assert.match(text,/path\.join\(configRoot,"instances",short\)/);
  assert.match(text,/browserPortForInstallation/);
  assert.match(text,/retireLegacyGlobalPending/);
});

test("installer launches the callback browser with its exact port and profile",()=>{
  const text=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  assert.match(text,/"-Port",String\(state\.browser_port\)/);
  assert.match(text,/"-ProfilePath",state\.browser_profile/);
});

test("runtime health counts only the current instance pending-wakes directory",()=>{
  const text=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  assert.match(text,/state\.instance_root\s*\n\s*\? path\.join\(state\.instance_root,"pending-wakes"\)/);
  assert.doesNotMatch(text,/path\.join\(os\.homedir\(\),"\.chatgpt-codex-orchestrator","pending-wakes"\)/);
  assert.match(text,/filter\(x=>x\.endsWith\("\.json"\)\)\.length/);
  assert.match(text,/checks\.pending_callbacks===0/);
});

test("runtime health has no queue fallback before instance setup",()=>{
  const text=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  assert.match(text,/const pendingDir=state\.instance_root[\s\S]*?: null;/);
  assert.match(text,/pendingDir&&fs\.existsSync\(pendingDir\)/);
  assert.match(text,/pending_callbacks:pendingCallbacks/);
  assert.match(text,/error_id:healthy\?null:"DOCTOR-001",recoverable:true/);
});
