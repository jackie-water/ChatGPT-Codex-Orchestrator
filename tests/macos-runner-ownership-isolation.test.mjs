import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectConcurrentRunner, migrationPreflight } from "../src/lib/macos-platform.mjs";

const REPO = "jackie-water/Priceup-Orchestrator";
const AGENT = "MacBook-Air-Priceup";
const PID = 16185;
const LABEL = "actions.runner.jackie-water-Priceup-Orchestrator.MacBook-Air-Priceup";
const START = "Mon Nov 16 10:12:01 2026";
const OWNER = process.getuid?.() || 0;

function fixture({state={},serviceCommand="bash",extraRows=[],runnerConfig={}}={}) {
  const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),"cco-runner-ownership-test-"));
  const home=path.join(sandbox,"home");
  fs.mkdirSync(home,{mode:0o700});
  const runner=path.join(home,"Priceup","actions-runner");
  fs.mkdirSync(runner,{recursive:true,mode:0o700});
  const script=path.join(runner,"runsvc.sh");
  fs.writeFileSync(script,"#!/bin/bash\nexit 0\n",{mode:0o700});
  const directory=path.join(home,"Library","LaunchAgents");
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const plist=path.join(directory,LABEL+".plist");
  fs.writeFileSync(plist,"synthetic fixture plist\n",{mode:0o600});
  const config={agentId:33421,agentName:AGENT,gitHubUrl:`https://github.com/${REPO}`,workFolder:"_work",...runnerConfig};
  fs.writeFileSync(path.join(runner,".runner"),JSON.stringify(config)+"\n",{mode:0o600});
  const meta={home,runner,script,plist,config,state,calls:[],extraRows,pass:true,mutate:null,pid:PID,launchStatus:0,started:START};
  meta.print=()=>`gui/${OWNER}/${LABEL} = {
 path = ${meta.plist}
 type = LaunchAgent
 state = running
 program = ${serviceCommand==="bash"?"/bin/bash":meta.script}
 arguments = {
   ${serviceCommand==="bash"?"/bin/bash\n   "+meta.script:meta.script}
 }
 working directory = ${meta.runner}
 domain = gui/${OWNER} [1024]
 pid = ${meta.pid}
 properties = inferred program | runatload
}`;
  meta.list=()=>`PID Status Label\n${meta.pid} ${meta.launchStatus} ${LABEL}\n${meta.extraRows.join("\n")}`;
  meta.exec=(cmd,args)=>{
    meta.calls.push([cmd,...args]);
    if(typeof meta.mutate==="function")meta.mutate(cmd,args,meta);
    if(cmd==="launchctl"){
      if(args[0]==="list")return {ok:meta.pass,output:meta.list()};
      if(args[0]==="print")return {ok:meta.pass,output:meta.print()};
      throw Error("Mutation not allowed");
    }
    if(cmd==="/bin/ps"){
      if(args.includes("command="))return {ok:meta.pass,output:serviceCommand==="bash"?`/bin/bash ${meta.script}`:meta.script};
      if(args.includes("lstart="))return {ok:meta.pass,output:meta.started};
    }
    throw Error("Unexpected command");
  };
  meta.close=()=>fs.rmSync(sandbox,{recursive:true,force:true});
  return meta;
}
const run=f=>migrationPreflight({state:f.state,home:f.home,commandRunner:f.exec});
const mustBlock=(f,kind)=>{const v=run(f);assert.equal(v.status,"CONFLICT",JSON.stringify(v));assert.ok(v.conflicts.some(x=>x.kind===kind),JSON.stringify(v.conflicts));assert.equal(v.mutations_performed,false);assert.ok(!f.calls.some(x=>["bootstrap","bootout","kickstart"].includes(x[1])));};

