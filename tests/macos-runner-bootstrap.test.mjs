import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { inspectMacosRunnerBootstrap, approveMacosRunnerBootstrap, MACOS_RUNNER_RUNTIME_PATH } from "../src/lib/macos-runner-bootstrap.mjs";

const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const syntheticHomes=[];
afterEach(()=>{for(const home of syntheticHomes.splice(0))fs.rmSync(home,{recursive:true,force:true});});
function syntheticArchive(binary) {
  const header=Buffer.alloc(512);header.write("bin/Runner.Listener");header.write("0000700\0",100);header.write("0000000\0",108);header.write("0000000\0",116);header.write(binary.length.toString(8).padStart(11,"0")+"\0",124);header.write("00000000000\0",136);header.fill(32,148,156);header[156]=48;header.write("ustar\0",257);
  const checksum=header.reduce((sum,byte)=>sum+byte,0);header.write(checksum.toString(8).padStart(6,"0")+"\0 ",148);
  return gzipSync(Buffer.concat([header,binary,Buffer.alloc((512-binary.length%512)%512),Buffer.alloc(1024)]));
}
function fixture() {
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"orch-first-runner-")),short="abcdef12",root=path.join(home,".chatgpt-codex-orchestrator","instances",short),runner=path.join(root,"runner"),executable=path.join(runner,"bin","Runner.Listener"),control=path.join(home,"control"),codex=path.join(home,"codex");
  syntheticHomes.push(home);
  const state={installation_id:"abcdef12-3456",instance_id:short,instance_root:root,runner_path:runner,runner_owner:"abcdef12-3456",runner_label:`codex-orchestrator-${short}`,launch_agent_label:`com.chatgpt.codex.${short}`,sandbox_only:true,target_environment_ready:false,github_login:"owner",control_repository:`owner/chatgpt-codex-orchestrator-control-${short}`,control_repository_id:"101",sandbox_repository:`owner/chatgpt-codex-orchestrator-sandbox-${short}`,sandbox_repository_id:"202",sandbox_project_key:`sandbox-${short}`,browser_profile:path.join(root,"browser-profile"),browser_port:13333,pending_wake_outbox:path.join(root,"pending-wakes"),control_clone_path:control};
  for(const dir of [path.dirname(executable),state.browser_profile,state.pending_wake_outbox,control])fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const binary=Buffer.alloc(32);binary.writeUInt32LE(0xfeedfacf,0);binary.writeUInt32LE(0x0100000c,4);binary.writeUInt32LE(2,12);
  fs.writeFileSync(executable,binary,{mode:0o700});fs.writeFileSync(codex,"synthetic Codex never executed\n",{mode:0o700});fs.writeFileSync(path.join(home,"gh"),"synthetic gh never executed\n",{mode:0o700});
  for(const name of [".credentials",".credentials_rsaparams"])fs.writeFileSync(path.join(runner,name),"{}",{mode:0o600});
  const config={agentId:303,agentName:state.runner_label,gitHubUrl:`https://github.com/${state.control_repository}`,serverUrl:"https://example.actions.githubusercontent.com/runner/",workFolder:"_work"};
  const writeJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});writeJson(path.join(runner,".runner"),config);
  writeJson(path.join(control,"instance.json"),{schema_version:1,role:"control",installation_id:state.installation_id,instance_id:short,instance_root:root,platform:"darwin",arch:"arm64",runner_label:state.runner_label,launch_agent_label:state.launch_agent_label,trusted_github_username:state.github_login,control_repository:state.control_repository,sandbox_repository:state.sandbox_repository,control_repository_id:"101",sandbox_repository_id:"202",browser_profile:state.browser_profile,browser_port:state.browser_port,pending_wake_outbox:state.pending_wake_outbox,codex_executable:codex});
  writeJson(path.join(control,"projects.json"),{projects:{[state.sandbox_project_key]:{repository:state.sandbox_repository,enabled:true},"orchestrator-dev":{repository:"owner/orchestrator-dev",enabled:false}}});
  const archive=syntheticArchive(binary);fs.writeFileSync(path.join(root,"runner-package.tar.gz"),archive,{mode:0o600});
  const approval={schema_version:1,installation_id:state.installation_id,instance_id:short,instance_path:root,project:state.sandbox_project_key,control_repository:state.control_repository,sandbox_repository:state.sandbox_repository,control_repository_id:"101",sandbox_repository_id:"202",runner_path:runner,runner_executable:executable,runner_label:state.runner_label,launch_agent_label:state.launch_agent_label,browser_profile:state.browser_profile,browser_port:state.browser_port,pending_wake_outbox:state.pending_wake_outbox,source_version:"2.999.0",source_url:"https://github.com/actions/runner/releases/download/v2.999.0/actions-runner-osx-arm64-2.999.0.tar.gz",archive_sha256:hash(archive),executable_sha256:hash(binary),binary_manifest:{"bin/Runner.Listener":hash(binary)},config_sha256:hash(fs.readFileSync(path.join(runner,".runner"))),runner_id:"303",github_user_id:"404",approved_action:"use-existing-official-macos-arm64-runner",approved_by:"owner",approval_id:"human-fixture123",approved_at:"2026-10-22T00:00:00.000Z"};
  approval.source_release_id="505";approval.source_asset_id="606";approval.runtime_path=MACOS_RUNNER_RUNTIME_PATH;
  const receipt=path.join(root,"macos-runner-approval.json"),candidate=path.join(root,"macos-runner-candidate.json");writeJson(receipt,approval);writeJson(candidate,approval);
  const remoteRunner={id:303,name:state.runner_label,os:"osx",status:"online",busy:false,labels:["self-hosted","macOS","ARM64",state.runner_label].map(name=>({name}))};
  const calls=[];
  const commandRunner=(command,args)=>{
    calls.push({command,args});
    if(command==="/usr/bin/which")return {ok:true,output:`/usr/local/bin/${args[0]}`};
    if(command==="/usr/sbin/lsof")return {ok:true,output:`p123\ncGoogle Chrome\nn127.0.0.1:${state.browser_port}\n`};
    if(command==="/bin/ps")return args.includes("-axo")?{ok:true,output:`${process.getuid?.()||0} 456 ${executable} run`}:{ok:true,output:`${process.getuid?.()||0} /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${state.browser_profile} --remote-debugging-port=${state.browser_port}`};
    if(command===codex)return {ok:true,output:"Logged in using ChatGPT"};
    if(command!=="gh")throw new Error("Unexpected synthetic command");
    const endpoint=args.at(-1);
    if(endpoint==="user")return {ok:true,output:JSON.stringify({id:404,login:"owner"})};
    if(endpoint.startsWith("repos/actions/runner/releases/"))return {ok:true,output:JSON.stringify({id:505,tag_name:"v2.999.0",draft:false,prerelease:false,assets:[{id:606,name:"actions-runner-osx-arm64-2.999.0.tar.gz",browser_download_url:approval.source_url,digest:`sha256:${approval.archive_sha256}`,state:"uploaded"}]})};
    if(endpoint.includes("/actions/runners"))return {ok:true,output:JSON.stringify({total_count:1,runners:[remoteRunner]})};
    const sandbox=endpoint===`repos/${state.sandbox_repository}`;return {ok:true,output:JSON.stringify({id:sandbox?202:101,full_name:sandbox?state.sandbox_repository:state.control_repository,private:true,owner:{id:404,login:"owner"}})};
  };
  const fsImpl=Object.create(fs);
  fsImpl.lstatSync=file=>MACOS_RUNNER_RUNTIME_PATH.split(":").includes(file)?fs.lstatSync(home):fs.lstatSync(file);
  fsImpl.realpathSync=file=>file==="/usr/local/bin/node"?fs.realpathSync(process.execPath):file==="/usr/local/bin/gh"?path.join(home,"gh"):fs.realpathSync(file);
  return {home,root,runner,executable,codex,state,approval,receipt,candidate,remoteRunner,calls,writeJson,options:{state,home,platform:"darwin",arch:"arm64",commandRunner,fsImpl}};
}

