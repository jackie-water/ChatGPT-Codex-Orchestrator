import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { macosPrerequisites, parseNodeMajor, migrationInventory, migrationPreflight, renderLaunchAgent, macosRuntimeAction } from "../src/lib/macos-platform.mjs";
import { MACOS_RUNNER_RUNTIME_PATH } from "../src/lib/macos-runner-bootstrap.mjs";

function fixture() {
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"orch-macos-runtime-")),previousHome=process.env.HOME;
  process.env.HOME=home;
  const instance=path.join(home,".chatgpt-codex-orchestrator","instances","install1"),runner=path.join(instance,"runner"),executable=path.join(runner,"bin","Runner.Listener"),helper=path.join(instance,"runtime","native","macos","process-identity");
  for(const dir of [path.dirname(executable),path.dirname(helper)]) fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.writeFileSync(executable,"synthetic executable never run\n",{mode:0o700});fs.writeFileSync(helper,"synthetic helper never run\n",{mode:0o700});
  const state={sandbox_only:true,target_environment_ready:false,instance_id:"instance-1",installation_id:"install-1",runner_owner:"install-1",control_repository:"owner/control",runner_label:"runner-1",launch_agent_label:"com.chatgpt.codex.runner",runner_path:runner,instance_root:instance,macos_setup_approved:true,macos_action_approval:"install"};
  const capability={status:"PASS",installation_id:state.installation_id,instance_path:instance,helper_path:helper,receipt_path:path.join(instance,"macos-native-helper-capability.json")};
  const configFile=path.join(runner,".runner"),configBytes=Buffer.from(JSON.stringify({agentId:42,agentName:state.runner_label,gitHubUrl:`https://github.com/${state.control_repository}`,serverUrl:"https://pipelines.actions.githubusercontent.com/example",workFolder:"_work"}));
  fs.writeFileSync(configFile,configBytes,{mode:0o600});const configStat=fs.lstatSync(configFile);
  const configIdentity=Object.fromEntries(["dev","ino","uid","gid","mode","nlink","size","mtimeMs","ctimeMs"].map(key=>[key,configStat[key]]));
  const calls=[];let loaded=false,started=false;
  const runnerIdentity={status:"PASS",runner_executable:executable,program_arguments:["run"],runner_id:"42",config_sha256:crypto.createHash("sha256").update(configBytes).digest("hex"),config_identity:configIdentity,get local_listener_pid(){return started?123:null;}};
  const jobOutput=()=>`gui/${process.getuid?.()||0}/${state.launch_agent_label} = {
    path = ${path.join(home,"Library","LaunchAgents",`${state.launch_agent_label}.plist`)}
    type = LaunchAgent
    state = ${started?"running":"not running"}
    program = ${executable}
    arguments = {
      ${executable}
      run
    }
    working directory = ${runner}
    environment = {
      PATH => ${MACOS_RUNNER_RUNTIME_PATH}
      ORCHESTRATOR_MACOS_NATIVE_HELPER => ${helper}
      ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY => 1
      XPC_SERVICE_NAME => ${state.launch_agent_label}
    }
    domain = gui/${process.getuid?.()||0} [100003]
    ${started?"pid = 123":""}
    properties = inferred program
  }`;
  const commandRunner=(command,args)=>{calls.push({command,args});if(command!=="launchctl")throw new Error("No real command is permitted by this fixture");if(args[0]==="list")return {ok:true,output:loaded?`${started?123:"-"} 0 ${state.launch_agent_label}`:""};if(args[0]==="bootstrap"){loaded=true;return {ok:true,output:""};}if(args[0]==="kickstart"){started=true;return {ok:true,output:""};}if(args[0]==="print")return {ok:loaded,output:loaded?jobOutput():"not-loaded"};if(args[0]==="bootout"){loaded=false;started=false;return {ok:true,output:""};}return {ok:false,output:"unexpected"};};
  const options={state,home,platform:"darwin",arch:"arm64",commandRunner,runnerInspector:()=>runnerIdentity,capabilityVerifier:()=>capability};
  return {home,instance,runner,executable,helper,configFile,state,capability,runnerIdentity,jobOutput,setLoaded(value=true){loaded=value;},setStarted(value=true){loaded=value;started=value;},calls,options,cleanup(){if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;fs.rmSync(home,{recursive:true,force:true});}};
}

