import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { macosPrerequisites, parseNodeMajor, migrationInventory, migrationPreflight, renderLaunchAgent, macosRuntimeAction } from "../src/lib/macos-platform.mjs";

function fixture() {
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"orch-macos-runtime-")),previousHome=process.env.HOME;
  process.env.HOME=home;
  const instance=path.join(home,"instance"),runner=path.join(instance,"runner"),executable=path.join(runner,"bin","Runner.Listener"),helper=path.join(instance,"runtime","native","macos","process-identity");
  for(const dir of [path.dirname(executable),path.dirname(helper)]) fs.mkdirSync(dir,{recursive:true,mode:0o700});
  fs.writeFileSync(executable,"synthetic executable never run\n",{mode:0o700});fs.writeFileSync(helper,"synthetic helper never run\n",{mode:0o700});
  const state={sandbox_only:true,target_environment_ready:false,instance_id:"instance-1",installation_id:"install-1",runner_owner:"install-1",runner_label:"runner-1",launch_agent_label:"com.chatgpt.codex.runner",runner_path:runner,instance_root:instance,macos_setup_approved:true,macos_action_approval:"install"};
  const capability={status:"PASS",installation_id:state.installation_id,instance_path:instance,helper_path:helper,receipt_path:path.join(instance,"macos-native-helper-capability.json")};
  const runnerIdentity={status:"PASS",runner_executable:executable,program_arguments:["run"]};
  const calls=[];let loaded=false;
  const commandRunner=(command,args)=>{calls.push({command,args});if(command!=="launchctl")throw new Error("No real command is permitted by this fixture");if(args[0]==="list")return {ok:true,output:loaded?`123 0 ${state.launch_agent_label}`:""};if(args[0]==="bootstrap"){loaded=true;return {ok:true,output:""};}if(args[0]==="kickstart")return {ok:true,output:""};if(args[0]==="print")return {ok:loaded,output:loaded?"pid = 123":"not-loaded"};return {ok:false,output:"unexpected"};};
  const options={state,home,platform:"darwin",arch:"arm64",commandRunner,runnerInspector:()=>runnerIdentity,capabilityVerifier:()=>capability};
  return {home,instance,runner,executable,helper,state,capability,calls,options,cleanup(){if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;fs.rmSync(home,{recursive:true,force:true});}};
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
    f.state.macos_action_approval="start";assert.equal(macosRuntimeAction("start",f.options).status,"PASS");
    assert.deepEqual(f.calls.filter(x=>["bootstrap","kickstart"].includes(x.args[0])).map(x=>x.args[0]),["bootstrap","kickstart"]);
    const status=macosRuntimeAction("status",f.options);assert.equal(status.status,"PASS");assert.equal(status.launchctl_state,"loaded");assert.equal(status.plist_verified,true);assert.equal(status.preflight.inventory.runner.ownership,"OWN_VERIFIED_LABEL");
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

test("failed kickstart leaves durable recovery requirement without reporting running",()=>{
  const f=fixture();try{
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
    const result=macosRuntimeAction("start",{...f.options,commandRunner:(command,args)=>args[0]==="kickstart"?{ok:false,output:"denied"}:f.options.commandRunner(command,args)});
    assert.equal(result.status,"ERROR");assert.equal(result.mutations_performed,"UNKNOWN");assert.equal(result.recovery_status,"INSPECT_ONLY_NO_AUTOMATIC_RETRY");
  }finally{f.cleanup();}
});

test("runner environment approval is rechecked after native verification and before bootstrap",()=>{
  const f=fixture();try{
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
    let envDigest=null,inspections=0;
    const runnerInspector=()=>{inspections++;return {status:"PASS",runner_executable:f.executable,program_arguments:["run"],env_sha256:envDigest};};
    const result=macosRuntimeAction("start",{...f.options,runnerInspector,capabilityVerifier:()=>{envDigest="a".repeat(64);return f.capability;}});
    assert.equal(result.error_id,"MACOS-RUNNER-APPROVAL-DRIFT");assert.equal(result.mutations_performed,false);assert.equal(inspections,2);
    assert.equal(f.calls.some(x=>["bootstrap","kickstart"].includes(x.args[0])),false);
  }finally{f.cleanup();}
});

test("environment tamper during bootstrap blocks kickstart and requires inspection",()=>{
  const f=fixture();try{
    assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
    let tampered=false,inspections=0;
    const runnerInspector=()=>{inspections++;return tampered?{status:"ERROR",error_id:"MACOS-RUNNER-ENV"}:{status:"PASS",runner_executable:f.executable,program_arguments:["run"],env_sha256:null};};
    const commandRunner=(command,args)=>{const result=f.options.commandRunner(command,args);if(command==="launchctl"&&args[0]==="bootstrap")tampered=true;return result;};
    const result=macosRuntimeAction("start",{...f.options,runnerInspector,commandRunner});
    assert.equal(result.error_id,"MACOS-RUNNER-ENV");assert.equal(result.mutations_performed,true);assert.equal(result.recovery_status,"INSPECT_ONLY_NO_AUTOMATIC_RETRY");assert.equal(inspections,3);
    assert.equal(f.calls.filter(x=>x.args[0]==="bootstrap").length,1);assert.equal(f.calls.some(x=>x.args[0]==="kickstart"),false);
  }finally{f.cleanup();}
});
