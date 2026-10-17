import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
  writeBin("gh",'case "${1-}" in --version) echo gh-version;; auth) [ "${2-}" = status ];; api) [ "${2-}" = user ] && [ "${3-}" = --jq ] && [ "${4-}" = .login ] && echo owner;; *) exit 0;; esac');
  writeBin("codex",'case "${1-}" in --version) echo codex-version;; login) [ "${2-}" = status ];; *) exit 0;; esac');
  writeBin("launchctl",'case "${1-}" in list) exit 0;; *) exit 1;; esac');
  writeBin("git","case \"${1-}\" in --version) echo git-version;; fetch) exit 0;; show) if grep -qx complete "+JSON.stringify(mode)+"; then echo ready-evidence >> "+JSON.stringify(audit)+"; echo 'export const status = \"ready\";'; else echo 'export const status = \"not-ready\";'; fi;; *) exit 0;; esac");
  const installation="fixture-22A1", short="fixture2", sandboxProject="sandbox-"+short, chat="https://chatgpt.com/c/chat-212";
  const routeFile=path.join(home,"routes.json"); fs.writeFileSync(routeFile,JSON.stringify({version:1,routes:[{route:"chat-212",project:sandboxProject,chat_url:chat,status:"active",registration_issue:230}]}));
  const stateFile=path.join(stateDir,"install-state.json");
  const base={schema_version:1,preferred_language:"en",completed:[],installation_id:installation,github_login:"owner",macos_setup_approved:true,github_plugin_authorized:true,target_repository:"organization/target",reviewer_chat_url:chat+"/",control_environment_ready:true,control_repository:"owner/control",sandbox_repository:"owner/sandbox",sandbox_project_key:sandboxProject,github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:installation,github_plugin_authorization_control_repository:"owner/control",github_plugin_authorization_sandbox_repository:"owner/sandbox",github_plugin_authorization_chat_url:chat+"/",chat_route_file:routeFile,sandbox_clone_path:path.join(home,"sandbox"),sandbox_review_route:"chat-212",sandbox_verified:false,target_environment_ready:false,runner_label:"runner-fixture",sandbox_smoke_started:true};
  fs.mkdirSync(base.sandbox_clone_path,{recursive:true});
  const run=()=>spawnSync(process.execPath,[path.resolve("src/cli.mjs"),"resume","--json"],{cwd:root,env:{...process.env,HOME:home,PATH:bin+path.delimiter+process.env.PATH,CHATGPT_CODEX_ORCHESTRATOR_HOME:stateDir},encoding:"utf8"});
  const save=state=>fs.writeFileSync(stateFile,JSON.stringify(state));
  const read=()=>JSON.parse(fs.readFileSync(stateFile,"utf8"));
  try {
    save(base); let result=run(), state=read(); assert.equal(JSON.parse(result.stdout).action_id,"sandbox_verification"); assert.equal(state.target_environment_ready,false);
    save({...base,sandbox_verified:true}); result=run(); state=read(); assert.equal(JSON.parse(result.stdout).action_id,"sandbox_verification"); assert.equal(state.target_environment_ready,false);
    fs.writeFileSync(mode,"complete\n"); save({...base,sandbox_verified:false}); result=run(); state=read(); assert.equal(JSON.parse(result.stdout).action_id,"sandbox_verification"); assert.equal(state.macos_native_setup,"SANDBOX_READY"); assert.equal(state.target_environment_ready,false);
    const waitingAt=state.last_error?.at; result=run(); state=read(); assert.equal(JSON.parse(result.stdout).action_id,"sandbox_verification"); assert.equal(state.macos_native_setup,"SANDBOX_READY"); assert.equal(state.last_error?.at,waitingAt); assert.equal(state.target_environment_ready,false);
    const log=fs.readFileSync(audit,"utf8"); const commands=log.split(/\r?\n/).filter(Boolean); assert.ok(log.includes("git show origin/main:src/status.mjs")); assert.ok(log.includes("ready-evidence")); assert.equal(commands.some(line=>/(?:^|\/)gh(?:\s|$).*\bissue\s+create\b/.test(line)),false); assert.equal(commands.some(line=>/(?:^|\/)git\s+(?:commit|push)(?:\s|$)/.test(line)),false); assert.equal(commands.some(line=>/(?:^|\/)launchctl(?:\s|$).*(?:\bbootstrap\b|\bbootout\b)/.test(line)),false); assert.equal(commands.some(line=>/(?:^|\/)powershell(?:\.exe)?(?:\s|$)/i.test(line)),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