test("Node prerequisite parser accepts supported majors and rejects v21",()=>{assert.equal(parseNodeMajor("v21.9.0"),21);assert.equal(parseNodeMajor("v22.0.0"),22);assert.equal(typeof macosPrerequisites,"function");});

test("macOS migration inventory remains read only",()=>{
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"orch-macos-inventory-"));const before=fs.readdirSync(home);
  const result=migrationInventory({home,state:{browser_port:9333}});assert.equal(result.browser.port,9333);assert.deepEqual(fs.readdirSync(home),before);
  fs.rmSync(home,{recursive:true,force:true});
});

test("LaunchAgent requires a private actual executable and escapes argument text",()=>{
  const f=fixture();try{
    assert.throws(()=>renderLaunchAgent({label:"x",runnerPath:f.executable,instanceRoot:f.instance}),/reverse-DNS/);
    assert.throws(()=>renderLaunchAgent({label:f.state.launch_agent_label,runnerPath:f.runner,instanceRoot:f.instance}),/executable/);
    assert.throws(()=>renderLaunchAgent({label:f.state.launch_agent_label,runnerPath:"/tmp/runner",instanceRoot:f.instance}),/HOME-scoped/);
    const plist=renderLaunchAgent({label:f.state.launch_agent_label,runnerPath:f.executable,instanceRoot:f.instance,programArguments:["a&b<c>d\"e'e"]});
    assert.match(plist,/a&amp;b&lt;c&gt;d&quot;e&apos;e/);assert.ok(plist.includes(f.executable));assert.match(plist,/<key>RunAtLoad<\/key><false\/>/);
    fs.chmodSync(f.executable,0o600);assert.throws(()=>renderLaunchAgent({label:f.state.launch_agent_label,runnerPath:f.executable,instanceRoot:f.instance}),/executable/);
  }finally{f.cleanup();}
});

test("separate exact install and start approvals precede every launchctl mutation",()=>{
  const f=fixture();try{
    f.state.macos_action_approval="start";assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-ACTION-APPROVAL");
    assert.equal(fs.existsSync(path.join(f.home,"Library")),false);assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
    f.state.macos_action_approval="install";const installed=macosRuntimeAction("install",f.options);assert.equal(installed.status,"PASS");assert.equal(installed.plist_verified,true);
    assert.equal(f.calls.some(x=>x.args[0]==="bootstrap"),false);
    assert.equal(macosRuntimeAction("start",f.options).error_id,"MACOS-ACTION-APPROVAL");
    f.state.macos_action_approval="start";const blocked=macosRuntimeAction("start",f.options);assert.equal(blocked.error_id,"MACOS-LAUNCHCTL-IMMUTABLE-IMPORT-REQUIRED");assert.equal(blocked.mutations_performed,false);
    assert.deepEqual(f.calls.filter(x=>["bootstrap","kickstart"].includes(x.args[0])),[]);
    f.setStarted();const status=macosRuntimeAction("status",f.options);assert.equal(status.status,"PASS");assert.equal(status.launchctl_state,"loaded");assert.equal(status.plist_verified,true);assert.equal(status.preflight.inventory.runner.ownership,"OWN_VERIFIED_LABEL");
  }finally{f.cleanup();}
});

test("bogus native proof and changed plist cannot start a runner",()=>{
  const f=fixture();try{
    const forged=macosRuntimeAction("install",{...f.options,capabilityVerifier:()=>({...f.capability,receipt_path:path.join(f.home,"foreign.json")})});assert.equal(forged.error_id,"MACOS-NATIVE-CAPABILITY-INVALID");
    const installed=macosRuntimeAction("install",f.options);assert.equal(installed.status,"PASS");f.state.macos_action_approval="start";
    fs.writeFileSync(installed.plist,"<string>/foreign/executable</string>",{mode:0o600});
    assert.equal(macosRuntimeAction("start",f.options).error_id,"MACOS-PLIST-NATIVE-PATH-MISMATCH");assert.equal(f.calls.some(x=>x.args[0]==="bootstrap"),false);
  }finally{f.cleanup();}
});

