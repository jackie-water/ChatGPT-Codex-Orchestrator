import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {verifyMacosGeneratedRepositories,refreshControlRuntime} from "../src/lib/control-env.mjs";
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

function refreshTreeSnapshot(root){
  const entries={};
  const visit=(file,relative)=>{
    const st=fs.lstatSync(file);
    entries[relative]={dev:st.dev,ino:st.ino,mode:st.mode,uid:st.uid,gid:st.gid,nlink:st.nlink,
      ...(st.isSymbolicLink()?{link:fs.readlinkSync(file)}:st.isFile()?{bytes:fs.readFileSync(file).toString("base64")}:{directory:st.isDirectory()})};
    if(st.isDirectory()) for(const name of fs.readdirSync(file).sort()) visit(path.join(file,name),path.posix.join(relative,name));
  };
  visit(root,"");
  return entries;
}

function registrationRefreshFixture(t,{platform="darwin"}={}){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"orchestrator-registration-refresh-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const control=path.join(root,"control");
  const write=(name,value)=>{const file=path.join(control,...name.split("/"));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  const instanceRoot=path.join(os.homedir(),".chatgpt-codex-orchestrator","instances","abcd1234");
  const state={control_environment_ready:true,control_clone_path:control,control_repository:"owner/control",
    sandbox_repository:"owner/sandbox",installation_id:"abcd1234-fixture",instance_id:"abcd1234",
    instance_platform:platform,instance_arch:platform==="darwin"?"arm64":"x64",github_login:"owner",
    runner_label:"codex-orchestrator-abcd1234",launch_agent_label:platform==="darwin"?"com.chatgpt.codex.abcd1234":null,
    ...(platform==="darwin"?{instance_root:instanceRoot,control_repository_id:"101",browser_profile:path.join(instanceRoot,"browser-profile"),
      browser_port:13333,chat_route_file:path.join(instanceRoot,"chat-routes.json"),pending_wake_outbox:path.join(instanceRoot,"pending-wakes")}: {})};
  const metadata={schema_version:1,instance_id:state.instance_id,platform,arch:state.instance_arch,
    runner_label:state.runner_label,control_repository:state.control_repository,trusted_github_username:state.github_login,
    launch_agent_label:state.launch_agent_label,
    ...(platform==="darwin"?{installation_id:state.installation_id,sandbox_repository:state.sandbox_repository,role:"control",
      codex_executable:fs.realpathSync(process.execPath),instance_root:state.instance_root,control_repository_id:state.control_repository_id,
      browser_profile:state.browser_profile,browser_port:state.browser_port,chat_route_file:state.chat_route_file,pending_wake_outbox:state.pending_wake_outbox}: {})};
  const writeMetadata=()=>write("instance.json",JSON.stringify(metadata,null,2)+"\n");
  writeMetadata();
  write(".git/index","synthetic index must survive rejected refresh\n");
  write(".git/HEAD","ref: refs/heads/main\n");
  write(".github/workflows/orchestrator.yml","earlier workflow\n");
  write("scripts/register-chat.mjs","earlier registrar\n");
  write("scripts/capture-chat-origins.mjs","earlier routing script\n");
  write("projects.json",'{"projects":{"orchestrator-dev":{"repository":"owner/application","enabled":false}}}\n');
  write("chat-routes.json",'{"version":1,"routes":[]}\n');
  write("pending-wakes/pending.json",'{"delivery_state":"PENDING"}\n');
  return {root,control,state,metadata,writeMetadata};
}

// No process or network is available through this adapter. Its index, commit
// and push results exist only in memory; the fixture is not a Git repository.
function registrationRefreshGit(control){
  const calls=[];
  const head="a".repeat(40);
  let staged=[];
  const ok=stdout=>({ok:true,stdout:stdout||"",status:0});
  const gitRun=(command,args,options)=>{
    assert.equal(command,"git");assert.equal(options.cwd,control);calls.push([...args]);
    const joined=args.join(" ");
    if(joined==="config --get remote.origin.url")return ok("https://github.com/owner/control.git");
    if(joined==="config --get-all remote.origin.pushurl")return ok("");
    if(joined==="rev-parse --show-toplevel")return ok(control);
    if(joined==="branch --show-current")return ok("main");
    if(joined==="rev-parse HEAD")return ok(head);
    if(joined==="ls-remote --heads origin refs/heads/main")return ok(head+"\trefs/heads/main");
    if(joined==="diff --cached --quiet")return {...ok(""),ok:staged.length===0,status:staged.length?1:0};
    if(joined==="diff --cached --name-only")return ok(staged.join("\n"));
    if(args[0]==="ls-files")return ok("scripts/capture-chat-origins.mjs");
    if(args[0]==="add"){staged.push(...args.slice(args.indexOf("--")+1));return ok("");}
    if(args.includes("commit")){assert.ok(staged.length);staged=[];return ok("");}
    if(joined==="push origin HEAD:main")return ok("");
    throw new Error("Unsupported synthetic Git call: "+joined);
  };
  return {calls,gitRun};
}

test("current pinned macOS Control metadata permits refresh without rewriting registration identity",t=>{
  const f=registrationRefreshFixture(t);
  const original=refreshTreeSnapshot(f.control)["instance.json"];
  const git=registrationRefreshGit(f.control);
  const result=refreshControlRuntime({state:f.state,sourceRoot:path.resolve(import.meta.dirname,".."),gitRun:git.gitRun});
  assert.equal(result.changed,true);
  assert.deepEqual(refreshTreeSnapshot(f.control)["instance.json"],original,"refresh must preserve metadata inode, bytes, ownership and modes");
  assert.match(fs.readFileSync(path.join(f.control,"scripts/register-chat.mjs"),"utf8"),/Pinned macOS registration identity is incomplete/);
  assert.match(fs.readFileSync(path.join(f.control,".github/workflows/orchestrator.yml"),"utf8"),/self-hosted, macOS, ARM64, codex-orchestrator-abcd1234/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.control,"projects.json"),"utf8")).projects["orchestrator-dev"].enabled,false);
  assert.equal(git.calls.filter(args=>args.includes("commit")).length,1);
  assert.equal(git.calls.filter(args=>args[0]==="push").length,1);
});

