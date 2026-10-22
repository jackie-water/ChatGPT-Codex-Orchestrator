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
function nativeBinary(cpu=0x0100000c,type=2) {
  const bytes=Buffer.alloc(32);bytes.writeUInt32LE(0xfeedfacf,0);bytes.writeUInt32LE(cpu,4);bytes.writeUInt32LE(type,12);return bytes;
}
function syntheticArchive(entries,{endMarker=true,trailing=Buffer.alloc(0)}={}) {
  const chunks=[];
  for(const {name,bytes=Buffer.alloc(0),mode=0o700,type="0",link="",declaredSize=bytes.length,headerPatches=[],corruptChecksum=false} of entries) {
    const header=Buffer.alloc(512);header.write(name,0,100);header.write(mode.toString(8).padStart(7,"0")+"\0",100);header.write("0000000\0",108);header.write("0000000\0",116);header.write(declaredSize.toString(8).padStart(11,"0")+"\0",124);header.write("00000000000\0",136);header.fill(32,148,156);header[156]=type.charCodeAt(0);header.write(link,157,100);header.write("ustar\0",257);header.write("00",263);
    for(const [offset,value] of headerPatches)header[offset]=value;
    const checksum=header.reduce((sum,byte)=>sum+byte,0);header.write(checksum.toString(8).padStart(6,"0")+"\0 ",148);if(corruptChecksum)header[148]^=1;
    chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  if(endMarker)chunks.push(Buffer.alloc(1024));chunks.push(trailing);return gzipSync(Buffer.concat(chunks));
}
function fixture({runtimes=["node20","node24"]}={}) {
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"orch-first-runner-")),short="abcdef12",root=path.join(home,".chatgpt-codex-orchestrator","instances",short),runner=path.join(root,"runner"),executable=path.join(runner,"bin","Runner.Listener"),control=path.join(home,"control"),codex=path.join(home,"codex");
  syntheticHomes.push(home);
  const state={installation_id:"abcdef12-3456",instance_id:short,instance_root:root,runner_path:runner,runner_owner:"abcdef12-3456",runner_label:`codex-orchestrator-${short}`,launch_agent_label:`com.chatgpt.codex.${short}`,sandbox_only:true,target_environment_ready:false,github_login:"owner",control_repository:`owner/chatgpt-codex-orchestrator-control-${short}`,control_repository_id:"101",sandbox_repository:`owner/chatgpt-codex-orchestrator-sandbox-${short}`,sandbox_repository_id:"202",sandbox_project_key:`sandbox-${short}`,browser_profile:path.join(root,"browser-profile"),browser_port:13333,pending_wake_outbox:path.join(root,"pending-wakes"),control_clone_path:control};
  for(const dir of [path.dirname(executable),state.browser_profile,state.pending_wake_outbox,control])fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const binary=nativeBinary(),entries=[{name:"bin/Runner.Listener",bytes:binary},{name:"bin/Runner.Worker",bytes:nativeBinary()},{name:"bin/libhostfxr.dylib",bytes:nativeBinary(0x0100000c,6),mode:0o600},{name:"run.sh",bytes:Buffer.from("#!/bin/sh\n# Synthetic official script never executed\n")}];
  for(const runtime of runtimes)entries.push({name:`externals/${runtime}/bin/node`,bytes:nativeBinary()},{name:`externals/${runtime}/lib/runtime.dat`,bytes:Buffer.from(`synthetic ${runtime} package dependency\n`),mode:0o600});
  for(const entry of entries) { const file=path.join(runner,entry.name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,entry.bytes,{mode:entry.mode??0o700}); }
  fs.writeFileSync(codex,"synthetic Codex never executed\n",{mode:0o700});fs.writeFileSync(path.join(home,"gh"),"synthetic gh never executed\n",{mode:0o700});
  for(const name of [".credentials",".credentials_rsaparams"])fs.writeFileSync(path.join(runner,name),"{}",{mode:0o600});
  const config={agentId:303,agentName:state.runner_label,gitHubUrl:`https://github.com/${state.control_repository}`,serverUrl:"https://example.actions.githubusercontent.com/runner/",workFolder:"_work"};
  const writeJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});writeJson(path.join(runner,".runner"),config);
  writeJson(path.join(control,"instance.json"),{schema_version:1,role:"control",installation_id:state.installation_id,instance_id:short,instance_root:root,platform:"darwin",arch:"arm64",runner_label:state.runner_label,launch_agent_label:state.launch_agent_label,trusted_github_username:state.github_login,control_repository:state.control_repository,sandbox_repository:state.sandbox_repository,control_repository_id:"101",sandbox_repository_id:"202",browser_profile:state.browser_profile,browser_port:state.browser_port,pending_wake_outbox:state.pending_wake_outbox,codex_executable:codex});
  writeJson(path.join(control,"projects.json"),{projects:{[state.sandbox_project_key]:{repository:state.sandbox_repository,enabled:true},"orchestrator-dev":{repository:"owner/orchestrator-dev",enabled:false}}});
  const archive=syntheticArchive(entries);fs.writeFileSync(path.join(root,"runner-package.tar.gz"),archive,{mode:0o600});
  const approval={schema_version:1,installation_id:state.installation_id,instance_id:short,instance_path:root,project:state.sandbox_project_key,control_repository:state.control_repository,sandbox_repository:state.sandbox_repository,control_repository_id:"101",sandbox_repository_id:"202",runner_path:runner,runner_executable:executable,runner_label:state.runner_label,launch_agent_label:state.launch_agent_label,browser_profile:state.browser_profile,browser_port:state.browser_port,pending_wake_outbox:state.pending_wake_outbox,source_version:"2.999.0",source_url:"https://github.com/actions/runner/releases/download/v2.999.0/actions-runner-osx-arm64-2.999.0.tar.gz",archive_sha256:hash(archive),executable_sha256:hash(binary),binary_manifest:Object.fromEntries(entries.map(entry=>[entry.name,hash(entry.bytes)])),config_sha256:hash(fs.readFileSync(path.join(runner,".runner"))),runner_id:"303",github_user_id:"404",approved_action:"use-existing-official-macos-arm64-runner",approved_by:"owner",approval_id:"human-fixture123",approved_at:"2026-10-22T00:00:00.000Z"};
  approval.source_release_id="505";approval.source_asset_id="606";approval.runtime_path=MACOS_RUNNER_RUNTIME_PATH;approval.env_sha256=null;
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
  const replaceArchive=(nextEntries,archiveOptions)=>{
    const nextArchive=syntheticArchive(nextEntries,archiveOptions);fs.writeFileSync(path.join(root,"runner-package.tar.gz"),nextArchive);approval.archive_sha256=hash(nextArchive);
    approval.binary_manifest=Object.fromEntries(nextEntries.filter(entry=>!entry.type||entry.type==="0").map(entry=>[entry.name,hash(entry.bytes||Buffer.alloc(0))]));writeJson(receipt,approval);writeJson(candidate,approval);
  };
  return {home,root,runner,executable,codex,state,approval,receipt,candidate,remoteRunner,calls,writeJson,entries,replaceArchive,options:{state,home,platform:"darwin",arch:"arm64",commandRunner,fsImpl}};
}
function approveEnvironment(f,contents) {
  const file=path.join(f.runner,".env");
  if(contents!==null)fs.writeFileSync(file,contents,{mode:0o600});
  f.approval.env_sha256=contents===null?null:hash(contents);
  f.writeJson(f.receipt,f.approval);f.writeJson(f.candidate,f.approval);
  return file;
}