test("unverified runner, extra service, and unknown launchctl status fail closed",()=>{
  const f=fixture();try{
    const untrusted=macosRuntimeAction("install",{...f.options,runnerInspector:()=>({status:"ERROR",error_id:"WRONG_RUNNER"})});assert.equal(untrusted.error_id,"WRONG_RUNNER");
    const extra=macosRuntimeAction("install",{...f.options,commandRunner:()=>({ok:true,output:"12 0 actions.runner.production"})});assert.equal(extra.error_id,"MACOS-RUNNER-OWNERSHIP");
    const unknown=migrationPreflight({state:f.state,home:f.home,commandRunner:()=>({ok:false,output:"denied"})});assert.equal(unknown.status,"CONFLICT");assert.equal(unknown.mutations_performed,false);
    assert.equal(fs.existsSync(path.join(f.home,"Library")),false);
  }finally{f.cleanup();}
});

test("start refuses mutable pathname import before bootstrap or kickstart",()=>{
  const f=fixture();try{
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
    const result=macosRuntimeAction("start",f.options);
    assert.equal(result.status,"ERROR");assert.equal(result.error_id,"MACOS-LAUNCHCTL-IMMUTABLE-IMPORT-REQUIRED");assert.equal(result.mutations_performed,false);assert.equal(result.launchctl_state,"unknown");
    assert.equal(f.calls.some(x=>["bootstrap","kickstart","bootout"].includes(x.args[0])),false);
  }finally{f.cleanup();}
});


test("runner environment approval is rechecked after native verification and before bootstrap",()=>{
  const f=fixture();try{
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
    let envDigest=null,inspections=0;
    const runnerInspector=()=>{inspections++;return {...f.runnerIdentity,env_sha256:envDigest};};
    const result=macosRuntimeAction("start",{...f.options,runnerInspector,capabilityVerifier:()=>{envDigest="a".repeat(64);return f.capability;}});
    assert.equal(result.error_id,"MACOS-RUNNER-APPROVAL-DRIFT");assert.equal(result.mutations_performed,false);assert.equal(inspections,2);
    assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
  }finally{f.cleanup();}
});

test("start cannot reach a pathname-consumer race after final independent inspections",()=>{
  const f=fixture();try{
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
    let inspections=0,consumed=false;
    const runnerInspector=()=>{inspections++;return f.runnerIdentity;};
    const commandRunner=(command,args)=>{
      if(args[0]==="bootstrap"){consumed=true;throw new Error("A mutable pathname import must be unreachable");}
      return f.options.commandRunner(command,args);
    };
    const result=macosRuntimeAction("start",{...f.options,runnerInspector,commandRunner});
    assert.equal(result.error_id,"MACOS-LAUNCHCTL-IMMUTABLE-IMPORT-REQUIRED");assert.equal(result.mutations_performed,false);assert.equal(inspections,2);assert.equal(consumed,false);
    assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
  }finally{f.cleanup();}
});


test("final bootstrap boundary rebinds exact plist bytes after the runner callback",()=>{
  for(const change of [
    text=>text.replace("<key>RunAtLoad</key><false/>","<key>RunAtLoad</key><true/>"),
    text=>text.replace("<string>run</string>","<string>run-foreign</string>"),
    text=>text.replace(`<string>${MACOS_RUNNER_RUNTIME_PATH}</string>`,"<string>/foreign/bin</string>")
  ]) {
    const f=fixture();try {
      const installed=macosRuntimeAction("install",f.options);assert.equal(installed.status,"PASS");f.state.macos_action_approval="start";
      let inspections=0;
      const runnerInspector=()=>{if(++inspections===2)fs.writeFileSync(installed.plist,change(fs.readFileSync(installed.plist,"utf8")));return f.runnerIdentity;};
      const result=macosRuntimeAction("start",{...f.options,runnerInspector});
      assert.equal(result.error_id,"MACOS-PLIST-DRIFT");assert.equal(result.mutations_performed,false);
      assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
    }finally{f.cleanup();}
  }
});