test("unrelated Priceup LaunchAgent with exact owned live config is passively classified",()=>{
  const f=fixture();try{
    const before=[fs.readFileSync(path.join(f.runner,".runner")),fs.statSync(f.plist).mtimeMs,fs.statSync(f.script).mtimeMs];
    const output=run(f);
    assert.equal(output.status,"READY",JSON.stringify(output));
    assert.equal(output.inventory.runner.ownership,"INDEPENDENT_FOREIGN_RUNNERS_VERIFIED");
    assert.equal(output.inventory.runner.foreign_runner_count,1);
    assert.equal(output.inventory.runner.foreign_runner_evidence,"READONLY_VERIFIED_OTHER_REPO_NO_AUTHORITY");
    assert.equal(output.inventory.runner.concurrent,false);
    assert.deepEqual(fs.readFileSync(path.join(f.runner,".runner")),before[0]);
    assert.equal(fs.statSync(f.plist).mtimeMs,before[1]);
    assert.equal(fs.statSync(f.script).mtimeMs,before[2]);
    assert.deepEqual(new Set(f.calls.map(x=>x[0])),new Set(["launchctl","/bin/ps"]));
    assert.equal(f.calls.filter(x=>x[0]==="launchctl"&&x[1]==="list").length,2);
    assert.equal(f.calls.filter(x=>x[0]==="launchctl"&&x[1]==="print").length,2);
  }finally{f.close();}
});

test("healthy foreign service with direct runsvc program remains verified",()=>{
  const f=fixture({serviceCommand:"direct"});try{assert.equal(run(f).status,"READY");}finally{f.close();}
});

test("unrelated verified runners must not suppress same-project Orchestrator runner",()=>{
  for (const extra of [`734 0 actions.runner.jackie-water-chatgpt-codex-orchestrator-control-1832f0bb.codex-orchestrator-1832f0bb`, `811 0 com.chatgpt.codex.1832f0bb`]){
    const f=fixture({extraRows:[extra]});try{mustBlock(f,"concurrent_runner");}finally{f.close();}
  }
});

test("Runner from actual expected target cannot be counted as unrelated",()=>{
  const f=fixture({state:{target_repository:REPO}});try{mustBlock(f,"runner_ownership_unknown");}finally{f.close();}
});

test("undetected, duplicate or contradictory current Runner labels remain blocked",()=>{
  const cases=[{state:{runner_label:"codex-orchestrator-99999999"}},{state:{instance_id:"fixture2"}},{extraRows:[`${PID} 0 ${LABEL}`]}];
  for(const opts of cases){const f=fixture(opts);try{mustBlock(f,opts.extraRows?"concurrent_runner":"runner_ownership_unknown");}finally{f.close();}}
});

test("launchctl errors and malformed runner table never imply READY",()=>{
  for(const alter of [f=>{f.pass=false;},f=>{f.list=()=>`junk 0 ${LABEL}`;},f=>{f.list=()=>`${PID} nope ${LABEL}`;},f=>{f.list=()=>`${Number.MAX_SAFE_INTEGER}0 0 ${LABEL}`;},f=>{f.list=()=>`${PID} 0 ${LABEL}\n${PID} 0 ${LABEL}`;}]){
    const f=fixture();try{alter(f);assert.equal(run(f).status,"CONFLICT");}finally{f.close();}
  }
});

test("single matching label can be forged but print and config must confirm ownership",()=>{
  const cases=[
    f=>{f.print=()=>f.printBase;},
    f=>{const orig=f.print;f.print=()=>orig().replace("= {","= {\n domain = wrong");},
    f=>{const orig=f.print;f.print=()=>orig().replace("type = LaunchAgent","type = Daemon");},
    f=>{const orig=f.print;f.print=()=>orig().replace("state = running","state = waiting");},
    f=>{const orig=f.print;f.print=()=>orig().replace(`pid = ${PID}`,"pid = 9999");},
    f=>{const orig=f.print;f.print=()=>orig().replace("program = /bin/bash","program = /bin/sh");},
    f=>{const orig=f.print;f.print=()=>orig().replace(`working directory = ${f.runner}`,"working directory = /tmp");},
    f=>{const orig=f.print;f.print=()=>orig().replace(`path = ${f.plist}`,"path = /tmp/other.plist");},
    f=>{const orig=f.print;f.print=()=>orig().replace(`domain = gui/${OWNER} [1024]`,"domain = system [1024]");},
    f=>{const orig=f.print;f.print=()=>orig().replace(`arguments = {`,`arguments = {\n  /bin/sh`);},
  ];
  for (let i=0;i<cases.length;i++){
    const f=fixture();try{
      if(i===0){f.printBase="gui/999/foreign = {\n}";}
      cases[i](f);mustBlock(f,"runner_ownership_unknown");
    }finally{f.close();}
  }
});

