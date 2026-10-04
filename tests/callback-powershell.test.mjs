import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
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
const item=JSON.parse(fs.readFileSync(file,'utf8'));
if(process.env.ARGV_MARKER) fs.writeFileSync(process.env.ARGV_MARKER,process.argv.slice(2).join(' ')+'\\n'+item.message);
if(process.env.TEST_MODE==='pending'){process.exitCode=3;process.exit();}
if(process.env.TEST_MODE==='error'){process.exitCode=1;process.exit();}
item.delivery_state='DELIVERED'; fs.writeFileSync(file,JSON.stringify(item)+'\\n');
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

    for (const [id,messageArgs] of [["missing",[]],["blank",["-Message","   "]]]) {
      const sentinel=path.join(pending,id+"-unrelated.json"), sentinelBytes=Buffer.from("sentinel\\n"), marker=path.join(dir,id+".marker");
      fs.writeFileSync(sentinel,sentinelBytes); const before=fs.readdirSync(pending);
      const missingResult=run(wake,["-ChatUrl","https://chatgpt.com/c/test","-CallbackId",id,"-QueueOnFailure",...messageArgs],{...env,TEST_MODE:"success",ARGV_MARKER:marker});
      assert.notEqual(missingResult.status,0); assert.match(missingResult.stderr+missingResult.stdout,/Message is required/); assert.equal(fs.existsSync(marker),false);
      assert.equal(fs.existsSync(path.join(pending,id+".json")),false); assert.deepEqual(fs.readdirSync(pending),before); assert.deepEqual(fs.readFileSync(sentinel),sentinelBytes);
    }

    const reconcileId="spaces-reconcile", reconcileMessage="  payload  ", reconcileMarker=path.join(dir,"reconcile.marker");
    fs.writeFileSync(path.join(pending,reconcileId+".json"),JSON.stringify({...record(reconcileId),message:reconcileMessage}));
    result=run(wake,["-ReconcileOnly","-CallbackId",reconcileId],{...env,TEST_MODE:"success",ARGV_MARKER:reconcileMarker});
    assert.equal(result.status,0); assert.equal(fs.readFileSync(reconcileMarker,"utf8"),reconcileMessage+"\\n"+reconcileMessage); assert.equal(fs.existsSync(path.join(pending,reconcileId+".json")),false);

    const retryId="spaces-retry", retryMessage="  payload  ", retryMarker=path.join(dir,"retry.marker");
    result=run(wake,["-ChatUrl","https://chatgpt.com/c/test","-CallbackId",retryId,"-Message",retryMessage,"-QueueOnFailure"],{...env,TEST_MODE:"error"});
    assert.equal(result.status,0); const retryPath=path.join(pending,retryId+".json"); assert.equal(JSON.parse(fs.readFileSync(retryPath,"utf8")).message,retryMessage);
    result=run(wake,["-ReconcileOnly","-CallbackId",retryId],{...env,TEST_MODE:"success",ARGV_MARKER:retryMarker});
    assert.equal(result.status,0); assert.equal(fs.readFileSync(retryMarker,"utf8"),retryMessage+"\\n"+retryMessage); assert.equal(fs.existsSync(retryPath),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test("native callback mutexes isolate same and different instances and restore process environment", {skip: process.platform !== "win32"}, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"callback-concurrency-"));
  try {
    const make = (id) => {
      const root=path.join(dir,id), scripts=path.join(root,"control","scripts"), home=path.join(root,"home"), instance=path.join(home,".chatgpt-codex-orchestrator","instances",id), pending=path.join(instance,"pending-wakes");
      fs.mkdirSync(scripts,{recursive:true}); fs.mkdirSync(pending,{recursive:true});
      for(const name of ["wake-chat.ps1","retry-pending-callbacks.ps1","runtime-context.ps1"]) fs.copyFileSync(path.resolve("runtime/scripts",name),path.join(scripts,name));
      fs.copyFileSync(path.resolve("runtime/scripts/callback-delivery.mjs"),path.join(scripts,"callback-delivery.mjs"));
      fs.writeFileSync(path.join(root,"control","instance.json"),JSON.stringify({instance_id:id}));
      fs.writeFileSync(path.join(instance,"config.ps1"),`$env:ORCHESTRATOR_INSTANCE_ID = '${id}'\n`);
      fs.writeFileSync(path.join(scripts,"wake-chat.mjs"),`import fs from 'node:fs';\nimport {createCallbackStateStore} from './callback-delivery.mjs';\nconst file=process.env.CODEX_CALLBACK_STATE_FILE;\nif(process.env.TEST_MODE==='guarded'){const store=createCallbackStateStore({file,expected:process.env.ORCHESTRATOR_CHAT_URL,callbackId:process.env.CODEX_CALLBACK_ID,message:process.argv.slice(2).join(' '),expectedFingerprint:process.env.CODEX_CALLBACK_EXPECTED_FINGERPRINT,fsModule:fs,pathModule:await import('node:path')}); fs.writeFileSync(process.env.READY,'READY'); while(!fs.existsSync(process.env.CONTINUE)){await new Promise(r=>setTimeout(r,25));} console.log('CHAT_STATE_FINGERPRINT:'+store.update('DELIVERED')); process.exit(0);}\nif(process.env.TEST_MODE==='sleep'){fs.appendFileSync(process.env.MARKER,'start:'+process.env.TEST_ID+'\\n'); await new Promise(r=>setTimeout(r,500)); fs.appendFileSync(process.env.MARKER,'end:'+process.env.TEST_ID+'\\n');}\nif(process.env.TEST_MODE==='error') process.exitCode=1; else {const x=JSON.parse(fs.readFileSync(file)); x.delivery_state='DELIVERED'; fs.writeFileSync(file,JSON.stringify(x)+'\\n'); console.log('CHAT_STATE_FINGERPRINT:'+ (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(file)).digest('hex'));}`);
      return {root,scripts,home,instance,pending,wake:path.join(scripts,"wake-chat.ps1")};
    };
    const a=make("a"), b=make("b");
    const record=id=>({routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:id,chat_url:"https://chatgpt.com/c/test",message:"payload"});
    const setup=(f,id,marker=path.join(dir,"overlap.marker"))=>{fs.writeFileSync(path.join(f.pending,id+".json"),JSON.stringify(record(id))); return {...process.env,HOME:f.home,USERPROFILE:f.home,TEST_MODE:"sleep",TEST_ID:id,MARKER:marker};};
    const sameEnv=setup(a,"same",path.join(dir,"same.marker"));
    const [one,two]=await Promise.all([runAsync(a.wake,["-ReconcileOnly","-CallbackId","same"],sameEnv),runAsync(a.wake,["-ReconcileOnly","-CallbackId","same"],sameEnv)]);
    assert.deepEqual([one.status,two.status].sort((x,y)=>x-y),[0,4]); assert.equal(fs.readFileSync(sameEnv.MARKER,"utf8").trim().split(/\r?\n/).join(","),"start:same,end:same"); assert.equal(fs.existsSync(path.join(a.pending,"same.json")),false);
    fs.writeFileSync(path.join(a.pending,"err.json"),JSON.stringify(record("err"))); const errEnv={...sameEnv,TEST_MODE:"error"}; assert.notEqual(run(a.wake,["-ReconcileOnly","-CallbackId","err"],errEnv).status,0); errEnv.TEST_MODE="sleep"; assert.equal(run(a.wake,["-ReconcileOnly","-CallbackId","err"],errEnv).status,0);
    const overlapMarker=path.join(dir,"overlap.marker"); const sentinelA=path.join(a.pending,"unrelated.json"), sentinelB=path.join(b.pending,"unrelated.json"); fs.writeFileSync(sentinelA,JSON.stringify(record("unrelated-a"))); fs.writeFileSync(sentinelB,JSON.stringify(record("unrelated-b"))); const sentinelBytesA=fs.readFileSync(sentinelA), sentinelBytesB=fs.readFileSync(sentinelB); const ea=setup(a,"parallel-a",overlapMarker), eb=setup(b,"parallel-b",overlapMarker); const [pa,pb]=await Promise.all([runAsync(a.wake,["-ReconcileOnly","-CallbackId","parallel-a"],ea),runAsync(b.wake,["-ReconcileOnly","-CallbackId","parallel-b"],eb)]); assert.equal(pa.status,0); assert.equal(pb.status,0); const overlap=fs.readFileSync(overlapMarker,"utf8").trim().split(/\r?\n/); assert.deepEqual(new Set(overlap.filter(x=>x.startsWith("start:")).map(x=>x.slice(6))),new Set(["parallel-a","parallel-b"])); assert.ok(overlap.indexOf("start:parallel-a")<overlap.indexOf("end:parallel-a") && overlap.indexOf("start:parallel-b")<overlap.indexOf("end:parallel-b")); assert.ok(overlap.indexOf("start:parallel-a")<overlap.indexOf("end:parallel-b") && overlap.indexOf("start:parallel-b")<overlap.indexOf("end:parallel-a")); assert.equal(fs.existsSync(path.join(a.pending,"parallel-a.json")),false); assert.equal(fs.existsSync(path.join(b.pending,"parallel-b.json")),false); assert.deepEqual(fs.readFileSync(sentinelA),sentinelBytesA); assert.deepEqual(fs.readFileSync(sentinelB),sentinelBytesB);
    fs.writeFileSync(path.join(a.pending,"env.json"),JSON.stringify(record("env"))); const envScript=path.join(a.root,"invoke.ps1"); fs.writeFileSync(envScript,`$env:ORCHESTRATOR_CHAT_URL='sentinel-url';$env:CODEX_CALLBACK_ID='sentinel-id';$env:CODEX_CALLBACK_STATE_FILE='sentinel-state';$env:CODEX_CALLBACK_EXPECTED_FINGERPRINT='sentinel-fp';$env:CODEX_RECONCILE_ONLY='sentinel-reconcile';& '${a.wake}' -ReconcileOnly -CallbackId env; Write-Output ("ENV="+$env:ORCHESTRATOR_CHAT_URL+"|"+$env:CODEX_CALLBACK_ID+"|"+$env:CODEX_CALLBACK_STATE_FILE+"|"+$env:CODEX_CALLBACK_EXPECTED_FINGERPRINT+"|"+$env:CODEX_RECONCILE_ONLY)`); const restored=run(envScript,[],{...process.env,HOME:a.home,USERPROFILE:a.home,TEST_MODE:"error"}); assert.match(restored.stdout,/ENV=sentinel-url\|sentinel-id\|sentinel-state\|sentinel-fp\|sentinel-reconcile/);
    const guarded=(id,mutate)=>{const file=path.join(a.pending,id+'.json'), ready=path.join(a.root,id+'.ready'), cont=path.join(a.root,id+'.continue'); fs.writeFileSync(file,JSON.stringify(record(id))); const fp=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); const env={...process.env,HOME:a.home,USERPROFILE:a.home,TEST_MODE:'guarded',READY:ready,CONTINUE:cont,ORCHESTRATOR_CHAT_URL:'https://chatgpt.com/c/test',CODEX_CALLBACK_EXPECTED_FINGERPRINT:fp}; const child=runAsync(a.wake,['-ReconcileOnly','-CallbackId',id],env); const deadline=Date.now()+5000; while(!fs.existsSync(ready)&&Date.now()<deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25); assert.equal(fs.existsSync(ready),true); const original=mutate(file); fs.writeFileSync(cont,'CONTINUE'); return child.then(result=>({result,file,original}));};
    const replacementText=JSON.stringify({...record('replacement'),delivery_state:'PENDING',extra:'replacement'}); const replaced=await guarded('replacement',(file)=>{fs.writeFileSync(file,replacementText); return replacementText;}); assert.notEqual(replaced.result.status,0); assert.equal(fs.readFileSync(replaced.file,'utf8'),replacementText); assert.doesNotMatch(replaced.result.stdout,/CHAT_WAKE_DELIVERED/);
    const disappeared=await guarded('missing',(file)=>{fs.unlinkSync(file); return null;}); assert.notEqual(disappeared.result.status,0); assert.equal(fs.existsSync(disappeared.file),false); assert.doesNotMatch(disappeared.result.stdout,/CHAT_WAKE_DELIVERED/);
    const retryEnv=setup(a,"replacement",path.join(a.root,"retry.marker")); retryEnv.TEST_MODE="sleep"; assert.equal(run(a.wake,["-ReconcileOnly","-CallbackId","replacement"],retryEnv).status,0); assert.equal(fs.existsSync(path.join(a.pending,"replacement.json")),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