test("legacy C2 macOS Control metadata refuses refresh before reads of payload or any publication side effect",t=>{
  const f=registrationRefreshFixture(t);
  for(const name of ["instance_root","control_repository_id","browser_profile","browser_port","chat_route_file","pending_wake_outbox"])delete f.metadata[name];
  f.writeMetadata();
  const before=refreshTreeSnapshot(f.root);
  const stateBefore=structuredClone(f.state);
  const calls=[];
  assert.throws(()=>refreshControlRuntime({state:f.state,sourceRoot:path.join(f.root,"absent-payload"),
    gitRun:(...args)=>{calls.push(args);throw new Error("legacy refusal must precede Git");}}),/MACOS-CONTROL-MIGRATION-REQUIRED/);
  assert.deepEqual(refreshTreeSnapshot(f.root),before,"no metadata/runtime/workflow/route/outbox/index files may change");
  assert.deepEqual(f.state,stateBefore,"legacy metadata must not be auto-migrated through installation state");
  assert.deepEqual(calls,[],"refusal must precede even read-only Git queries, staging, commit and push");
});

test("missing, malformed or contradictory registrar pins require read-only explicit macOS migration",async t=>{
  const mutations=[
    ["installation",f=>delete f.metadata.installation_id],
    ["instance",f=>delete f.metadata.instance_root],
    ["foreign instance",f=>f.metadata.instance_root+="-other"],
    ["route",f=>delete f.metadata.chat_route_file],
    ["foreign route",f=>f.metadata.chat_route_file=path.join(f.metadata.instance_root,"other-routes.json")],
    ["outbox",f=>delete f.metadata.pending_wake_outbox],
    ["repository ID",f=>delete f.metadata.control_repository_id],
    ["foreign repository ID",f=>f.metadata.control_repository_id="202"],
    ["non-numeric repository ID",f=>f.metadata.control_repository_id="owner/control"],
    ["profile",f=>delete f.metadata.browser_profile],
    ["port",f=>delete f.metadata.browser_port],
    ["string port",f=>f.metadata.browser_port="13333"],
    ["privileged port",f=>f.metadata.browser_port=80],
    ["state pin mismatch",f=>f.state.browser_port=13334],
    ["unsupported registrar architecture",f=>{f.state.instance_arch="x64";f.metadata.arch="x64";}]
  ];
  for(const [name,mutate] of mutations)await t.test(name,t=>{
    const f=registrationRefreshFixture(t);mutate(f);f.writeMetadata();
    const before=refreshTreeSnapshot(f.root);
    const calls=[];
    assert.throws(()=>refreshControlRuntime({state:f.state,sourceRoot:path.join(f.root,"absent-payload"),
      gitRun:(...args)=>{calls.push(args);throw new Error("no Git permitted");}}),/MACOS-CONTROL-MIGRATION-REQUIRED/);
    assert.deepEqual(refreshTreeSnapshot(f.root),before);
    assert.deepEqual(calls,[]);
  });
});

test("Windows runtime refresh preserves its earlier metadata schema without macOS registration pins",t=>{
  const f=registrationRefreshFixture(t,{platform:"win32"});
  const original=refreshTreeSnapshot(f.control)["instance.json"];
  const git=registrationRefreshGit(f.control);
  assert.equal(refreshControlRuntime({state:f.state,sourceRoot:path.resolve(import.meta.dirname,".."),gitRun:git.gitRun}).changed,true);
  assert.deepEqual(refreshTreeSnapshot(f.control)["instance.json"],original);
  assert.match(fs.readFileSync(path.join(f.control,".github/workflows/orchestrator.yml"),"utf8"),/self-hosted, Windows, X64, codex-orchestrator-abcd1234/);
  assert.equal(git.calls.filter(args=>args[0]==="push").length,1);
});
