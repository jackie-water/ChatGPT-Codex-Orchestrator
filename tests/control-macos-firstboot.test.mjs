import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {verifyMacosGeneratedRepositories} from "../src/lib/control-env.mjs";
import {defaultLocalPaths,renderWorkflow,renderConfigPs1} from "../src/lib/control-render.mjs";

function githubFixture(){
  const state={installation_id:"abcd1234-fixture",github_login:"owner",control_repository:"owner/chatgpt-codex-orchestrator-control-abcd1234",sandbox_repository:"owner/chatgpt-codex-orchestrator-sandbox-abcd1234"};
  const records={user:{login:"owner",id:77}};
  for(const [role,id] of [["control",101],["sandbox",202]]) records[`repos/${state[`${role}_repository`]}`]={id,full_name:state[`${role}_repository`],name:state[`${role}_repository`].split("/")[1],private:true,owner:{login:"owner",id:77},description:`ChatGPT Codex Orchestrator ${role} installation ${state.installation_id}`};
  const calls=[];
  const commandRunner=(command,args)=>{assert.equal(command,"gh");assert.equal(args[0],"api");calls.push(args);return {ok:true,stdout:JSON.stringify(records[args[1]])};};
  return {state,records,calls,commandRunner};
}

test("generated Mac Control/Sandbox authority pins independently owned distinct immutable IDs",()=>{
  const f=githubFixture();
  assert.deepEqual(verifyMacosGeneratedRepositories(f),{control_repository_id:"101",sandbox_repository_id:"202",github_owner_id:"77"});
  assert.equal(f.calls.length,3);
  assert.ok(f.calls.every(args=>args[0]==="api"),"verification cannot create repositories");
});

test("missing/wrong GitHub IDs, owner, visibility, role and pinned identity are rejected",()=>{
  for(const mutate of [
    f=>delete f.records[`repos/${f.state.control_repository}`].id,
    f=>f.records[`repos/${f.state.sandbox_repository}`].id=101,
    f=>f.records[`repos/${f.state.control_repository}`].owner.id=88,
    f=>f.records[`repos/${f.state.control_repository}`].private=false,
    f=>f.records[`repos/${f.state.control_repository}`].description="unrelated Control",
    f=>f.records.user.login="other",
    f=>f.state.github_owner_id="88",
    f=>f.state.control_repository_id="999",
    f=>f.state.sandbox_repository=f.state.control_repository
  ]){
    const f=githubFixture();mutate(f);
    assert.throws(()=>verifyMacosGeneratedRepositories(f));
  }
});

test("first-boot paths isolate Mac runner/target and preserve Windows path conventions",()=>{
  const args={home:"/synthetic/home",installationId:"abcd1234-fixture",projectKey:"orchestrator-dev"};
  const mac=defaultLocalPaths({...args,platform:"darwin"});
  const windows=defaultLocalPaths({...args,platform:"win32"});
  const instance=path.join(args.home,".chatgpt-codex-orchestrator","instances","abcd1234");
  assert.equal(mac.runner,path.join(instance,"runner"));
  assert.equal(mac.project,path.join(instance,"automation",args.projectKey));
  assert.equal(windows.runner,path.join(args.home,"ChatGPTCodexOrchestrator","runner-abcd1234"));
  assert.equal(windows.project,path.join(args.home,"ChatGPTCodexProjects",args.projectKey));
  assert.equal(mac.runnerLabel,windows.runnerLabel);
  const config=renderConfigPs1({githubLogin:"owner",projectKey:"sandbox-abcd1234",projectClonePath:mac.project,runnerPath:mac.runner,browserPort:13333,browserProfile:path.join(instance,"browser-profile"),chatRouteFile:path.join(instance,"chat-routes.json"),instanceId:"runner-abcd1234"});
  assert.match(config,/ORCHESTRATOR_INSTANCE_ID = 'runner-abcd1234'/);
  assert.equal(renderWorkflow("runs-on: [self-hosted, {{RUNNER_OS}}, {{RUNNER_ARCH}}, {{RUNNER_LABEL}}]",{platform:"darwin",arch:"arm64",runnerLabel:mac.runnerLabel}),"runs-on: [self-hosted, macOS, ARM64, codex-orchestrator-abcd1234]");
});
