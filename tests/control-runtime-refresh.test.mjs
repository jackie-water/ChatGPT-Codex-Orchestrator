import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {normalizedGithubRepository,refreshControlRuntime} from "../src/lib/control-env.mjs";

const git=(args,cwd)=>execFileSync("git",args,{cwd,encoding:"utf8"});
const gitResult=(control,remote,failPush=false)=> (command,args,options)=>{
  if(args[0]==="push"){
    if(failPush) throw new Error("simulated push failure");
    git(["update-ref","refs/heads/main",git(["rev-parse","HEAD"],control).trim()],remote);
    return {ok:true,stdout:"",stderr:"",status:0};
  }
  try { return {ok:true,stdout:git(args,options.cwd).trim(),stderr:"",status:0}; }
  catch(error) { if(options.allowFailure) return {ok:false,stdout:"",stderr:error.stderr?.toString().trim()||"",status:error.status}; throw error; }
};

test("runtime refresh accepts exact GitHub HTTPS and SSH remotes",()=>{
  assert.equal(normalizedGithubRepository("https://github.com/Owner/Control.git"),"owner/control");
  assert.equal(normalizedGithubRepository("git@github.com:Owner/Control.git"),"owner/control");
  assert.equal(normalizedGithubRepository("https://github.com/Owner/Other.git"),"owner/other");
  assert.equal(normalizedGithubRepository("https://github.com/Owner/Control/extra"),null);
});

test("runtime refresh validates fetch and every explicit push URL before mutation",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"orchestrator-remote-check-"));
  const runWith=(fetchUrl,pushUrls)=>{
    const control=path.join(root,crypto.randomUUID());
    fs.mkdirSync(path.join(control,".git"),{recursive:true});
    const state={control_environment_ready:true,control_repository:"owner/control",control_clone_path:control,runner_label:"valid"};
    const calls=[];
    const gitRun=(command,args,options)=>{
      calls.push(args);
      if(args.join(" ")==="config --get remote.origin.url") return {ok:true,stdout:fetchUrl,stderr:"",status:0};
      if(args.join(" ")==="config --get-all remote.origin.pushurl") return {ok:true,stdout:pushUrls.join("\n"),stderr:"",status:0};
      if(args[0]==="branch") return {ok:true,stdout:"main",stderr:"",status:0};
      if(args[0]==="rev-parse") return {ok:true,stdout:"a".repeat(40),stderr:"",status:0};
      if(args[0]==="ls-remote") return {ok:true,stdout:"a".repeat(40)+"\trefs/heads/main",stderr:"",status:0};
      return {ok:true,stdout:"",stderr:"",status:0};
    };
    return {calls,control,run:()=>refreshControlRuntime({state,sourceRoot:process.cwd(),gitRun})};
  };

  const matching=runWith("https://github.com/Owner/Control.git",["git@github.com:Owner/Control.git"]);
  assert.equal(matching.run().changed,false);
  assert.deepEqual(matching.calls.slice(0,2).map(args=>args.slice(0,4)),[
    ["config","--get","remote.origin.url"],
    ["config","--get-all","remote.origin.pushurl"]
  ]);

  for(const [fetchUrl,pushUrls] of [
    ["https://github.com/Owner/Other.git",["git@github.com:Owner/Control.git"]],
    ["not-a-github-url",[]],
    ["https://github.com/Owner/Control.git",["git@github.com:Owner/Control.git","https://github.com/Owner/Other.git"]],
    ["https://github.com/Owner/Control.git",["not-a-github-url"]]
  ]){
    const checked=runWith(fetchUrl,pushUrls);
    assert.throws(checked.run,/push destination/);
    assert.equal(checked.calls.length,2);
    assert.deepEqual(fs.readdirSync(checked.control),[".git"]);
  }
});