test("runner .env permits approved absence or exact private locale bytes with nofollow reads",()=>{
  const absent=fixture();assert.equal(inspectMacosRunnerBootstrap(absent.options).env_sha256,null);
  for(const contents of ["","LANG=C","LC_ALL=C\n","LANG=C\nLC_ALL=C\n","LC_ALL=C\nLANG=C"]) {
    const f=fixture(),file=approveEnvironment(f,contents),fsImpl=Object.create(f.options.fsImpl);let opens=0;
    fsImpl.openSync=(target,flags,...args)=>{if(target===file){opens++;assert.ok(flags&fs.constants.O_NOFOLLOW);assert.ok(flags&fs.constants.O_NONBLOCK);}return fs.openSync(target,flags,...args);};
    const result=inspectMacosRunnerBootstrap({...f.options,fsImpl});
    assert.equal(result.status,"PASS");assert.equal(result.env_sha256,hash(contents));assert.equal(opens,2);
    fs.chmodSync(file,0o400);assert.equal(inspectMacosRunnerBootstrap(f.options).status,"PASS");
  }
});

test("runner .env rejects unsafe keys and injection even with matching approved content digests",()=>{
  for(const contents of [
    "PATH=/foreign/bin\n",`PATH=${MACOS_RUNNER_RUNTIME_PATH}\n`,"NODE_OPTIONS=--require=/foreign/secret-token\n",
    "DYLD_INSERT_LIBRARIES=/foreign/secret-token\n","HOME=/foreign\n","ACTIONS_RUNNER_HOOK_JOB_STARTED=/foreign\n",
    "ORCHESTRATOR_CHAT_URL=https://chatgpt.com/c/foreign\n","ORCHESTRATOR_MACOS_NATIVE_HELPER=/foreign\n","UNAPPROVED=value\n",
    "LANG=C.UTF-8\n","export LANG=C\n","LANG='C'\n","LANG=C \n","# comment\n","\n","LANG=C\n\n","LANG=C\nLANG=C\n",
    "LANG=C\r\n","LANG=C\u2028","\ufeffLANG=C\n","LANG=C\0\n","LANG=C;PATH=/foreign/bin\n","LANG=C\nPATH=/foreign/bin\n"
  ]) {
    const f=fixture();approveEnvironment(f,contents);const result=inspectMacosRunnerBootstrap(f.options);
    assert.equal(result.error_id,"MACOS-RUNNER-ENV",JSON.stringify(contents));
    assert.equal(JSON.stringify(result).includes("secret-token"),false);assert.equal(JSON.stringify(result).includes(contents),false);
  }
});

