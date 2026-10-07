import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pendingCallbackCount, doctorHealth, repairHealth } from "../src/lib/runtime-health.mjs";

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

test("runtime health counts only JSON files in the current instance pending-wakes directory",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"runtime-health-"));
  const instance=path.join(root,"instance");
  const pending=path.join(instance,"pending-wakes");
  const shared=path.join(root,"home",".chatgpt-codex-orchestrator","pending-wakes");
  fs.mkdirSync(pending,{recursive:true});
  fs.mkdirSync(shared,{recursive:true});
  for(const name of ["one.json","two.json","three.json"]) fs.writeFileSync(path.join(pending,name),"{}");
  fs.writeFileSync(path.join(pending,"ignored.txt"),"{}");
  fs.writeFileSync(path.join(shared,"sentinel.json"),"{}");
  assert.equal(pendingCallbackCount({instance_root:instance}),3);
});

test("runtime health does not scan the shared queue before instance setup",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"runtime-health-"));
  const shared=path.join(root,"home",".chatgpt-codex-orchestrator","pending-wakes");
  fs.mkdirSync(shared,{recursive:true});
  fs.writeFileSync(path.join(shared,"sentinel.json"),"{}");
  assert.equal(pendingCallbackCount({instance_root:""}),0);
  assert.equal(pendingCallbackCount({}),0);
});

test("doctor health passes with no pending callbacks and errors when callbacks are pending",()=>{
  const checks={control_repository:true,control_clone:true,project_clone:true,pending_callbacks:0};
  assert.deepEqual(doctorHealth(checks),{healthy:true,status:"PASS",error_id:null,recoverable:true});
  assert.deepEqual(doctorHealth({...checks,pending_callbacks:2}),{healthy:false,status:"ERROR",error_id:"DOCTOR-001",recoverable:true});
});

test("repair health passes only when pending callbacks are resolved",()=>{
  const pass=repairHealth({pending_callbacks:0});
  assert.equal(pass.status,"PASS");
  assert.equal(pass.error_id,null);
  assert.ok(pass.repaired.includes("pending_callbacks"));

  const unresolved=repairHealth({pending_callbacks:2});
  assert.deepEqual(unresolved,{status:"ERROR",error_id:"REPAIR-001",recoverable:true,
    message:"Unresolved pending callbacks remain after safe retry/reconciliation and require separate resolution.",
    repaired:["runner","reviewer_browser","preflight"]});
  assert.ok(!unresolved.repaired.includes("pending_callbacks"));
});