test("runtime refresh preserves mature control state and is idempotent",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"orchestrator-refresh-"));
  const remote=path.join(root,"remote.git");
  const control=path.join(root,"control");
  git(["init","--bare",remote],root);
  fs.mkdirSync(control,{recursive:true});
  git(["init","-b","main"],control);
  git(["config","user.name","fixture"],control);
  git(["config","user.email","fixture@example.invalid"],control);
  git(["remote","add","origin",remote],control);
  fs.mkdirSync(path.join(control,"scripts"),{recursive:true});
  fs.mkdirSync(path.join(control,".github","workflows"),{recursive:true});
  const preserved={
    "projects.json":'{"projects":{"extra":{"repository":"owner/extra"}}}\n',
    "config.ps1":"$extra = 'keep'\n",
    "chat-routes.json":"{\"route\":\"keep\"}\n",
    "pending.json":"{\"pending\":true}\n"
  };
  for(const [name,value] of Object.entries(preserved)) fs.writeFileSync(path.join(control,name),value);
  fs.writeFileSync(path.join(control,"scripts","capture-chat-origins.mjs"),"retired\n");
  fs.writeFileSync(path.join(control,"scripts","local-extra.ps1"),"keep\n");
  fs.writeFileSync(path.join(control,".github","workflows","orchestrator.yml"),"old\n");
  git(["add","."],control); git(["commit","-m","fixture"],control); git(["push","-u","origin","main"],control);
  fs.writeFileSync(path.join(control,"config.ps1"),"$extra = 'changed-but-unrelated'\n");
  fs.writeFileSync(path.join(control,"untracked.txt"),"untracked\n");
  git(["remote","set-url","origin","https://github.com/Owner/Control.git"],control);
  git(["remote","set-url","--push","origin","git@github.com:Owner/Control.git"],control);

  const state={control_environment_ready:true,control_repository:"owner/control",control_clone_path:control,runner_label:"codex-orchestrator-fixture"};
  const first=refreshControlRuntime({state,sourceRoot:process.cwd(),gitRun:gitResult(control,remote)});
  assert.equal(first.changed,true);
  for(const [name,value] of Object.entries(preserved)) if(name!=="config.ps1") assert.equal(fs.readFileSync(path.join(control,name),"utf8"),value);
  assert.equal(fs.existsSync(path.join(control,"scripts","capture-chat-origins.mjs")),false);
  assert.equal(fs.readFileSync(path.join(control,"scripts","local-extra.ps1"),"utf8"),"keep\n");
  assert.equal(fs.readFileSync(path.join(control,"config.ps1"),"utf8"),"$extra = 'changed-but-unrelated'\n");
  assert.equal(fs.readFileSync(path.join(control,"untracked.txt"),"utf8"),"untracked\n");
  assert.doesNotMatch(git(["show","--format=","--name-only","HEAD"],control),/config\.ps1|untracked\.txt/);
  assert.equal(fs.readFileSync(path.join(control,"scripts","callback-delivery.mjs"),"utf8"),fs.readFileSync(path.join(process.cwd(),"runtime","scripts","callback-delivery.mjs"),"utf8"));
  assert.match(fs.readFileSync(path.join(control,".github","workflows","orchestrator.yml"),"utf8"),/codex-orchestrator-fixture/);

  const second=refreshControlRuntime({state,sourceRoot:process.cwd(),gitRun:gitResult(control,remote)});
  assert.equal(second.changed,false);
});

test("runtime refresh rolls back a committed refresh when push fails and retries",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"orchestrator-retry-"));
  const remote=path.join(root,"remote.git"), control=path.join(root,"control");
  git(["init","--bare",remote],root); fs.mkdirSync(control,{recursive:true}); git(["init","-b","main"],control);
  git(["config","user.name","fixture"],control); git(["config","user.email","fixture@example.invalid"],control); git(["remote","add","origin",remote],control);
  fs.mkdirSync(path.join(control,"scripts"),{recursive:true}); fs.mkdirSync(path.join(control,".github","workflows"),{recursive:true});
  fs.writeFileSync(path.join(control,"seed.txt"),"seed\n"); git(["add","."],control); git(["commit","-m","fixture"],control); git(["push","origin","main"],control);
  git(["remote","set-url","origin","https://github.com/Owner/Control.git"],control);
  const state={control_environment_ready:true,control_repository:"owner/control",control_clone_path:control,runner_label:"retry"};
  const before=git(["rev-parse","HEAD"],control).trim();
  assert.throws(()=>refreshControlRuntime({state,sourceRoot:process.cwd(),gitRun:gitResult(control,remote,true)}),/simulated push failure/);
  assert.equal(git(["rev-parse","HEAD"],control).trim(),before);
  assert.equal(git(["diff","--cached","--quiet"],control,{stdio:"ignore"}),"");
  assert.match(git(["status","--short"],control),/^[ MARC?]{2}/m);
  assert.equal(fs.readFileSync(path.join(control,"seed.txt"),"utf8"),"seed\n");
  assert.equal(refreshControlRuntime({state,sourceRoot:process.cwd(),gitRun:gitResult(control,remote)}).changed,true);
});