test("strict bootstrap independently verifies live Mac ARM64 runner without mutations",()=>{
  const f=fixture(),before=fs.readFileSync(f.receipt);const result=inspectMacosRunnerBootstrap({...f.options,requireOnline:true});
  assert.equal(result.status,"PASS");assert.equal(result.runner_executable,f.executable);assert.deepEqual(result.program_arguments,["run"]);assert.equal(result.runner_id,"303");assert.equal(result.approval_sha256,hash(before));assert.deepEqual(fs.readFileSync(f.receipt),before);assert.equal(f.calls.some(x=>["launchctl","config.sh","curl","tar"].includes(x.command)),false);
});

test("historical unsafe instance bytes are never examined or changed by selected runner inspection",()=>{
  const f=fixture(),old=path.join(path.dirname(f.root),"1832f0bb");fs.mkdirSync(old,{mode:0o755});const file=path.join(old,"legacy.json"),bytes=Buffer.from("unsafe historical root preserved byte for byte\n");fs.writeFileSync(file,bytes,{mode:0o666});const before=fs.lstatSync(file);
  assert.equal(inspectMacosRunnerBootstrap(f.options).status,"PASS");assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.lstatSync(file).mode,before.mode);assert.equal(fs.lstatSync(file).ino,before.ino);
});

