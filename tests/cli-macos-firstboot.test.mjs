import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import {canonicalInstallationId} from "../src/lib/control-render.mjs";

const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
const helpers=cli.slice(cli.indexOf("function macosRunnerActionChallenge("),cli.indexOf("function dryRun()"));

function fixture(t){
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"macos-firstboot-synthetic-"));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const state={installation_id:"abcd1234-test",instance_id:"abcd1234",instance_root:path.join(home,".chatgpt-codex-orchestrator","instances","abcd1234"),control_repository:"owner/chatgpt-codex-orchestrator-control-abcd1234",control_repository_id:"101",sandbox_repository:"owner/chatgpt-codex-orchestrator-sandbox-abcd1234",sandbox_repository_id:"202",sandbox_project_key:"sandbox-abcd1234",runner_label:"codex-orchestrator-abcd1234",browser_profile:path.join(home,"profile"),browser_port:19432,pending_wake_outbox:path.join(home,"outbox")};
  const runner={status:"PASS",runner_id:"303",runner_executable:path.join(state.instance_root,"runner","bin","Runner.Listener"),approval_sha256:"a".repeat(64)};
  const calls=[],snapshots=[];
  const settings={online:false,fail:null,plist:true};
  const context=vm.createContext({crypto,os,fs,path,process,canonicalInstallationId,inspectMacosRunnerBootstrap:()=>{throw Error("No real inspector in synthetic test");},macosRuntimeAction:()=>{throw Error("No real service in synthetic test");},saveState:()=>{throw Error("No real installer state in synthetic test");}});
  vm.runInContext(helpers+"\nthis.advance=advanceMacosFirstBootRunner;this.challenge=macosRunnerActionChallenge;this.claim=claimMacosFirstBootOperation;",context);
  const inspect=({requireOnline})=>{calls.push(requireOnline?"inspect-online":"inspect-package");return requireOnline&&!settings.online?{status:"NEEDS_USER_ACTION",error_id:"MACOS-RUNNER-OFFLINE"}:{...runner};};
  const runtime=(operation,{state:actual})=>{
    calls.push(operation);
    if(operation!=="status"){
      assert.equal(actual.macos_action_approval,operation);
      assert.equal(state.macos_runner_action_approval,undefined,"approval consumed before service operation");
      assert.equal(snapshots.at(-1).macos_runner_bootstrap.phase,operation==="install"?"INSTALL_INTENT":"START_INTENT");
    }
    if(settings.fail===operation) return {status:"ERROR",error_id:"SYNTHETIC-INTERRUPTION",mutations_performed:"UNKNOWN"};
    return {status:"PASS",launchctl_state:"loaded",plist_verified:settings.plist,mutations_performed:operation!=="status"};
  };
  return {home,state,runner,calls,snapshots,settings,claim:action=>context.claim({state,action,challenge:context.challenge(action,state,runner),home}),challenge:op=>context.challenge(op,state,runner),advance:()=>context.advance(state,{home,inspect,runtime,claim:()=>({status:"OWNED"}),persist:state=>snapshots.push(JSON.parse(JSON.stringify(state)))})};
}

test("first boot separately approves install/start then waits for a real matching online Runner",t=>{
  const f=fixture(t);
  let result=f.advance();
  assert.equal(result.action_id,"macos_runner_install");
  assert.equal(f.calls.includes("install"),false);
  f.state.macos_runner_action_approval=result.approval_challenge;
  result=f.advance();
  assert.equal(result.action_id,"macos_runner_start");
  assert.equal(f.state.macos_runner_bootstrap.phase,"PLIST_INSTALLED");
  assert.equal(f.calls.includes("start"),false);
  f.state.macos_runner_action_approval=result.approval_challenge;
  result=f.advance();
  assert.equal(result.status,"WAITING");
  assert.equal(result.action_id,"macos_runner_online");
  assert.equal(f.state.macos_runner_bootstrap.phase,"STARTED");
  f.settings.online=true;
  result=f.advance();
  assert.equal(result.status,"READY");
  assert.equal(f.calls.filter(x=>x==="install").length,1);
  assert.equal(f.calls.filter(x=>x==="start").length,1);
  assert.equal(f.state.sandbox_review_route,undefined,"registration does not need its own preexisting Chat route");
});