test("runner .env rejects insecure files links ownership modes and unbounded contents",()=>{
  for(const kind of ["symlink","hardlink","directory","group-readable","public","executable","special-mode","owner","bound"]) {
    if(kind==="owner"&&typeof process.getuid!=="function")continue;
    const f=fixture(),file=approveEnvironment(f,"LANG=C\n");let fsImpl=f.options.fsImpl;
    if(kind==="symlink"){fs.renameSync(file,path.join(f.home,"env-target"));fs.symlinkSync(path.join(f.home,"env-target"),file);}
    if(kind==="hardlink")fs.linkSync(file,path.join(f.home,"env-alias"));
    if(kind==="directory"){fs.unlinkSync(file);fs.mkdirSync(file,{mode:0o700});}
    if(kind==="group-readable")fs.chmodSync(file,0o640);if(kind==="public")fs.chmodSync(file,0o644);
    if(kind==="executable")fs.chmodSync(file,0o700);if(kind==="special-mode")fs.chmodSync(file,0o4600);
    if(kind==="bound")approveEnvironment(f,"x".repeat(4097));
    if(kind==="owner"){fsImpl=Object.create(f.options.fsImpl);fsImpl.lstatSync=target=>{const st=f.options.fsImpl.lstatSync(target);if(target===file)Object.defineProperty(st,"uid",{value:process.getuid()+1});return st;};}
    assert.equal(inspectMacosRunnerBootstrap({...f.options,fsImpl}).error_id,"MACOS-RUNNER-ENV",kind);
  }
});

test("runner .env approval binds absence presence and exact safe contents across approval",()=>{
  for(const kind of ["missing-binding","invalid-binding","created","deleted","changed-safe"]) {
    const f=fixture(),file=path.join(f.runner,".env");
    if(kind==="missing-binding"){delete f.approval.env_sha256;f.writeJson(f.receipt,f.approval);f.writeJson(f.candidate,f.approval);}
    if(kind==="invalid-binding"){f.approval.env_sha256="unknown";f.writeJson(f.receipt,f.approval);}
    if(kind==="created")fs.writeFileSync(file,"LANG=C\n",{mode:0o600});
    if(kind==="deleted"){approveEnvironment(f,"LANG=C\n");fs.unlinkSync(file);}
    if(kind==="changed-safe"){approveEnvironment(f,"LANG=C\n");fs.writeFileSync(file,"LC_ALL=C\n");}
    assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-ENV",kind);
    if(kind==="missing-binding")assert.equal(inspectMacosRunnerBootstrap({...f.options,requireApproval:false}).error_id,"MACOS-RUNNER-ENV");
  }
  const f=fixture();fs.unlinkSync(f.receipt);const inspected=inspectMacosRunnerBootstrap({...f.options,requireApproval:false});
  fs.writeFileSync(path.join(f.runner,".env"),"LANG=C\n",{mode:0o600});
  assert.equal(approveMacosRunnerBootstrap({...f.options,approval:inspected.approval_challenge}).status,"ERROR");assert.equal(fs.existsSync(f.receipt),false);
});