test("wrong missing and colliding immutable repository identities fail before launch",()=>{
  for(const patch of [{control_repository_id:undefined},{sandbox_repository_id:"101"},{control_repository_id:"999"}]){
    const f=fixture();Object.assign(f.state,patch);assert.equal(inspectMacosRunnerBootstrap(f.options).status,"ERROR");
  }
  const f=fixture();const commandRunner=(command,args)=>{const result=f.options.commandRunner(command,args);if(command==="gh"&&args.at(-1)===`repos/${f.state.control_repository}`){const body=JSON.parse(result.output);body.id=999;return {ok:true,output:JSON.stringify(body)};}return result;};
  assert.equal(inspectMacosRunnerBootstrap({...f.options,commandRunner}).error_id,"MACOS-RUNNER-REPOSITORY");
});

test("bogus approval, directory executable, hardlink, symlink and unsafe permissions fail closed",()=>{
  for(const kind of ["receipt","directory","hardlink","symlink","mode","missing"]){
    const f=fixture();if(kind==="receipt")f.writeJson(f.receipt,{...f.approval,instance_id:"foreign"});
    if(kind==="directory"){fs.unlinkSync(f.executable);fs.mkdirSync(f.executable,{mode:0o700});}
    if(kind==="hardlink")fs.linkSync(f.executable,path.join(f.home,"duplicate"));
    if(kind==="symlink"){const bytes=fs.readFileSync(f.executable);fs.unlinkSync(f.executable);fs.writeFileSync(path.join(f.home,"foreign"),bytes,{mode:0o700});fs.symlinkSync(path.join(f.home,"foreign"),f.executable);}
    if(kind==="mode")fs.chmodSync(f.executable,0o777);if(kind==="missing")fs.unlinkSync(f.executable);
    assert.notEqual(inspectMacosRunnerBootstrap(f.options).status,"PASS",kind);
  }
});

