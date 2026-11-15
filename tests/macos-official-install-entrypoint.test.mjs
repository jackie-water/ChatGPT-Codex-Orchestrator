import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

function fake(t){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"g304 shell entry spaces "));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bin=path.join(root,"fake-bin");fs.mkdirSync(bin);
  const actualNode=process.execPath;
  const app=path.join(root,"official project with spaces");fs.mkdirSync(app);
  const original=fs.readFileSync(new URL("../install.sh",import.meta.url));
  fs.writeFileSync(path.join(app,"install.sh"),original,{mode:0o755});
  const callLog=path.join(root,"calls.log");
  const shim=`#!/bin/bash
if [[ "$1" == "-e" ]]; then exec ${JSON.stringify(actualNode)} "$@"; fi
printf '%s|%s|%s\n' "$PWD" "$2" "${'$'}*" >> "${callLog}"
if [[ "$2" == "dry-run" ]]; then printf '%s\n' "$FAKE_PREFLIGHT_JSON"; exit "$FAKE_PREFLIGHT_EXIT"; fi
printf '%s\n' '{"status":"NEEDS_USER_ACTION","action_id":"generated_repo_authorization","mutations_performed":false}'
exit 1
`;
  fs.writeFileSync(path.join(bin,"node"),shim,{mode:0o755});
  fs.writeFileSync(path.join(bin,"uname"),'#!/bin/sh\necho Darwin\n',{mode:0o755});
  function invoke({result={status:"PASS",dry_run:true,mutations_performed:false},code=0,args=["--setup","--language","zh-CN"],platform=true}={}){
    fs.writeFileSync(callLog,"");
    if(!platform)fs.writeFileSync(path.join(bin,"uname"),'#!/bin/sh\necho Linux\n',{mode:0o755});
    else fs.writeFileSync(path.join(bin,"uname"),'#!/bin/sh\necho Darwin\n',{mode:0o755});
    const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,FAKE_PREFLIGHT_JSON:typeof result==="string"?result:JSON.stringify(result),FAKE_PREFLIGHT_EXIT:String(code)};
    const r=spawnSync("bash",[path.join(app,"install.sh"),...args],{cwd:root,env,encoding:"utf8",timeout:10000});
    const calls=fs.readFileSync(callLog,"utf8").split("\n").filter(Boolean);
    return {r,calls};
  }
  return {invoke,app};
}

test("official shell: approved non-mutating PASS anchors cwd and proceeds exactly once to requested setup/resume",t=>{
  const f=fake(t);
  for(const action of ["--setup","--resume"]){
    const {r,calls}=f.invoke({args:[action,"--language","zh-CN"]});
    assert.equal(r.status,1,r.stderr);
    assert.equal(calls.length,2,JSON.stringify(calls));
    assert.ok(calls.every(x=>x.startsWith(f.app+"|")));
    assert.ok(calls[0].includes("|dry-run|"));
    assert.ok(calls[1].includes("|"+action.slice(2)+"|"));
    assert.match(calls[1],/--language zh-CN/);
    assert.match(r.stdout,/"dry_run":true/);
  }
  const dry=f.invoke({args:[]});assert.equal(dry.r.status,0);assert.equal(dry.calls.length,1);
});

test("official shell: legitimate authorization-required exit 1 never invokes setup",t=>{
  const f=fake(t);
  const {r,calls}=f.invoke({result:{status:"NEEDS_USER_ACTION",action_id:"macos_official_fresh_preparation",official_fresh_first_install_bootstrap_eligible:true,installation_authorized:false,approval_challenge:"required-human-action",mutations_performed:false},code:1});
  assert.equal(r.status,1);assert.equal(calls.length,1);assert.match(r.stdout,/macos_official_fresh_preparation/);
});

test("official shell: malformed success, incomplete schema and false-positive PASS are all rejected",t=>{
  const f=fake(t);
  for(const result of ["not-json","{}",'{"status":"ERROR","status":"PASS","dry_run":true,"mutations_performed":false}',{status:"PASS",dry_run:true},{status:"PASS",dry_run:true,mutations_performed:true},{status:"NEEDS_USER_ACTION",dry_run:true,mutations_performed:false}]){
    const {r,calls}=f.invoke({result});assert.notEqual(r.status,0);assert.equal(calls.length,1,JSON.stringify(result));
  }
  for(const result of ["not-json",{status:"PASS",dry_run:true,mutations_performed:false}]){
    const {r,calls}=f.invoke({result,code:1});assert.equal(r.status,1);assert.equal(calls.length,1);
  }
});

test("official shell: wrong platform and unsupported flags abort before CLI",t=>{
  const f=fake(t);
  for(const bad of [{args:["--unknown"]},{args:["--language"]},{args:["--language","en-US"]},{args:["--setup","--resume"]},{args:["--setup","--setup"]},{platform:false}]){
    const {r,calls}=f.invoke(bad);assert.notEqual(r.status,0);assert.equal(calls.length,0);
  }
});