test("runner .env late callback drift and nofollow descriptor races fail before authorization",()=>{
  for(const kind of ["late-safe","late-created","late-replaced","symlink-on-open","changed-during-read"]) {
    const f=fixture(),file=kind==="late-created"?path.join(f.runner,".env"):approveEnvironment(f,"LANG=C\n"),fsImpl=Object.create(f.options.fsImpl);let changed=false,tracked;
    const commandRunner=(command,args)=>{
      const result=f.options.commandRunner(command,args);
      if(command===f.codex&&kind.startsWith("late-")){
        if(kind==="late-replaced")fs.renameSync(file,path.join(f.home,"env-before-replacement"));
        fs.writeFileSync(file,kind==="late-replaced"?"LANG=C\n":"LC_ALL=C\n",{mode:0o600});changed=true;
      }
      return result;
    };
    fsImpl.openSync=(target,flags,...args)=>{
      if(target===file){
        if(kind==="symlink-on-open"&&!changed){fs.renameSync(file,path.join(f.home,"env-original"));fs.symlinkSync(path.join(f.home,"env-original"),file);changed=true;}
        tracked=fs.openSync(target,flags,...args);return tracked;
      }
      return fs.openSync(target,flags,...args);
    };
    fsImpl.readSync=(fd,...args)=>{const count=fs.readSync(fd,...args);if(fd===tracked&&kind==="changed-during-read"&&!changed){fs.writeFileSync(file,"LC_ALL=C\n");changed=true;}return count;};
    assert.equal(inspectMacosRunnerBootstrap({...f.options,commandRunner,fsImpl}).error_id,"MACOS-RUNNER-ENV",kind);assert.equal(changed,true,kind);
  }
});

test("strict bootstrap independently verifies live Mac ARM64 runner without mutations",()=>{
  const f=fixture(),before=fs.readFileSync(f.receipt);const result=inspectMacosRunnerBootstrap({...f.options,requireOnline:true});
  assert.equal(result.status,"PASS");assert.equal(result.runner_executable,f.executable);assert.deepEqual(result.program_arguments,["run"]);assert.equal(result.runner_id,"303");assert.equal(result.approval_sha256,hash(before));assert.deepEqual(fs.readFileSync(f.receipt),before);assert.equal(f.calls.some(x=>["launchctl","config.sh","curl","tar"].includes(x.command)),false);
});

test("official package binds every bundled runtime and its dependencies without assuming node20 is active",()=>{
  for(const runtimes of [["node20"],["node24"],["node20","node24"]]) {
    const f=fixture({runtimes}),before=Buffer.from(fs.readFileSync(f.receipt));
    assert.equal(inspectMacosRunnerBootstrap(f.options).status,"PASS",runtimes.join(","));
    for(const runtime of runtimes) {
      assert.equal(f.approval.binary_manifest[`externals/${runtime}/bin/node`],hash(fs.readFileSync(path.join(f.runner,"externals",runtime,"bin","node"))));
      assert.equal(f.approval.binary_manifest[`externals/${runtime}/lib/runtime.dat`],hash(fs.readFileSync(path.join(f.runner,"externals",runtime,"lib","runtime.dat"))));
    }
    assert.ok(f.approval.binary_manifest["run.sh"]);assert.ok(f.approval.binary_manifest["bin/libhostfxr.dylib"]);assert.deepEqual(fs.readFileSync(f.receipt),before);
    assert.equal(f.calls.some(({command})=>command.startsWith(f.runner)),false);
  }
});

test("missing replaced linked or nonexecutable action interpreters and package dependencies cannot pass",()=>{
  for(const relative of ["externals/node20/bin/node","externals/node24/bin/node","externals/node24/lib/runtime.dat","bin/libhostfxr.dylib","run.sh"]) {
    for(const kind of ["missing","bytes","symlink","hardlink","directory"]) {
      const f=fixture(),file=path.join(f.runner,relative),before=fs.readFileSync(file);
      if(kind==="missing")fs.unlinkSync(file);
      if(kind==="bytes")fs.writeFileSync(file,Buffer.concat([before,Buffer.from("tamper")]));
      if(kind==="symlink") { const target=path.join(f.home,"foreign-dependency");fs.writeFileSync(target,before,{mode:0o700});fs.unlinkSync(file);fs.symlinkSync(target,file); }
      if(kind==="hardlink")fs.linkSync(file,path.join(f.home,"identity-alias"));
      if(kind==="directory") { fs.unlinkSync(file);fs.mkdirSync(file,{mode:0o700}); }
      assert.notEqual(inspectMacosRunnerBootstrap(f.options).status,"PASS",`${relative}: ${kind}`);
    }
  }
  for(const relative of ["externals/node20/bin/node","externals/node24/bin/node"]) {
    const f=fixture();fs.chmodSync(path.join(f.runner,relative),0o600);assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-EXECUTABLE",relative);
  }
  const data=fixture();fs.chmodSync(path.join(data.runner,"externals/node24/lib/runtime.dat"),0o700);assert.equal(inspectMacosRunnerBootstrap(data.options).error_id,"MACOS-RUNNER-PACKAGE");
});