test("invalid foreign Runner config never grants a cross-project exception",()=>{
  const variants=[
    {agentId:0},{agentName:"forged"},{gitHubUrl:"https://github.com/jackie-water/Clean-Energy-Forum"},
    {gitHubUrl:"https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb"},
    {gitHubUrl:"https://github.com/jackie-water/ChatGPT-Codex-Orchestrator-E2E-Target"},
    {workFolder:"other"},{agentId:"33421x"}
  ];
  for(const runnerConfig of variants){const f=fixture({runnerConfig});try{mustBlock(f,"runner_ownership_unknown");}finally{f.close();}}
});

test("string-encoded decimal official agent IDs remain valid without relaxing identity checks",()=>{
  const f=fixture({runnerConfig:{agentId:"33421"}});try{assert.equal(run(f).status,"READY");}finally{f.close();}
});

test("duplicate JSON keys including unicode escaped name cannot spoof repo identity",()=>{
  for(const duplicate of ['"agentName":"MacBook-Air-Priceup"','"\\u0061gentName":"MacBook-Air-Priceup"','"gitHubUrl":"https://github.com/jackie-water/Priceup-Orchestrator"']){
    const f=fixture();try{const data=fs.readFileSync(path.join(f.runner,".runner"),"utf8").trim();fs.writeFileSync(path.join(f.runner,".runner"),data.slice(0,-1)+","+duplicate+"}\n",{mode:0o600});mustBlock(f,"runner_ownership_unknown");}finally{f.close();}
  }
});

test("config symlink, hardlink, wrong mode and broken root path block without touching the other Runner",()=>{
  for(const change of [
    f=>{const p=path.join(f.runner,".runner"),other=path.join(f.runner,"copy");fs.renameSync(p,other);fs.symlinkSync(other,p);},
    f=>{const p=path.join(f.runner,".runner");fs.linkSync(p,path.join(f.runner,"alias"));},
    f=>fs.chmodSync(path.join(f.runner,".runner"),0o666),
    f=>fs.chmodSync(f.runner,0o777),
    f=>{fs.unlinkSync(f.script);fs.symlinkSync("/dev/null",f.script);},
    f=>fs.chmodSync(f.script,0o644),
    f=>{fs.unlinkSync(f.plist);fs.symlinkSync("/dev/null",f.plist);}
  ]){
    const f=fixture();try{change(f);mustBlock(f,"runner_ownership_unknown");}finally{f.close();}
  }
});

test("forged, stale or reused PID observations block",()=>{
  for(const change of [
    f=>{const old=f.exec;f.exec=(cmd,args)=>cmd==="/bin/ps"&&args.includes("command=")?{ok:true,output:"/bin/bash /tmp/forged/runsvc.sh"}:old(cmd,args);},
    f=>{const old=f.exec;f.exec=(cmd,args)=>cmd==="/bin/ps"&&args.includes("lstart=")?{ok:true,output:"unknown"}:old(cmd,args);},
    f=>{let n=0;const old=f.exec;f.exec=(cmd,args)=>cmd==="/bin/ps"&&args.includes("lstart=")?{ok:true,output:++n===1?START:"Mon Nov 16 10:13:01 2026"}:old(cmd,args);},
    f=>{let n=0;const old=f.exec;f.exec=(cmd,args)=>{if(cmd==="launchctl"&&args[0]==="list"&&++n===2)return {ok:true,output:`999 0 ${LABEL}`};return old(cmd,args);};},
    f=>{let n=0;const old=f.exec;f.exec=(cmd,args)=>{if(cmd==="launchctl"&&args[0]==="print"&&++n===2)return {ok:true,output:f.print().replace(`pid = ${PID}`,"pid = 999")};return old(cmd,args);};}
  ]){
    const f=fixture();try{change(f);mustBlock(f,"runner_ownership_unknown");}finally{f.close();}
  }
});

test("pure same-install label remains distinct from independently proven other-project Runner",()=>{
  const f=fixture({state:{launch_agent_label:"com.chatgpt.codex.9999"}});try{
    f.extraRows.push(`- 0 ${f.state.launch_agent_label}`);
    const result=run(f);
    assert.equal(result.status,"READY",JSON.stringify(result));
    assert.equal(result.inventory.runner.ownership,"OWN_VERIFIED_LABEL");
  }finally{f.close();}
});