test("final bootstrap boundary rejects same-byte inode replacements, links and changed modes",()=>{
  for(const replacement of ["inode","symlink","hardlink","mode"]) {
    const f=fixture();try {
      const installed=macosRuntimeAction("install",f.options);assert.equal(installed.status,"PASS");f.state.macos_action_approval="start";
      let inspections=0;
      const runnerInspector=()=>{
        if(++inspections===2){
          const alternate=path.join(f.home,"saved.plist");fs.writeFileSync(alternate,fs.readFileSync(installed.plist),{mode:0o600});
          if(replacement==="mode")fs.chmodSync(installed.plist,0o644);
          else if(replacement==="inode")fs.renameSync(alternate,installed.plist);
          else {fs.unlinkSync(installed.plist);if(replacement==="symlink")fs.symlinkSync(alternate,installed.plist);else fs.linkSync(alternate,installed.plist);}
        }
        return f.runnerIdentity;
      };
      const result=macosRuntimeAction("start",{...f.options,runnerInspector});
      assert.equal(result.error_id,"MACOS-PLIST-DRIFT",replacement);assert.equal(result.mutations_performed,false);
      assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
    }finally{f.cleanup();}
  }
});

test("a loaded inert job is verified even without an observed listener PID",()=>{
  const f=fixture();try {
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.setLoaded();
    const result=macosRuntimeAction("status",f.options);
    assert.equal(result.status,"PASS");assert.equal(result.launchctl_state,"loaded");assert.equal(result.runner.local_listener_pid,null);
  }finally{f.cleanup();}
});

test("same-label loaded job requires exact owned executable arguments environment and PID proof",()=>{
  for(const change of [
    text=>text.replace("program = ","program = /foreign"),
    text=>text.replace("      run\n","      foreign\n"),
    text=>text.replace(`PATH => ${MACOS_RUNNER_RUNTIME_PATH}`,"PATH => /foreign/bin"),
    text=>text.replace("ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY => 1","ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY => 0"),
    text=>text.replace("working directory = ","working directory = /foreign"),
    text=>text.replace("path = ","path = /foreign"),
    text=>text.replace(/domain = gui\/\d+/,"domain = gui/999999"),
    text=>text.replace("properties = inferred program","properties = runatload | inferred program"),
    text=>text.replace("state = not running","state = running\n    pid = 123"),
    text=>text.replace("program = ","program = /foreign\n    program = ")
  ]) {
    const f=fixture();try {
      assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.setLoaded();
      const commandRunner=(command,args)=>{const result=f.options.commandRunner(command,args);return args[0]==="print"?{...result,output:change(result.output)}:result;};
      const result=macosRuntimeAction("status",{...f.options,commandRunner});
      assert.equal(result.error_id,"MACOS-LAUNCHCTL-IDENTITY");assert.equal(result.mutations_performed,false);
      assert.equal(f.calls.some(x=>["bootstrap","kickstart","bootout"].includes(x.args[0])),false);
    }finally{f.cleanup();}
  }
});

test("duplicate labels and print-only foreign jobs fail closed before bootstrap",()=>{
  for(const duplicate of [true,false]) {
    const f=fixture();try {
      assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
      const commandRunner=(command,args)=>{
        const result=f.options.commandRunner(command,args);
        if(args[0]==="list"&&duplicate)return {ok:true,output:`- 0 ${f.state.launch_agent_label}\n- 0 ${f.state.launch_agent_label}`};
        if(args[0]==="print")return {ok:true,output:f.jobOutput()};
        return result;
      };
      const result=macosRuntimeAction("start",{...f.options,commandRunner});
      assert.equal(result.status,"ERROR");assert.equal(result.launchctl_state,"unknown");assert.equal(result.mutations_performed,false);
      assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
    }finally{f.cleanup();}
  }
});