test("extra interpreters files empty directories and top-level executable dependencies are rejected",()=>{
  for(const relative of ["externals/node26/bin/node","externals/node20/bin/extra","externals/node24/lib/injected.dylib","bin/extra","foreign-interpreter","nested/foreign"]) {
    const f=fixture(),file=path.join(f.runner,relative);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,nativeBinary(),{mode:0o700});
    assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE",relative);
  }
  const f=fixture();fs.mkdirSync(path.join(f.runner,"externals/node24/unapproved-empty"),{mode:0o700});assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE");
  const state=fixture();fs.chmodSync(path.join(state.runner,".credentials"),0o700);assert.equal(inspectMacosRunnerBootstrap(state.options).error_id,"MACOS-RUNNER-PACKAGE");
});

test("full official archive manifest cannot omit forge or add an interpreter dependency",()=>{
  for(const kind of ["omit20","forge24","omit-data","extra","array"]) {
    const f=fixture(),manifest={...f.approval.binary_manifest};
    if(kind==="omit20")delete manifest["externals/node20/bin/node"];
    if(kind==="forge24")manifest["externals/node24/bin/node"]="0".repeat(64);
    if(kind==="omit-data")delete manifest["externals/node24/lib/runtime.dat"];
    if(kind==="extra")manifest["externals/node26/bin/node"]=hash(nativeBinary());
    f.writeJson(f.receipt,{...f.approval,binary_manifest:kind==="array"?Object.entries(manifest):manifest});
    assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE",kind);
  }
});

test("official archive requires native ARM64 bundled runtimes including every newer runtime",()=>{
  for(const relative of ["bin/Runner.Listener","bin/Runner.Worker","bin/libhostfxr.dylib","externals/node20/bin/node","externals/node24/bin/node"]) {
    const f=fixture(),entries=f.entries.map(entry=>entry.name===relative?{...entry,bytes:nativeBinary(0x01000007,relative.endsWith(".dylib")?6:2)}:entry);f.replaceArchive(entries);
    assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE",relative);
  }
  for(const kind of ["script","ELF","universal","non-executable","missing-node","no-runtimes"]) {
    const f=fixture();let entries=f.entries;
    if(kind==="script"||kind==="ELF"||kind==="universal")entries=entries.map(entry=>entry.name==="externals/node24/bin/node"?{...entry,bytes:kind==="script"?Buffer.from("#!/bin/sh\n"):kind==="ELF"?Buffer.from("\x7fELF-not-a-Mac-runtime"):Buffer.from([0xca,0xfe,0xba,0xbe,...Array(28).fill(0)])}:entry);
    if(kind==="non-executable")entries=entries.map(entry=>entry.name==="externals/node24/bin/node"?{...entry,mode:0o600}:entry);
    if(kind==="missing-node")entries=entries.filter(entry=>entry.name!=="externals/node24/bin/node");
    if(kind==="no-runtimes")entries=entries.filter(entry=>!entry.name.startsWith("externals/"));
    f.replaceArchive(entries);assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE",kind);
  }
});

