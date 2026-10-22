import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { startSandboxSmoke, smokeBranch } from "../src/lib/sandbox-smoke.mjs";

const cli=fs.readFileSync("src/cli.mjs","utf8");
const functionStart=cli.indexOf("function runSetup() {");
const darwinStart=cli.indexOf('if(process.platform==="darwin")',functionStart);
const windowsStart=cli.indexOf('\n  state.installation_id ||= crypto.randomUUID();',darwinStart);
assert.ok(functionStart>=0);
assert.ok(darwinStart>functionStart);
assert.ok(windowsStart>darwinStart);
const mac=cli.slice(functionStart,windowsStart);

test("Darwin resume requires same-installation independent Sandbox completion",()=>{
  assert.match(mac,/sandboxSmokeStatus\(state,\{strict:process\.platform===\"darwin\"\}\)/);
  assert.match(mac,/smoke\?\.status==="PASS" && smoke\?\.stage==="COMPLETE"/);
  assert.match(mac,/smoke\?\.branch===`test\/install-smoke-\$\{shortId\}`/);
  assert.ok(mac.indexOf("sandboxSmokeStatus(state,{strict:process.platform===\"darwin\"})")>mac.indexOf("ensureInstallerChatRegistration"));
  assert.ok(mac.indexOf("const sameInstanceComplete=")>mac.indexOf("sandboxSmokeStatus(state,{strict:process.platform===\"darwin\"})"));
  assert.match(mac,/macos_native_setup="SANDBOX_VERIFIED"/);
  assert.match(mac,/action\(state,"codex_trust_project"/);
  assert.match(mac,/!Object\.hasOwn\(registered\|\|\{\},"installation_id"\)/);
  assert.match(mac,/registered\.status!=="active"/);
  assert.doesNotMatch(mac,/target_environment_ready\s*=\s*true/);
  assert.doesNotMatch(mac,/target_registry_activated\s*=\s*true/);
});

test("Darwin resume does not treat sandbox_verified alone as evidence",()=>{
  const gate=mac.indexOf("const sameInstanceComplete=");
  assert.ok(gate>0);
  assert.doesNotMatch(mac.slice(0,gate),/if\s*\(state\.sandbox_verified\)/);
  assert.match(mac,/action_id:"sandbox_verification"/);
});

test("Darwin resume admits only freshly verified trusted recovery evidence",()=>{
  assert.match(mac,/trustedEvidence\.status!=="NEEDS_HUMAN_LEGACY" && trustedEvidence\.status!=="VERIFIED"/);
  assert.doesNotMatch(mac,/trusted_recovery_evidence_status\s*===\s*"VERIFIED"/);
});

test("Darwin native preparation errors report partial or unknown mutation state",()=>{
  assert.match(mac,/recovery_status:"MANUAL_RECOVERY_REQUIRED"/);
  assert.match(mac,/partial_mutation:true/);
  assert.match(mac,/mutations_performed:nativePrepared\.mutations_performed\?\?"UNKNOWN"/);
});

test("Darwin first boot remains blocked and idempotent without an independently approved Runner",()=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"codex-macos-p3-synthetic-"));
  const home=path.join(root,"home");fs.mkdirSync(home,{mode:0o700});
  const historical=path.join(home,".chatgpt-codex-orchestrator","instances","1832f0bb");
  fs.mkdirSync(historical,{recursive:true,mode:0o700});
  const legacy=path.join(historical,"legacy.json");fs.writeFileSync(legacy,"historical bytes must stay unchanged",{mode:0o644});
  const previousBytes=fs.readFileSync(legacy),previousMode=fs.statSync(legacy).mode;
  const helperStart=cli.indexOf("function macosRunnerActionChallenge(");
  const helperEnd=cli.indexOf("function dryRun()",helperStart);
  assert.ok(helperStart>=0&&helperEnd>helperStart);
  const unexpected=()=>assert.fail("synthetic first boot cannot compile helpers, start services, publish issues or invoke Codex");
  const context=vm.createContext({crypto,os,inspectMacosRunnerBootstrap:unexpected,macosRuntimeAction:unexpected,saveState:unexpected});
  vm.runInContext(cli.slice(helperStart,helperEnd)+"\nthis.advance=advanceMacosFirstBootRunner;",context);
  const state={installation_id:"fixture-22A1",instance_id:"fixture2",instance_root:path.join(home,".chatgpt-codex-orchestrator","instances","fixture2"),
    control_repository:"owner/chatgpt-codex-orchestrator-control-fixture2",control_repository_id:"101",sandbox_repository:"owner/chatgpt-codex-orchestrator-sandbox-fixture2",sandbox_repository_id:"202",
    sandbox_project_key:"sandbox-fixture2",sandbox_verified:true,sandbox_smoke_started:false,target_environment_ready:false,runner_label:"codex-orchestrator-fixture2",
    browser_profile:path.join(home,"profile"),browser_port:19333,pending_wake_outbox:path.join(home,"pending"),macos_runner_approved:true,macos_runner_action_approval:true};
  const before=JSON.stringify(state);
  try {
    for(const error_id of ["MACOS-RUNNER-PROVISIONING-REQUIRED","MACOS-RUNNER-APPROVAL"]){
      const inspect=()=>({status:"NEEDS_USER_ACTION",error_id,mutations_performed:false});
      for(let attempt=0;attempt<2;attempt++){
        const result=context.advance(state,{home,inspect,runtime:unexpected,persist:unexpected});
        assert.equal(result.status,"NEEDS_USER_ACTION");assert.equal(result.action_id,"provision_macos_runner");assert.equal(result.error_id,error_id);
        assert.equal(JSON.stringify(state),before);assert.equal(state.target_environment_ready,false);assert.equal(state.sandbox_smoke_started,false);
      }
    }
    const inspect=({requireApproval=true})=>requireApproval?{status:"NEEDS_USER_ACTION",error_id:"MACOS-RUNNER-PROVISIONING-REQUIRED"}:
      {status:"NEEDS_USER_ACTION",action_id:"macos_runner_package_approval",approval_challenge:"package:exact-human-approved-identity",mutations_performed:false};
    const precise=context.advance(state,{home,inspect,runtime:unexpected,persist:unexpected});
    assert.equal(precise.action_id,"macos_runner_package_approval");assert.equal(JSON.stringify(state),before);
    assert.deepEqual(fs.readFileSync(legacy),previousBytes);assert.equal(fs.statSync(legacy).mode,previousMode);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("Sandbox first boot creates one exact CODEX-RUN and resume reuses its URL",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"codex-sandbox-smoke-"));
  const home=path.join(root,"home"),bin=path.join(root,"bin"),log=path.join(root,"gh.log"),listing=path.join(root,"listing.json"),bodyFile=path.join(root,"body.json");
  fs.mkdirSync(home,{recursive:true}); fs.mkdirSync(bin,{recursive:true});
  const installation="fixture-22A1", short="fixture2", project="sandbox-"+short, controlRepository=`owner/chatgpt-codex-orchestrator-control-${short}`, sandboxRepository=`owner/chatgpt-codex-orchestrator-sandbox-${short}`, routeFile=path.join(home,"routes.json");
  fs.writeFileSync(routeFile,JSON.stringify({routes:[{project,route:"chat-232",chat_url:"https://chatgpt.com/c/chat-232",status:"active",installation_id:installation}]}));
  fs.writeFileSync(listing,"[]\n");
  fs.writeFileSync(path.join(bin,"gh"),`#!/bin/sh
set -eu
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = issue ] && [ "$2" = list ]; then cat ${JSON.stringify(listing)}; exit 0; fi
if [ "$1" = issue ] && [ "$2" = create ]; then
  last=""; for arg in "$@"; do last="$arg"; done
  printf '%s' "$last" > ${JSON.stringify(bodyFile)}
  printf 'https://github.com/${controlRepository}/issues/247\\n'; exit 0
fi
exit 97
`,{mode:0o700});
  const oldPath=process.env.PATH,oldHome=process.env.HOME; process.env.PATH=bin+path.delimiter+oldPath; process.env.HOME=home;
  const state={installation_id:installation,github_login:"owner",control_repository:controlRepository,sandbox_repository:sandboxRepository,sandbox_project_key:project,sandbox_review_route:"chat-232",sandbox_clone_path:path.join(home,"sandbox")};
  fs.mkdirSync(state.sandbox_clone_path);
  const body=()=>JSON.parse(fs.readFileSync(bodyFile,"utf8"));
  try {
    const first=startSandboxSmoke(state); assert.equal(first.created,true); assert.equal(first.issue.url,`https://github.com/${controlRepository}/issues/247`);
    const sent=body(); assert.deepEqual({project:sent.project,target_repo:sent.target_repo,review_route:sent.review_route,installation_id:sent.installation_smoke.installation_id},{project,target_repo:sandboxRepository,review_route:"chat-232",installation_id:installation});
    assert.equal(sent.iteration,1); assert.equal(sent.max_iterations,5); assert.equal(sent.target_branch,smokeBranch(installation));
    const exact={number:247,title:"[CODEX-RUN] INSTALL-SMOKE-fixture2 sandbox ready-state",state:"OPEN",url:first.issue.url,body:JSON.stringify(sent),author:{login:"owner",is_bot:false}};
    fs.writeFileSync(listing,JSON.stringify([exact])); const second=startSandboxSmoke(state); assert.equal(second.created,false); assert.equal(second.issue.url,first.issue.url);
    const creates=fs.readFileSync(log,"utf8").split(/\n/).filter(x=>x.includes("issue create")); assert.equal(creates.length,1);
  } finally { process.env.PATH=oldPath; process.env.HOME=oldHome; fs.rmSync(root,{recursive:true,force:true}); }
});

test("Sandbox smoke creation fails closed for route, gh listing, and issue identity gaps",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"codex-sandbox-smoke-negative-")); const bin=path.join(root,"bin"),listing=path.join(root,"listing"),log=path.join(root,"log"); fs.mkdirSync(bin); fs.writeFileSync(listing,"[]\n");
  fs.writeFileSync(path.join(bin,"gh"),`#!/bin/sh
set -eu
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = issue ] && [ "$2" = list ]; then cat ${JSON.stringify(listing)}; exit 0; fi
exit 97
`,{mode:0o700});
  const oldPath=process.env.PATH; process.env.PATH=bin+path.delimiter+oldPath;
  const installation="fixture-22A1", short="fixture2", controlRepository=`owner/chatgpt-codex-orchestrator-control-${short}`, sandboxRepository=`owner/chatgpt-codex-orchestrator-sandbox-${short}`, base={installation_id:installation,github_login:"owner",control_repository:controlRepository,sandbox_repository:sandboxRepository,sandbox_project_key:`sandbox-${short}`,sandbox_review_route:"chat-232"};
  try {
    assert.throws(()=>startSandboxSmoke({...base,sandbox_review_route:""}),/route/);
    fs.writeFileSync(listing,"not-json\n"); assert.throws(()=>startSandboxSmoke(base),/malformed/);
    fs.writeFileSync(listing,JSON.stringify([{title:"[CODEX-RUN] INSTALL-SMOKE-fixture2 sandbox ready-state",body:JSON.stringify({project:base.sandbox_project_key,repository:base.sandbox_repository,target_repo:base.sandbox_repository,target_branch:smokeBranch(base.installation_id),iteration:2,max_iterations:5,review_route:base.sandbox_review_route,installation_smoke:{installation_id:base.installation_id,marker:"INSTALL-SMOKE-fixture2"}}),author:{login:"attacker",is_bot:false}}]));
    assert.throws(()=>startSandboxSmoke(base),/identity/); assert.doesNotMatch(fs.readFileSync(log,"utf8"),/issue create/);
  } finally { process.env.PATH=oldPath; fs.rmSync(root,{recursive:true,force:true}); }
});