test("a foreign loaded job with RunAtLoad authority is refused before any start mutation",()=>{
  const f=fixture();try {
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";f.setLoaded();
    const commandRunner=(command,args)=>{const result=f.options.commandRunner(command,args);return args[0]==="print"?{...result,output:result.output.replace("properties = inferred program","properties = runatload | inferred program")}:result;};
    const result=macosRuntimeAction("start",{...f.options,commandRunner});
    assert.equal(result.error_id,"MACOS-LAUNCHCTL-IDENTITY");assert.equal(result.mutations_performed,false);
    assert.equal(f.calls.some(x=>["bootstrap","kickstart","bootout"].includes(x.args[0])),false);
  }finally{f.cleanup();}
});


test("a running loaded job requires an independently observed native listener matching its printed PID",()=>{
  for(const pid of [null,456,123]) {
    const f=fixture();try {
      assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.setStarted();
      const runnerInspector=()=>({...f.runnerIdentity,local_listener_pid:pid});
      const result=macosRuntimeAction("status",{...f.options,runnerInspector});
      assert.equal(result.status,pid===123?"PASS":"ERROR");if(pid!==123)assert.equal(result.error_id,"MACOS-LAUNCHCTL-IDENTITY");assert.equal(result.mutations_performed,false);
      assert.equal(f.calls.some(x=>["bootstrap","kickstart","bootout"].includes(x.args[0])),false);
    }finally{f.cleanup();}
  }
});


test("start authorization rejects an unchanged configuration digest on a new inode",()=>{
  const f=fixture();try {
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
    let inspections=0;
    const runnerInspector=()=>({...f.runnerIdentity,config_identity:{...f.runnerIdentity.config_identity,ino:f.runnerIdentity.config_identity.ino+(++inspections===1?0:1)}});
    const result=macosRuntimeAction("start",{...f.options,runnerInspector});
    assert.equal(result.error_id,"MACOS-RUNNER-APPROVAL-DRIFT");assert.equal(result.mutations_performed,false);
    assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
  }finally{f.cleanup();}
});


test("direct configuration binding rejects replacement inside the final launchctl observation callback",()=>{
  const f=fixture();try {
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
    let inspections=0,replaced=false;
    const runnerInspector=()=>{inspections++;return f.runnerIdentity;};
    const commandRunner=(command,args)=>{
      const result=f.options.commandRunner(command,args);
      if(args[0]==="print"&&inspections===2&&!replaced){const alternate=path.join(f.home,"replacement.runner");fs.writeFileSync(alternate,fs.readFileSync(f.configFile),{mode:0o600});fs.renameSync(alternate,f.configFile);replaced=true;}
      return result;
    };
    const result=macosRuntimeAction("start",{...f.options,runnerInspector,commandRunner});
    assert.equal(replaced,true);assert.equal(result.error_id,"MACOS-RUNNER-CONFIG");assert.equal(result.mutations_performed,false);
    assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
  }finally{f.cleanup();}
});


test("start preserves a verified nonauthority plist while immutable import is unavailable",()=>{
  const f=fixture();try {
    const installed=macosRuntimeAction("install",f.options);assert.equal(installed.status,"PASS");f.state.macos_action_approval="start";
    const before=fs.lstatSync(installed.plist),bytes=fs.readFileSync(installed.plist);
    const result=macosRuntimeAction("start",f.options),after=fs.lstatSync(installed.plist);
    assert.equal(result.error_id,"MACOS-LAUNCHCTL-IMMUTABLE-IMPORT-REQUIRED");assert.equal(result.mutations_performed,false);assert.equal(after.ino,before.ino);assert.equal(after.mode,before.mode);assert.deepEqual(fs.readFileSync(installed.plist),bytes);
    assert.equal(f.calls.some(x=>["bootstrap","kickstart","bootout"].includes(x.args[0])),false);
  }finally{f.cleanup();}
});