test("wrong runner label OS architecture extra runners and offline registration are rejected",()=>{
  for(const patch of [{os:"linux"},{name:"production"},{labels:[{name:"self-hosted"},{name:"macOS"},{name:"X64"},{name:"wrong"}]},{busy:true}]){const f=fixture();Object.assign(f.remoteRunner,patch);assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-REMOTE");}
  const f=fixture();f.remoteRunner.status="offline";assert.equal(inspectMacosRunnerBootstrap({...f.options,requireOnline:true}).error_id,"MACOS-RUNNER-OFFLINE");assert.equal(inspectMacosRunnerBootstrap(f.options).status,"PASS");
  const extra=(command,args)=>command==="gh"&&args.at(-1).includes("/actions/runners")?{ok:true,output:JSON.stringify({total_count:2,runners:[f.remoteRunner,{...f.remoteRunner,id:999}]})}:f.options.commandRunner(command,args);
  assert.equal(inspectMacosRunnerBootstrap({...f.options,commandRunner:extra}).error_id,"MACOS-RUNNER-EXTRA");assert.equal(inspectMacosRunnerBootstrap({...f.options,platform:"win32"}).error_id,"MACOS-RUNNER-PLATFORM");
});

test("API-key Codex login and a port owned by another browser profile cannot authorize startup",()=>{
  const f=fixture();const login=(command,args)=>command===f.codex?{ok:true,output:"Logged in using an API key"}:f.options.commandRunner(command,args);assert.equal(inspectMacosRunnerBootstrap({...f.options,commandRunner:login}).error_id,"MACOS-RUNNER-CODEX-LOGIN");
  const foreign=(command,args)=>command==="/bin/ps"?{ok:true,output:`${process.getuid?.()||0} /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/production --remote-debugging-port=${f.state.browser_port}`}:f.options.commandRunner(command,args);assert.equal(inspectMacosRunnerBootstrap({...f.options,commandRunner:foreign}).error_id,"MACOS-RUNNER-BROWSER-CONFLICT");
});

test("official package approval needs exact human challenge and never overwrites a receipt",()=>{
  const f=fixture();fs.unlinkSync(f.receipt);const inspected=inspectMacosRunnerBootstrap({...f.options,requireApproval:false});assert.equal(inspected.action_id,"macos_runner_package_approval");
  assert.equal(approveMacosRunnerBootstrap({...f.options,approval:"0".repeat(64)}).status,"ERROR");assert.equal(fs.existsSync(f.receipt),false);
  const approved=approveMacosRunnerBootstrap({...f.options,approval:inspected.approval_challenge});assert.equal(approved.status,"PASS");const bytes=fs.readFileSync(f.receipt);
  assert.equal(approveMacosRunnerBootstrap({...f.options,approval:inspected.approval_challenge}).status,"ERROR");assert.deepEqual(fs.readFileSync(f.receipt),bytes);
});

test("official release digest, extracted bytes and actual disabled target registry are independently required",()=>{
  const f=fixture();const badRelease=(command,args)=>{const result=f.options.commandRunner(command,args);if(command==="gh"&&args.at(-1).startsWith("repos/actions/runner/releases/")){const data=JSON.parse(result.output);delete data.assets[0].digest;return {ok:true,output:JSON.stringify(data)};}return result;};
  assert.equal(inspectMacosRunnerBootstrap({...f.options,commandRunner:badRelease}).error_id,"MACOS-RUNNER-OFFICIAL-SOURCE");
  const changed=Buffer.from(fs.readFileSync(f.executable));changed[31]=1;fs.writeFileSync(f.executable,changed);const forged={...f.approval,executable_sha256:hash(changed),binary_manifest:{"bin/Runner.Listener":hash(changed)}};f.writeJson(f.receipt,forged);
  assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE");
  const second=fixture();second.writeJson(path.join(second.state.control_clone_path,"projects.json"),{projects:{[second.state.sandbox_project_key]:{repository:second.state.sandbox_repository,enabled:true},"orchestrator-dev":{repository:"owner/orchestrator-dev",enabled:true}}});
  assert.equal(inspectMacosRunnerBootstrap(second.options).error_id,"MACOS-RUNNER-TARGET-ENABLED");
});

test("extra local runner and unsafe selected HOME ancestors are refused without mutation",()=>{
  const f=fixture();const extra=(command,args)=>command==="/bin/ps"&&args.includes("-axo")?{ok:true,output:`${process.getuid?.()||0} 456 /production/runner/bin/Runner.Listener run`}:f.options.commandRunner(command,args);
  assert.equal(inspectMacosRunnerBootstrap({...f.options,commandRunner:extra}).error_id,"MACOS-RUNNER-PROCESS-CONFLICT");
  const linked=path.join(f.home,"linked-home");fs.symlinkSync(f.home,linked);assert.equal(inspectMacosRunnerBootstrap({...f.options,home:linked}).error_id,"MACOS-RUNNER-PATH");
  const stat=fs.lstatSync(f.home);fs.chmodSync(f.home,0o777);assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PATH");assert.equal(fs.lstatSync(f.home).mode&0o777,0o777);fs.chmodSync(f.home,stat.mode&0o777);
});