test("archive layout rejects path aliases escapes special files and unsafe executable metadata",()=>{
  const additions=[
    {name:"bin/Runner.Listener",bytes:nativeBinary()},
    {name:"externals/node24/bin/../escape",bytes:nativeBinary()},
    {name:"externals/node24//bin/escape",bytes:nativeBinary()},
    {name:"externals/node24/./bin/escape",bytes:nativeBinary()},
    {name:"externals/node24/bin/newline\n",bytes:nativeBinary()},
    {name:"\ufeffexternals/node24/bin/hidden-bom",bytes:nativeBinary()},
    {name:"/foreign/bin/node",bytes:nativeBinary()},
    {name:"externals\\node24\\bin\\node",bytes:nativeBinary()},
    {name:".env",bytes:Buffer.from("PATH=/foreign/bin\n"),mode:0o600},
    {name:"_work/bin/node",bytes:nativeBinary()},
    {name:"foreign/bin/node",bytes:nativeBinary()},
    {name:"externals/node24/bin/linked",type:"2",link:"/foreign/bin/node"},
    {name:"externals/node24/bin/hardlinked",type:"1",link:"externals/node24/bin/node"},
    {name:"externals/node24/bin/device",type:"3"},
    {name:"externals/node24/bin/suid",bytes:nativeBinary(),mode:0o4700},
    {name:"externals/node24/bin/writable",bytes:nativeBinary(),mode:0o777},
    {name:"externals/node24/contents/",bytes:Buffer.from("not-directory-data"),type:"5"},
    {name:"externals/node24/bin/link-field",bytes:nativeBinary(),link:"/foreign/node"},
    {name:"externals/node24/bin/high-size",bytes:nativeBinary(),headerPatches:[[124,0xb0]]},
    {name:"externals/node24/bin/high-magic",bytes:nativeBinary(),headerPatches:[[257,0xf5]]},
    {name:"externals/node24/bin/checksum",bytes:nativeBinary(),corruptChecksum:true},
    {name:"bin/"+Array(32).fill("a").join("/"),bytes:nativeBinary()},
  ];
  for(const addition of additions) {
    const f=fixture();f.replaceArchive([...f.entries,addition]);assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE",addition.name);
  }
  for(const entries of [
    [{name:"externals/node24/alias",bytes:Buffer.alloc(0)},{name:"externals/node24/alias/node",bytes:nativeBinary()}],
    [{name:"externals/node24/alias/node",bytes:nativeBinary()},{name:"externals/node24/alias",bytes:Buffer.alloc(0)}],
  ]) { const f=fixture();f.replaceArchive([...f.entries,...entries]);assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE"); }
});

test("archive validates official directory entries end markers truncation checksums and inspection bounds",()=>{
  const valid=fixture(),directories=[{name:"./",type:"5"},{name:"./bin/",type:"5"},{name:"externals",type:"5"},{name:"externals/node20/empty/",type:"5"}];
  fs.mkdirSync(path.join(valid.runner,"externals/node20/empty"),{mode:0o700});valid.replaceArchive([...directories,...valid.entries]);assert.equal(inspectMacosRunnerBootstrap(valid.options).status,"PASS");
  for(const kind of ["missing-directory","end","trailing","truncated","bound","long-name"]) {
    const f=fixture();
    if(kind==="missing-directory")f.replaceArchive([{name:"externals/node20/empty/",type:"5"},...f.entries]);
    if(kind==="end")f.replaceArchive(f.entries,{endMarker:false});
    if(kind==="trailing")f.replaceArchive(f.entries,{trailing:Buffer.alloc(512,1)});
    if(kind==="truncated")f.replaceArchive([{name:"bin/Runner.Listener",bytes:Buffer.alloc(0),declaredSize:4096}]);
    if(kind==="bound")f.replaceArchive([{name:"bin/Runner.Listener",bytes:Buffer.alloc(0),declaredSize:256*1024*1024+1}]);
    if(kind==="long-name")f.replaceArchive([{name:"././@LongLink",type:"L",bytes:Buffer.alloc(4097,97)},...f.entries]);
    assert.notEqual(inspectMacosRunnerBootstrap(f.options).status,"PASS",kind);
  }
  const checksum=fixture(),damaged=syntheticArchive(checksum.entries);damaged[damaged.length-1]^=1;fs.writeFileSync(path.join(checksum.root,"runner-package.tar.gz"),damaged);checksum.approval.archive_sha256=hash(damaged);checksum.writeJson(checksum.receipt,checksum.approval);assert.equal(inspectMacosRunnerBootstrap(checksum.options).error_id,"MACOS-RUNNER-PACKAGE");
});

test("bounded nofollow package reads reject dependency swaps and same-byte identity replacement",()=>{
  for(const kind of ["symlink-on-open","replace-during-read"]) {
    const f=fixture(),file=path.join(f.runner,"externals/node24/bin/node"),backup=path.join(f.home,"original-node"),bytes=fs.readFileSync(file),fsImpl=Object.create(f.options.fsImpl);let tracked,changed=false;
    fsImpl.openSync=(target,flags,...rest)=>{
      if(target===file) {
        assert.ok(flags&fs.constants.O_NOFOLLOW);assert.ok(flags&fs.constants.O_NONBLOCK);
        if(kind==="symlink-on-open") { fs.renameSync(file,backup);fs.symlinkSync(backup,file);changed=true; }
        tracked=fs.openSync(target,flags,...rest);return tracked;
      }
      return fs.openSync(target,flags,...rest);
    };
    fsImpl.readSync=(fd,...args)=>{
      const count=fs.readSync(fd,...args);
      if(fd===tracked&&!changed&&kind==="replace-during-read") { fs.renameSync(file,backup);fs.writeFileSync(file,bytes,{mode:0o700});changed=true; }
      return count;
    };
    assert.notEqual(inspectMacosRunnerBootstrap({...f.options,fsImpl}).status,"PASS",kind);assert.equal(changed,true,kind);
  }
  const f=fixture(),archive=path.join(f.root,"runner-package.tar.gz"),fsImpl=Object.create(f.options.fsImpl);let archiveOpened=false;
  fsImpl.lstatSync=target=>{
    const st=f.options.fsImpl.lstatSync(target);return target===archive?Object.assign(Object.create(st),{size:256*1024*1024+1}):st;
  };
  fsImpl.openSync=(target,...args)=>{if(target===archive)archiveOpened=true;return fs.openSync(target,...args);};
  assert.equal(inspectMacosRunnerBootstrap({...f.options,fsImpl}).error_id,"MACOS-RUNNER-PACKAGE");assert.equal(archiveOpened,false);
});

test("retained archive and official release digest both remain authoritative for interpreter packages",()=>{
  const f=fixture(),file=path.join(f.root,"runner-package.tar.gz"),changed=Buffer.from(fs.readFileSync(file));changed[changed.length-1]^=1;fs.writeFileSync(file,changed);
  assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE");
  const second=fixture(),wrongDigest=(command,args)=>{
    const result=second.options.commandRunner(command,args);
    if(command==="gh"&&args.at(-1).startsWith("repos/actions/runner/releases/")) { const body=JSON.parse(result.output);body.assets[0].digest=`sha256:${"0".repeat(64)}`;return {ok:true,output:JSON.stringify(body)}; }
    return result;
  };
  assert.equal(inspectMacosRunnerBootstrap({...second.options,commandRunner:wrongDigest}).error_id,"MACOS-RUNNER-OFFICIAL-SOURCE");
});

test("archive extended path metadata preserves exact UTF-8 and decimal length bytes",()=>{
  const record=value=>{let length=Buffer.byteLength(value)+3;while(Buffer.byteLength(`${length} ${value}\n`)!==length)length=Buffer.byteLength(`${length} ${value}\n`);return Buffer.from(`${length} ${value}\n`);};
  for(const kind of ["high-digit","bom-path","link-override"]) {
    const f=fixture(),payload=record(kind==="bom-path"?"path=\ufeffexternals/node24/bin/hidden":kind==="link-override"?"linkpath=/foreign/node":"path=externals/node24/bin/hidden");
    if(kind==="high-digit")payload[0]|=0x80;
    f.replaceArchive([...f.entries,{name:"pax-header",type:"x",bytes:payload},{name:"externals/node24/bin/hidden",bytes:nativeBinary()}]);
    assert.equal(inspectMacosRunnerBootstrap(f.options).error_id,"MACOS-RUNNER-PACKAGE",kind);
  }
});

test("late identity callbacks cannot authorize changed bundled interpreters or retained archives",()=>{
  for(const kind of ["interpreter","dependency","extra","archive"]) {
    const f=fixture();let changed=false;
    const commandRunner=(command,args)=>{
      const result=f.options.commandRunner(command,args);
      if(command===f.codex&&!changed) {
        const file=kind==="archive"?path.join(f.root,"runner-package.tar.gz"):path.join(f.runner,kind==="interpreter"?"externals/node24/bin/node":kind==="dependency"?"externals/node20/lib/runtime.dat":"externals/node24/bin/extra");
        fs.writeFileSync(file,"late package tamper",{mode:0o700});changed=true;
      }
      return result;
    };
    assert.equal(inspectMacosRunnerBootstrap({...f.options,commandRunner}).error_id,"MACOS-RUNNER-PACKAGE",kind);assert.equal(changed,true,kind);
  }
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