test("ambiguous service action preserves its journal and cannot automatically repeat",t=>{
  const f=fixture(t);
  f.state.macos_runner_action_approval=f.challenge("install");
  f.settings.fail="install";
  assert.equal(f.advance().recovery_status,"MANUAL_RECOVERY_REQUIRED");
  assert.equal(f.state.macos_runner_bootstrap.phase,"ERROR");
  f.settings.fail=null;
  f.state.macos_runner_action_approval=f.challenge("install");
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-INTERRUPTED");
  assert.equal(f.calls.filter(x=>x==="install").length,1);
});

test("one-time operation claims cannot be shared or reclaimed by a second resume",t=>{
  const f=fixture(t);
  fs.mkdirSync(f.state.instance_root,{recursive:true,mode:0o700});
  const first=f.claim("install");
  assert.equal(first.status,"OWNED");
  const bytes=fs.readFileSync(first.path);
  assert.equal(f.claim("install").error_id,"MACOS-FIRST-BOOT-ALREADY-CLAIMED");
  assert.deepEqual(fs.readFileSync(first.path),bytes);
  assert.equal(f.claim("start").status,"OWNED","start has a distinct separately approved operation claim");
  assert.equal(f.calls.includes("install"),false);
});

test("boolean approvals, changed package/IDs, and bogus loaded-plist claims fail closed",t=>{
  const f=fixture(t);
  f.state.macos_runner_action_approval=true;
  assert.equal(f.advance().action_id,"macos_runner_install");
  f.state.macos_runner_action_approval=f.challenge("install");
  f.advance();
  f.runner.approval_sha256="b".repeat(64);
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-IDENTITY");
  f.runner.approval_sha256="a".repeat(64);
  f.state.macos_runner_action_approval=f.challenge("start");
  f.settings.online=true;f.settings.plist=false;
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-SERVICE");
  f.state.control_repository_id="999";
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-IDENTITY");
});

test("official macOS installer orders all identity and native gates before first registration",()=>{
  const begin=cli.indexOf("function runSetup() {");
  const end=cli.indexOf("\n  state.installation_id ||= crypto.randomUUID();",begin);
  const mac=cli.slice(begin,end);
  const registration=mac.indexOf("registration=ensureInstallerChatRegistration");
  for(const gate of ["github_plugin_authorization_verified!==true","verifyMacosGeneratedRepositories({state})","prepareMacosNativeHelper({state","if(!state.codex_trust_sandbox)","if(!state.reviewer_browser_ready)","const runnerBootstrap=advanceMacosFirstBootRunner(state)","runnerBootstrap.status!==\"READY\""]){
    assert.ok(mac.indexOf(gate)>=0&&mac.indexOf(gate)<registration,gate);
  }
  assert.doesNotMatch(mac,/activateTargetProject\(/);
  assert.match(mac,/MACOS-POST-SANDBOX-UNSUPPORTED/);
  const windows=cli.slice(end,cli.indexOf("function codexLogin()",end));
  assert.match(windows,/scripts","install-runner\.ps1/);
  assert.doesNotMatch(windows,/advanceMacosFirstBootRunner|macos_runner_package_approval/);
});

test("only independently approved fresh identity can await its first route without legacy adoption",()=>{
  const start=cli.indexOf("function macosSelectedAwaitingFirstRoute(");
  const end=cli.indexOf("function macosTrustedRecoveryEvidence(",start);
  const context=vm.createContext({});
  vm.runInContext(cli.slice(start,end)+"\nthis.awaiting=macosSelectedAwaitingFirstRoute;",context);
  const approved={status:"SELECTED_FRESH_INSTANCE_VERIFIED",route_count:0};
  assert.equal(context.awaiting({},approved),true);
  assert.equal(context.awaiting({}, {...approved,status:"NEEDS_USER_ACTION"}),false);
  assert.equal(context.awaiting({}, {...approved,status:"NEEDS_VERIFICATION"}),false);
  assert.equal(context.awaiting({}, {...approved,route_count:1}),false);
  assert.equal(context.awaiting({}, {...approved,route_count:1,first_route_pending:true}),true);
  assert.equal(context.awaiting({sandbox_review_route:"chat-408"},approved),false);
});
