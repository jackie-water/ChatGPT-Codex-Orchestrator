import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

test("Darwin resume uses isolated child-process evidence and remains idempotent",{skip:process.platform!=="darwin"},()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"codex-macos-p3-") );
  const home=path.join(root,"home"), bin=path.join(root,"bin"), stateDir=path.join(root,"state");
  fs.mkdirSync(home,{recursive:true,mode:0o700}); fs.mkdirSync(bin,{recursive:true,mode:0o700}); fs.mkdirSync(stateDir,{recursive:true,mode:0o700});
  const audit=path.join(root,"audit.log"), mode=path.join(root,"smoke-mode"); fs.writeFileSync(mode,"incomplete\n");
  const writeBin=(name,body)=>{const file=path.join(bin,name);fs.writeFileSync(file,"#!/bin/sh\nset -eu\nprintf '%s\\n' \"$0 $*\" >> "+JSON.stringify(audit)+"\n"+body+"\n",{mode:0o700});};
  writeBin("node",'case "${1-}" in --version) echo v22.0.0;; *) exit 0;; esac');
  writeBin("gh",'case "${1-}" in --version) echo gh-version;; auth) [ "${2-}" = status ];; api) [ "${2-}" = user ] && [ "${3-}" = --jq ] && [ "${4-}" = .login ] && echo owner;; issue) case "${2-}" in list) echo "[]";; create) echo "https://github.com/owner/control/issues/247";; esac;; *) exit 0;; esac');
  writeBin("codex",'case "${1-}" in --version) echo codex-version;; login) [ "${2-}" = status ];; *) exit 0;; esac');
  const sdk=path.join(root,"sdk"); fs.mkdirSync(path.join(sdk,"usr","include","sys"),{recursive:true,mode:0o700}); fs.writeFileSync(path.join(sdk,"usr","include","libproc.h"),"fixture\n",{mode:0o600}); fs.writeFileSync(path.join(sdk,"usr","include","sys","proc_info.h"),"fixture\n",{mode:0o600});
  writeBin("xcrun",'if [ "${1-}" = "--find" ]; then echo /usr/bin/clang; elif [ "${3-}" = "--show-sdk-path" ]; then echo '+JSON.stringify(sdk)+'; else out=""; for arg in "$@"; do if [ "$arg" = "-o" ]; then shift; out="${1-}"; break; fi; shift; done; cat > "$out" <<\'EOF\'\n#!/bin/sh\nprintf \'{"status":"OK","pid":%s,"start_sec":1,"start_usec":2}\\n\' "$1"\nEOF\nchmod 700 "$out"; fi');
  writeBin("launchctl",'case "${1-}" in list) exit 0;; *) exit 1;; esac');
  writeBin("git","case \"${1-}\" in --version) echo git-version;; fetch) exit 0;; rev-parse) case \"$*\" in *origin/test/install-smoke-fixture2*) exit 1;; *) exit 0;; esac;; show) if grep -qx complete "+JSON.stringify(mode)+"; then echo ready-evidence >> "+JSON.stringify(audit)+"; echo 'export const status = \"ready\";'; else echo 'export const status = \"not-ready\";'; fi;; *) exit 0;; esac");
  const installation="fixture-22A1", short="fixture2", sandboxProject="sandbox-"+short, chat="https://chatgpt.com/c/chat-232";
  const routeFile=path.join(home,"routes.json"); fs.writeFileSync(routeFile,JSON.stringify({version:1,routes:[{route:"chat-232",project:sandboxProject,chat_url:chat,status:"active",registration_issue:230}]}));
  const stateFile=path.join(stateDir,"install-state.json");
  const base={schema_version:1,preferred_language:"en",completed:[],installation_id:installation,github_login:"owner",macos_setup_approved:true,github_plugin_authorized:true,target_repository:"organization/target",reviewer_chat_url:chat+"/",control_environment_ready:true,control_repository:"owner/control",sandbox_repository:"owner/sandbox",sandbox_project_key:sandboxProject,github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:installation,github_plugin_authorization_control_repository:"owner/control",github_plugin_authorization_sandbox_repository:"owner/sandbox",github_plugin_authorization_chat_url:chat+"/",chat_route_file:routeFile,sandbox_clone_path:path.join(home,"sandbox"),sandbox_review_route:"chat-232",sandbox_verified:false,target_environment_ready:false,runner_label:"runner-fixture",sandbox_smoke_started:false};
  fs.mkdirSync(base.sandbox_clone_path,{recursive:true});
  const run=()=>spawnSync(process.execPath,[path.resolve("src/cli.mjs"),"resume","--json"],{cwd:root,env:{...process.env,HOME:home,PATH:bin+path.delimiter+process.env.PATH,ORCHESTRATOR_TEST_XCRUN:path.join(bin,"xcrun"),CHATGPT_CODEX_ORCHESTRATOR_HOME:stateDir},encoding:"utf8"});
  const save=state=>fs.writeFileSync(stateFile,JSON.stringify(state));
  const read=()=>JSON.parse(fs.readFileSync(stateFile,"utf8"));
  try {
    save(base); let result=run(), state=read(); assert.equal(JSON.parse(result.stdout).action_id,"sandbox_verification"); assert.equal(state.target_environment_ready,false); assert.equal(state.sandbox_smoke_started,true); assert.equal(state.sandbox_smoke_issue,"https://github.com/owner/control/issues/247");
    save({...state,sandbox_verified:true}); result=run(); state=read(); assert.equal(JSON.parse(result.stdout).action_id,"sandbox_verification"); assert.equal(state.target_environment_ready,false);
    fs.writeFileSync(mode,"complete\n"); save({...base,sandbox_verified:false,sandbox_smoke_started:true,sandbox_smoke_issue:"https://github.com/owner/control/issues/247"}); result=run(); state=read(); assert.equal(JSON.parse(result.stdout).action_id,"sandbox_verification"); assert.equal(state.macos_native_setup,"SANDBOX_READY"); assert.equal(state.target_environment_ready,false);
    const waitingAt=state.last_error?.at; result=run(); state=read(); assert.equal(JSON.parse(result.stdout).action_id,"sandbox_verification"); assert.equal(state.macos_native_setup,"SANDBOX_READY"); assert.equal(state.last_error?.at,waitingAt); assert.equal(state.target_environment_ready,false);
    const log=fs.readFileSync(audit,"utf8"); const commands=log.split(/\r?\n/).filter(Boolean); assert.ok(log.includes("git show origin/main:src/status.mjs")); assert.ok(log.includes("ready-evidence")); assert.equal(commands.filter(line=>/(?:^|\/)gh(?:\s|$).*\bissue\s+create\b/.test(line)).length,1); assert.equal(commands.some(line=>/(?:^|\/)git\s+(?:commit|push)(?:\s|$)/.test(line)),false); assert.equal(commands.some(line=>/(?:^|\/)launchctl(?:\s|$).*(?:\bbootstrap\b|\bbootout\b)/.test(line)),false); assert.equal(commands.some(line=>/(?:^|\/)powershell(?:\.exe)?(?:\s|$)/i.test(line)),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("Sandbox first boot creates one exact CODEX-RUN and resume reuses its URL",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"codex-sandbox-smoke-"));
  const home=path.join(root,"home"),bin=path.join(root,"bin"),log=path.join(root,"gh.log"),listing=path.join(root,"listing.json"),bodyFile=path.join(root,"body.json");
  fs.mkdirSync(home,{recursive:true}); fs.mkdirSync(bin,{recursive:true});
  const installation="fixture-22A1", project="sandbox-fixture2", routeFile=path.join(home,"routes.json");
  fs.writeFileSync(routeFile,JSON.stringify({routes:[{project,route:"chat-232",chat_url:"https://chatgpt.com/c/chat-232",status:"active",installation_id:installation}]}));
  fs.writeFileSync(listing,"[]\n");
  fs.writeFileSync(path.join(bin,"gh"),`#!/bin/sh
set -eu
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = issue ] && [ "$2" = list ]; then cat ${JSON.stringify(listing)}; exit 0; fi
if [ "$1" = issue ] && [ "$2" = create ]; then
  last=""; for arg in "$@"; do last="$arg"; done
  printf '%s' "$last" > ${JSON.stringify(bodyFile)}
  printf 'https://github.com/owner/control/issues/247\\n'; exit 0
fi
exit 97
`,{mode:0o700});
  const oldPath=process.env.PATH,oldHome=process.env.HOME; process.env.PATH=bin+path.delimiter+oldPath; process.env.HOME=home;
  const state={installation_id:installation,github_login:"owner",control_repository:"owner/control",sandbox_repository:"owner/sandbox",sandbox_project_key:project,sandbox_review_route:"chat-232",sandbox_clone_path:path.join(home,"sandbox")};
  fs.mkdirSync(state.sandbox_clone_path);
  const body=()=>JSON.parse(fs.readFileSync(bodyFile,"utf8"));
  try {
    const first=startSandboxSmoke(state); assert.equal(first.created,true); assert.equal(first.issue.url,"https://github.com/owner/control/issues/247");
    const sent=body(); assert.deepEqual({project:sent.project,target_repo:sent.target_repo,review_route:sent.review_route,installation_id:sent.installation_smoke.installation_id},{project,target_repo:"owner/sandbox",review_route:"chat-232",installation_id:installation});
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
  const base={installation_id:"fixture-22A1",github_login:"owner",control_repository:"owner/control",sandbox_repository:"owner/sandbox",sandbox_project_key:"sandbox-fixture2",sandbox_review_route:"chat-232"};
  try {
    assert.throws(()=>startSandboxSmoke({...base,sandbox_review_route:""}),/route/);
    fs.writeFileSync(listing,"not-json\n"); assert.throws(()=>startSandboxSmoke(base),/malformed/);
    fs.writeFileSync(listing,JSON.stringify([{title:"[CODEX-RUN] INSTALL-SMOKE-fixture2 sandbox ready-state",body:JSON.stringify({project:base.sandbox_project_key,repository:base.sandbox_repository,target_repo:base.sandbox_repository,target_branch:smokeBranch(base.installation_id),iteration:2,max_iterations:5,review_route:base.sandbox_review_route,installation_smoke:{installation_id:base.installation_id,marker:"INSTALL-SMOKE-fixture2"}}),author:{login:"attacker",is_bot:false}}]));
    assert.throws(()=>startSandboxSmoke(base),/identity/); assert.doesNotMatch(fs.readFileSync(log,"utf8"),/issue create/);
  } finally { process.env.PATH=oldPath; fs.rmSync(root,{recursive:true,force:true}); }
});
