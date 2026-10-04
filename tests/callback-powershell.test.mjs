import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const run = (script, args, env) => spawnSync("powershell.exe", ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,...args], {encoding:"utf8",env});

test("native callback lifecycle uses isolated shipped PowerShell entrypoints", {skip: process.platform !== "win32"}, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"callback-fixture-"));
  try {
    const scripts=path.join(dir,"control","scripts"), home=path.join(dir,"home"), instance=path.join(home,".chatgpt-codex-orchestrator","instances","fixture");
    fs.mkdirSync(scripts,{recursive:true}); fs.mkdirSync(instance,{recursive:true});
    for(const name of ["wake-chat.ps1","retry-pending-callbacks.ps1","runtime-context.ps1"]) fs.copyFileSync(path.resolve("runtime/scripts",name),path.join(scripts,name));
    fs.writeFileSync(path.join(dir,"control","instance.json"),JSON.stringify({instance_id:"fixture"}));
    fs.writeFileSync(path.join(instance,"config.ps1"),"$env:ORCHESTRATOR_INSTANCE_ID = 'fixture'\n");
    const shim=path.join(scripts,"wake-chat.mjs");
    fs.writeFileSync(shim,`import fs from 'node:fs';
const file=process.env.CODEX_CALLBACK_STATE_FILE;
if(process.env.TEST_MODE==='pending'){process.exitCode=3;process.exit();}
if(process.env.TEST_MODE==='error'){process.exitCode=1;process.exit();}
const item=JSON.parse(fs.readFileSync(file,'utf8')); item.delivery_state='DELIVERED'; fs.writeFileSync(file,JSON.stringify(item)+'\\n');
const crypto=await import('node:crypto'); console.log('CHAT_STATE_FINGERPRINT:'+crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));`);
    const env={...process.env,HOME:home,USERPROFILE:home,TEST_MODE:"pending"};
    const pending=path.join(instance,"pending-wakes"); fs.mkdirSync(pending,{recursive:true});
    const record=id=>({routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:id,chat_url:"https://chatgpt.com/c/test",message:"payload"});
    fs.writeFileSync(path.join(pending,"pending.json"),JSON.stringify(record("pending")));
    const wake=path.join(scripts,"wake-chat.ps1");
    let result=run(wake,["-ReconcileOnly","-CallbackId","pending"],env);
    assert.equal(result.status,0); assert.match(result.stdout,/PENDING/); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pending,"pending.json"))),record("pending"));
    env.TEST_MODE="success"; fs.writeFileSync(path.join(pending,"done.json"),JSON.stringify(record("done")));
    result=run(wake,["-ReconcileOnly","-CallbackId","done"],env); assert.equal(result.status,0); assert.match(result.stdout,/CHAT_WAKE_DELIVERED/); assert.equal(fs.existsSync(path.join(pending,"done.json")),false);
    result=run(wake,["-ReconcileOnly","-CallbackId","done"],env); assert.equal(result.status,4); assert.match(result.stdout,/NOT_FOUND/); assert.doesNotMatch(result.stdout,/CHAT_WAKE_DELIVERED/); assert.equal(fs.existsSync(path.join(pending,"done.json")),false);
    fs.writeFileSync(path.join(pending,"bad.json"),JSON.stringify({...record("bad"),routing_version:"legacy"})); result=run(wake,["-ReconcileOnly","-CallbackId","bad"],env); assert.notEqual(result.status,0); assert.equal(fs.existsSync(path.join(pending,"bad.json")),true);
    result=run(wake,["-ReconcileOnly","-CallbackId","bad/id"],env); assert.notEqual(result.status,0); assert.equal(fs.existsSync(path.join(pending,"bad_id.json")),false);
    const other=path.join(home,".chatgpt-codex-orchestrator","instances","other","pending-wakes"); fs.mkdirSync(other,{recursive:true}); fs.writeFileSync(path.join(other,"done.json"),JSON.stringify(record("done"))); assert.equal(fs.existsSync(path.join(other,"done.json")),true);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