// Real Mac observation (2026-11-16): launchctl print contains three "type"
// and three "state" entries: one direct child at indentation 1 and two
// nested entries at indentation 2. Only direct children identify the job.
const nestedLaunchctlFields = original => original.replace(
  " properties = inferred program | runatload",
  ` service metadata = {\n  type = nested-subsystem\n  state = idle\n }\n endpoint metadata = {\n  type = nested-endpoint\n  state = waiting\n }\n properties = inferred program | runatload`
);

test("real Mac launchctl print permits nested type/state while binding only root identity",()=>{
  const f=fixture();try {
    const original=f.print;
    f.print=()=>nestedLaunchctlFields(original());
    const shown=f.print().split("\n");
    for(const key of ["type","state"]) {
      const occurrences=shown.filter(line=>line.trim().startsWith(`${key} = `));
      assert.equal(occurrences.length,3);
      assert.deepEqual([...new Set(occurrences.map(line=>line.length-line.trimStart().length))],[1,2]);
    }
    const result=run(f);
    assert.equal(result.status,"READY",JSON.stringify(result));
    assert.equal(result.inventory.runner.ownership,"INDEPENDENT_FOREIGN_RUNNERS_VERIFIED");
    assert.equal(result.mutations_performed,false);
    assert.equal(f.calls.filter(c=>c[0]==="launchctl"&&c[1]==="print").length,2);
  }finally{f.close();}
});

test("duplicate root type/state is rejected even when nested keys are valid",()=>{
  for(const key of ["type","state"]) {
    const f=fixture();try {
      const original=f.print;
      f.print=()=>{
        const plain=nestedLaunchctlFields(original());
        const line=key==="type"?" type = LaunchAgent":" state = running";
        return plain.replace(line+"\n",line+"\n"+line+"\n");
      };
      mustBlock(f,"runner_ownership_unknown");
      assert.equal(detectConcurrentRunner({state:f.state,home:f.home,commandRunner:f.exec}).reason,"Ambiguous LaunchAgent metadata field");
    }finally{f.close();}
  }
});

test("nested type/state cannot replace a missing top-level field",()=>{
  for(const key of ["type","state"]) {
    const f=fixture();try {
      const original=f.print;
      f.print=()=>nestedLaunchctlFields(original()).replace(
        key==="type"?" type = LaunchAgent\n":" state = running\n", ""
      );
      mustBlock(f,"runner_ownership_unknown");
    }finally{f.close();}
  }
});

test("nested correct-looking fields cannot hide an invalid direct service state",()=>{
  for(const key of ["type","state"]) {
    const f=fixture();try {
      const original=f.print;
      f.print=()=>nestedLaunchctlFields(original())
        .replace(key==="type"?" type = LaunchAgent":" state = running",
                 key==="type"?" type = Daemon":" state = waiting");
      mustBlock(f,"runner_ownership_unknown");
    }finally{f.close();}
  }
});

test("launchctl root indent must be consistent; tab-formatted direct fields are supported",()=>{
  const keys="path|type|state|program|working directory|pid|domain";
  const regex=new RegExp(`^ (${keys}) = `,"gm");
  const f=fixture();try {
    const original=f.print;
    f.print=()=>nestedLaunchctlFields(original()).replace(regex,"\t$1 = ");
    assert.equal(run(f).status,"READY");
  }finally{f.close();}
  const bad=fixture();try {
    const original=bad.print;
    bad.print=()=>nestedLaunchctlFields(original()).replace(" type = LaunchAgent", "\ttype = LaunchAgent");
    mustBlock(bad,"runner_ownership_unknown");
  }finally{bad.close();}
});

// macOS ps(1) documents lstart as strftime("%c"), and the C locale can
// produce day-before-month rather than GNU's month-before-day ordering.
// Probe output may never be treated as proof merely because ps exited zero.
test("macOS BSD day-before-month PID start time is bound without weakening runner ownership",()=>{
  const f=fixture();try {
    f.started="Mon 16 Nov 10:12:01 2026";
    const result=run(f);
    assert.equal(result.status,"READY",JSON.stringify(result));
    assert.equal(result.inventory.runner.foreign_runner_count,1);
    assert.equal(result.mutations_performed,false);
  }finally{f.close();}
});

