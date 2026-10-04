import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const run = (script, args, env) => spawnSync("powershell.exe", ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,...args], {encoding:"utf8",env});
const runAsync = (script, args, env) => new Promise((resolve, reject) => {
  const child = spawn("powershell.exe", ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,...args], {env});
  let stdout="", stderr=""; const timer=setTimeout(()=>{ child.kill(); reject(new Error("PowerShell timeout")); },10000);
  child.stdout.on("data", x=>stdout+=x); child.stderr.on("data", x=>stderr+=x);
  child.on("error", reject); child.on("close", status=>{ clearTimeout(timer); resolve({status,stdout,stderr}); });
});

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

test("native callback mutexes isolate same and different instances and restore process environment", {skip: process.platform !== "win32"}, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"callback-concurrency-"));
  try {
    const make = (id) => {
      const root=path.join(dir,id), scripts=path.join(root,"control","scripts"), home=path.join(root,"home"), instance=path.join(home,".chatgpt-codex-orchestrator","instances",id), pending=path.join(instance,"pending-wakes");
      fs.mkdirSync(scripts,{recursive:true}); fs.mkdirSync(pending,{recursive:true});
      for(const name of ["wake-chat.ps1","retry-pending-callbacks.ps1","runtime-context.ps1"]) fs.copyFileSync(path.resolve("runtime/scripts",name),path.join(scripts,name));
      fs.writeFileSync(path.join(root,"control","instance.json"),JSON.stringify({instance_id:id}));
      fs.writeFileSync(path.join(instance,"config.ps1"),`$env:ORCHESTRATOR_INSTANCE_ID = '${id}'\n`);
      fs.writeFileSync(path.join(scripts,"wake-chat.mjs"),`import fs from 'node:fs';\nconst file=process.env.CODEX_CALLBACK_STATE_FILE;\nif(process.env.TEST_MODE==='sleep'){fs.appendFileSync(process.env.MARKER,'start\\n'); await new Promise(r=>setTimeout(r,500)); fs.appendFileSync(process.env.MARKER,'end\\n');}\nif(process.env.TEST_MODE==='error') process.exitCode=1; else {const x=JSON.parse(fs.readFileSync(file)); x.delivery_state='DELIVERED'; fs.writeFileSync(file,JSON.stringify(x)+'\\n'); console.log('CHAT_STATE_FINGERPRINT:'+ (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(file)).digest('hex'));}`);
      return {root,scripts,home,instance,pending,wake:path.join(scripts,"wake-chat.ps1")};
    };
    const a=make("a"), b=make("b");
    const record=id=>({routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:id,chat_url:"https://chatgpt.com/c/test",message:"payload"});
    const setup=(f,id)=>{fs.writeFileSync(path.join(f.pending,id+".json"),JSON.stringify(record(id))); return {...process.env,HOME:f.home,USERPROFILE:f.home,TEST_MODE:"sleep",MARKER:path.join(f.root,"marker")};};
    const sameEnv=setup(a,"same");
    const [one,two]=await Promise.all([runAsync(a.wake,["-ReconcileOnly","-CallbackId","same"],sameEnv),runAsync(a.wake,["-ReconcileOnly","-CallbackId","same"],sameEnv)]);
    assert.equal(one.status,0); assert.equal(two.status,4); assert.equal(fs.readFileSync(sameEnv.MARKER,"utf8").trim().split(/\r?\n/).join(","),"start,end"); assert.equal(fs.existsSync(path.join(a.pending,"same.json")),false);
    fs.writeFileSync(path.join(a.pending,"err.json"),JSON.stringify(record("err"))); const errEnv={...sameEnv,TEST_MODE:"error"}; assert.notEqual(run(a.wake,["-ReconcileOnly","-CallbackId","err"],errEnv).status,0); errEnv.TEST_MODE="sleep"; assert.equal(run(a.wake,["-ReconcileOnly","-CallbackId","err"],errEnv).status,0);
    const ea=setup(a,"parallel-a"), eb=setup(b,"parallel-b"); const started=Date.now(); const [pa,pb]=await Promise.all([runAsync(a.wake,["-ReconcileOnly","-CallbackId","parallel-a"],ea),runAsync(b.wake,["-ReconcileOnly","-CallbackId","parallel-b"],eb)]); assert.equal(pa.status,0); assert.equal(pb.status,0); assert.ok(Date.now()-started<900);
    fs.writeFileSync(path.join(a.pending,"env.json"),JSON.stringify(record("env"))); const envScript=path.join(a.root,"invoke.ps1"); fs.writeFileSync(envScript,`$env:ORCHESTRATOR_CHAT_URL='sentinel-url';$env:CODEX_CALLBACK_ID='sentinel-id';$env:CODEX_CALLBACK_STATE_FILE='sentinel-state';$env:CODEX_CALLBACK_EXPECTED_FINGERPRINT='sentinel-fp';$env:CODEX_RECONCILE_ONLY='sentinel-reconcile';& '${a.wake}' -ReconcileOnly -CallbackId env; Write-Output ("ENV="+$env:ORCHESTRATOR_CHAT_URL+"|"+$env:CODEX_CALLBACK_ID+"|"+$env:CODEX_CALLBACK_STATE_FILE+"|"+$env:CODEX_CALLBACK_EXPECTED_FINGERPRINT+"|"+$env:CODEX_RECONCILE_ONLY)`); const restored=run(envScript,[],{...process.env,HOME:a.home,USERPROFILE:a.home,TEST_MODE:"error"}); assert.match(restored.stdout,/ENV=sentinel-url\|sentinel-id\|sentinel-state\|sentinel-fp\|sentinel-reconcile/);
    const replacement=path.join(a.pending,"replacement.json"); fs.writeFileSync(replacement,JSON.stringify(record("replacement"))); const replacementText=JSON.stringify({...record("replacement"),delivery_state:"PENDING",extra:"replacement"}); fs.writeFileSync(path.join(a.root,"replace.ps1"),`$p='${replacement}';$env:TEST_MODE='sleep';Start-Job {param($p) Start-Sleep -Milliseconds 150; Set-Content -Path $p -Value '${replacementText}' } -ArgumentList $p | Out-Null;& '${a.wake}' -ReconcileOnly -CallbackId replacement`); const replaced=run(path.join(a.root,"replace.ps1"),[],{...process.env,HOME:a.home,USERPROFILE:a.home,MARKER:path.join(a.root,"replace-marker")}); assert.notEqual(replaced.status,0); assert.equal(fs.readFileSync(replacement,"utf8"),replacementText);
    const missing=path.join(a.pending,"missing.json"); fs.writeFileSync(missing,JSON.stringify(record("missing"))); fs.writeFileSync(path.join(a.root,"disappear.ps1"),`$p='${missing}';Start-Job {param($p) Start-Sleep -Milliseconds 150; Remove-Item $p} -ArgumentList $p | Out-Null;& '${a.wake}' -ReconcileOnly -CallbackId missing`); const disappeared=run(path.join(a.root,"disappear.ps1"),[],{...process.env,HOME:a.home,USERPROFILE:a.home,TEST_MODE:"sleep"}); assert.notEqual(disappeared.status,0); assert.equal(fs.existsSync(missing),false);
    assert.equal(fs.readFileSync(path.join(b.pending,"parallel-b.json"),"utf8").length>0,true);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