test("runtime refresh rejects every remote-main mismatch before mutation",()=>{
  for(const remote of ["b".repeat(40),"", "not-a-sha"]){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"orchestrator-gate-"));
    const control=path.join(root,"control"); fs.mkdirSync(path.join(control,".git"),{recursive:true});
    const state={control_environment_ready:true,control_repository:"owner/control",control_clone_path:control,runner_label:"valid"};
    const before=fs.readdirSync(control);
    const run=(command,args,options)=>{
      if(args[0]==="config"&&args[1]==="--get") return {ok:true,stdout:"https://github.com/owner/control",stderr:"",status:0};
      if(args[0]==="config") return {ok:true,stdout:"git@github.com:owner/control",stderr:"",status:0};
      if(args[0]==="branch") return {ok:true,stdout:"main",stderr:"",status:0};
      if(args[0]==="rev-parse") return {ok:true,stdout:"a".repeat(40),stderr:"",status:0};
      if(args[0]==="ls-remote") return {ok:remote!=="",stdout:remote?remote+"\trefs/heads/main":"",stderr:"",status:remote?0:1};
      throw new Error("mutated");
    };
    assert.throws(()=>refreshControlRuntime({state,sourceRoot:process.cwd(),gitRun:run}),/local HEAD must match remote main/);
    assert.deepEqual(fs.readdirSync(control),before);
  }
});

test("runtime refresh rejects pre-staged changes before copying",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"orchestrator-staged-"));
  const control=path.join(root,"control"); fs.mkdirSync(path.join(control,"scripts"),{recursive:true});
  git(["init","-b","main"],control); git(["config","user.name","fixture"],control); git(["config","user.email","fixture@example.invalid"],control);
  fs.writeFileSync(path.join(control,"scripts","unrelated.mjs"),"before\n"); git(["add","."],control); git(["commit","-m","fixture"],control);
  fs.writeFileSync(path.join(control,"scripts","unrelated.mjs"),"staged\n"); git(["add","."],control);
  const state={control_environment_ready:true,control_repository:"owner/control",control_clone_path:control,runner_label:"valid"};
  const snapshot=git(["diff","--cached","--binary"],control)+git(["diff","--binary"],control);
  const run=(command,args,options)=>{
    if(args[0]==="config"&&args[1]==="--get") return {ok:true,stdout:"https://github.com/owner/control",stderr:"",status:0};
    if(args[0]==="config") return {ok:true,stdout:"",stderr:"",status:0};
    if(args[0]==="branch") return {ok:true,stdout:"main",stderr:"",status:0};
    if(args[0]==="rev-parse") return {ok:true,stdout:git(args,options.cwd).trim(),stderr:"",status:0};
    if(args[0]==="ls-remote") return {ok:true,stdout:git(["rev-parse","HEAD"],control).trim()+"\trefs/heads/main",stderr:"",status:0};
    return {ok:true,stdout:"",stderr:"",status:0};
  };
  assert.throws(()=>refreshControlRuntime({state,sourceRoot:process.cwd(),gitRun:run}),/pre-staged/);
  assert.equal(git(["diff","--cached","--binary"],control)+git(["diff","--binary"],control),snapshot);
  assert.equal(git(["log","-1","--format=%s"],control).trim(),"fixture");
});

test("runtime refresh rejects missing or mismatched control identity before mutation",()=>{
  assert.throws(()=>refreshControlRuntime({state:{control_environment_ready:true,runner_label:"valid"},sourceRoot:process.cwd()}),/identity/i);
  assert.throws(()=>refreshControlRuntime({state:{control_environment_ready:true,control_repository:"owner/control",control_clone_path:process.cwd(),runner_label:"valid"},sourceRoot:process.cwd()}),/push destination/i);
  assert.throws(()=>refreshControlRuntime({state:{control_environment_ready:true,control_repository:"owner/other",control_clone_path:process.cwd(),runner_label:"valid"},sourceRoot:process.cwd()}),/push destination/i);
});