test("C-locale month-before-day and macOS day-before-month represent the same pinned start",()=>{
  const f=fixture();try {
    let count=0;
    const original=f.exec;
    f.exec=(cmd,args,options)=>cmd==="/bin/ps"&&args.includes("lstart=")?
      {ok:true,output:(++count===1?"Mon Nov 16 10:12:01 2026":"Mon 16 Nov 10:12:01 2026")}:
      original(cmd,args,options);
    const result=run(f);
    assert.equal(result.status,"READY",JSON.stringify(result));
    assert.equal(count,2);
  }finally{f.close();}
});

test("process command and start time probes force a bounded stable C locale and UTC",()=>{
  const f=fixture();try {
    const previous=f.exec;const ps=[];
    f.exec=(cmd,args,options)=>{
      if(cmd==="/bin/ps")ps.push({args:[...args],options});
      return previous(cmd,args,options);
    };
    assert.equal(run(f).status,"READY");
    assert.equal(ps.length,4);
    assert.deepEqual(ps.map(x=>x.args.at(-1)),["command=","lstart=","command=","lstart="]);
    for(const call of ps){
      assert.deepEqual(call.options.env,{PATH:"/usr/bin:/bin:/usr/sbin:/sbin",LC_ALL:"C",LANG:"C",TZ:"UTC"});
    }
  }finally{f.close();}
});

test("unavailable or localized process start time cannot be promoted to foreign Runner authority",()=>{
  const forms=[
    {ok:false,output:""},
    {ok:true,output:""},
    {ok:true,output:"unknown"},
    {ok:true,output:"月 11/16 10:12:01 2026"},
    {ok:true,output:"Mon Nov 16 10:12:01 2026\nMon Nov 16 10:12:01 2026"},
    {ok:true,output:"Mon Nov 16 10:12:01 2026\u0000"},
  ];
  for(const output of forms){
    const f=fixture();try {
      const original=f.exec;
      f.exec=(cmd,args,opts)=>cmd==="/bin/ps"&&args.includes("lstart=")?output:original(cmd,args,opts);
      const result=run(f);
      assert.equal(result.status,"CONFLICT",JSON.stringify({output,result}));
      assert.equal(result.conflicts[0]?.kind,"runner_ownership_unknown");
      assert.equal(result.mutations_performed,false);
    }finally{f.close();}
  }
});

test("invalid process start-time calendar values never grant unrelated runner classification",()=>{
  const bad=[
    "Tue Nov 16 10:12:01 2026", // calendar weekday does not match
    "Mon Nov 32 10:12:01 2026",
    "Mon Nov 16 25:12:01 2026",
    "Mon Nov 16 10:61:01 2026",
    "Mon Nov 16 10:12:63 2026",
    "Thu Feb 29 10:12:01 2026", // not a leap year
    "Mon 16 Foo 10:12:01 2026",
    "Mon 0 Nov 10:12:01 2026",
    "Mon Nov 16 10:12:01 1969",
  ];
  for(const stamp of bad){
    const f=fixture();try{
      f.started=stamp;
      const result=run(f);
      assert.equal(result.status,"CONFLICT",JSON.stringify({stamp,result}));
      assert.equal(result.conflicts[0]?.kind,"runner_ownership_unknown");
    }finally{f.close();}
  }
});

test("a valid but changed process start time remains rejected across two observations",()=>{
  const f=fixture();try{
    let n=0;const original=f.exec;
    f.exec=(cmd,args,opts)=>cmd==="/bin/ps"&&args.includes("lstart=")?
      {ok:true,output:++n===1?"Mon Nov 16 10:12:01 2026":"Mon 16 Nov 10:12:02 2026"}:
      original(cmd,args,opts);
    const result=run(f);
    assert.equal(result.status,"CONFLICT");
    assert.equal(result.conflicts[0]?.kind,"runner_ownership_unknown");
    assert.equal(result.mutations_performed,false);
  }finally{f.close();}
});

test("valid leap-day and single-digit macOS PID times remain supported",()=>{
  // 2024-02-29 was Thursday; 2017-11-01 was Wednesday.
  for(const stamp of ["Thu Feb 29 07:01:02 2024","Thu 29 Feb 07:01:02 2024","Wed  1 Nov 12:36:15 2017"]){
    const f=fixture();try{
      f.started=stamp;
      const result=run(f);
      assert.equal(result.status,"READY",JSON.stringify({stamp,result}));
    }finally{f.close();}
  }
});
