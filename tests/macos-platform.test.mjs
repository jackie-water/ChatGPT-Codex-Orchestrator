import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { macosPrerequisites, parseNodeMajor, migrationInventory, migrationPreflight, renderLaunchAgent, macosRuntimeAction, trustedClaimRead } from "../src/lib/macos-platform.mjs";
import { MACOS_RUNNER_RUNTIME_PATH } from "../src/lib/macos-runner-bootstrap.mjs";
import { MACOS_PERSONAL_USE_POLICY, TRUSTED_SINGLE_USER_READINESS_PROFILE, macosPersonalUsePolicyChallenge, trustedSingleUserReadinessProfileChallenge } from "../src/lib/macos-personal-use-service.mjs";

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

test("synthetic prerequisite preflight defers legacy helper until profile selection and blocks Runner after selection",()=>{
  const commands=[];
  const commandRunner=(name,args)=>{commands.push([name,...args]);return {ok:true,output:name==="node"?"v22.0.0":"synthetic"};};
  const missing=()=>({status:"MISSING"}),initial=macosPrerequisites({state:{macos_setup_approved:true},commandRunner,nativeHelperPreflight:missing});
  assert.equal(initial.legacy_native_helper_gate,"DEFERRED_PENDING_PROFILE_SELECTION");assert.equal(initial.runner_lineage,null);assert.equal(commands.length,6);
  const state={macos_setup_approved:true,installation_id:"install",github_login:"owner",control_repository:"owner/control",control_repository_id:"101"};
  state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,readiness_profile:TRUSTED_SINGLE_USER_READINESS_PROFILE,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:state.control_repository_id,approval:trustedSingleUserReadinessProfileChallenge(state),approved_at:"2026-10-22T00:00:00Z"};
  const selected=macosPrerequisites({state,commandRunner,nativeHelperPreflight:missing});
  assert.equal(selected.legacy_native_helper_gate,"NOT_APPLICABLE_SUPERSEDED");assert.equal(selected.runner_lineage.status,"ACTION_APPROVAL_REQUIRED");
});

test("no-marker legacy policy still requires native helper",()=>{
  const calls=[];
  const commandRunner=name=>{calls.push(name);return {ok:true,output:name==="node"?"v22.0.0":"synthetic"};};
  const state={macos_setup_approved:true,installation_id:"install",github_login:"owner",control_repository:"owner/control",control_repository_id:"101"};
  state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:state.control_repository_id,approval:macosPersonalUsePolicyChallenge(state),approved_at:"2026-10-22T00:00:00Z"};
  const missing=macosPrerequisites({state,commandRunner,nativeHelperPreflight:()=>({status:"MISSING"})});
  assert.equal(missing.legacy_native_helper_gate,"MISSING");assert.equal(missing.readiness_profile,null);
  const passing=macosPrerequisites({state,commandRunner,nativeHelperPreflight:()=>({status:"PASS"})});
  assert.equal(passing.legacy_native_helper_gate,"PASS");assert.equal(passing.readiness_profile,null);
  assert.equal(Object.hasOwn(state.macos_service_policy,"readiness_profile"),false);assert.equal(calls.length,12);
});

test("trusted invalid profile and foreign Control fail closed",()=>{
  const state={macos_setup_approved:true,installation_id:"install",github_login:"owner",control_repository:"owner/control",control_repository_id:"101"};
  state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,readiness_profile:TRUSTED_SINGLE_USER_READINESS_PROFILE,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:state.control_repository_id,approval:trustedSingleUserReadinessProfileChallenge(state),approved_at:"2026-10-22T00:00:00Z"};
  for(const valid of [true,false]) for(const action of ["install","start","stop","repair"]){
    let reached=false;const options={state:valid?state:{...state,macos_service_policy:{...state.macos_service_policy,approval:"stale"}},commandRunner:()=>{reached=true;throw Error("must not launchctl");},runnerInspector:()=>{reached=true;throw Error("must not inspect");},capabilityVerifier:()=>{reached=true;throw Error("must not verify");}};
    assert.equal(macosRuntimeAction(action,options).error_id,valid?(["stop","repair"].includes(action)?"MACOS-RUNNER-TRUSTED-ACTION-UNSUPPORTED":"MACOS-ACTION-APPROVAL"):"MACOS-READINESS-PROFILE-INVALID");assert.equal(reached,false);
  }
  const foreign={...state,control_repository_id:"999"};foreign.macos_service_policy={...state.macos_service_policy};assert.equal(macosRuntimeAction("install",{state:foreign}).error_id,"MACOS-READINESS-PROFILE-INVALID");
  const readonly={state,commandRunner:()=>({ok:true,output:""}),runnerInspector:()=>({status:"ERROR",error_id:"SYNTHETIC_READ_ONLY"})};
  assert.notEqual(macosRuntimeAction("status",readonly).error_id,"MACOS-RUNNER-TRUSTED-ACTION-UNSUPPORTED");
  for(const action of ["status","doctor"]){let reached=false;assert.equal(macosRuntimeAction(action,{state:{...state,macos_service_policy:{...state.macos_service_policy,approval:"stale"}},commandRunner:()=>{reached=true;throw Error("must not inspect");},runnerInspector:()=>{reached=true;throw Error("must not inspect");}}).error_id,"MACOS-READINESS-PROFILE-INVALID");assert.equal(reached,false);}
});

test("trusted single-user profiles block every mutation before service inspection and reject invalid receipts",()=>{
  const state={macos_setup_approved:true,installation_id:"install",github_login:"owner",control_repository:"owner/control",control_repository_id:"101",macos_service_policy:{readiness_profile:TRUSTED_SINGLE_USER_READINESS_PROFILE,approval:"forged"}};
  let reached=false;const result=macosRuntimeAction("install",{state,commandRunner:()=>{reached=true;return {ok:true,output:""};},runnerInspector:()=>{reached=true;return {status:"PASS"};}});
  assert.equal(result.error_id,"MACOS-READINESS-PROFILE-INVALID");assert.equal(reached,false);
});

function trustedFixture({active=false}={}) {
  const f=fixture(),service=path.join(f.runner,"bin","runsvc.sh"),node=path.join(f.runner,"externals","node20","bin","node"),script=path.join(f.runner,"bin","RunnerService.js");
  for(const dir of [path.dirname(node)])fs.mkdirSync(dir,{recursive:true,mode:0o700});for(const file of [service,node,script])fs.writeFileSync(file,"synthetic\n",{mode:0o700});
  Object.assign(f.state,{github_login:"owner",control_repository_id:"101",sandbox_repository_id:"102"});
  f.state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,readiness_profile:TRUSTED_SINGLE_USER_READINESS_PROFILE,selected_through:"official-installer",installation_id:f.state.installation_id,github_login:f.state.github_login,control_repository:f.state.control_repository,control_repository_id:f.state.control_repository_id,approval:trustedSingleUserReadinessProfileChallenge(f.state),approved_at:"2026-10-22T00:00:00Z"};
  const start="Mon Jan  1 00:00:00 2024",identity={pid:125,observed_start:start};
  const runner={...f.runnerIdentity,service_executable:service,service_arguments:[],service_node:node,service_node_version:"node20",service_script:script,local_process_observation:"trusted-single-user-ps-v1",local_listener_pid:active?125:null,local_listener_identity:active?identity:null,local_service_pids:active?[123,124]:[]};
  const plist=path.join(f.home,"Library","LaunchAgents",`${f.state.launch_agent_label}.plist`),rendered=renderLaunchAgent({label:f.state.launch_agent_label,runnerPath:service,programArguments:[],instanceRoot:f.instance,workingDirectory:f.runner,activated:false,officialService:true});
  if(active){fs.mkdirSync(path.dirname(plist),{recursive:true,mode:0o700});fs.writeFileSync(plist,rendered,{mode:0o600});f.setStarted();}
  const print=()=>`gui/${process.getuid?.()||0}/${f.state.launch_agent_label} = {
    path = ${plist}
    type = LaunchAgent
    state = ${active?"running":"not running"}
    program = ${service}
    arguments = {
      ${service}
    }
    working directory = ${f.runner}
    environment = {
      PATH => ${MACOS_RUNNER_RUNTIME_PATH}
      ACTIONS_RUNNER_SVC => 1
      XPC_SERVICE_NAME => ${f.state.launch_agent_label}
    }
    domain = gui/${process.getuid?.()||0} [100003]
    ${active?"pid = 123":""}
    properties = inferred program${f.state.macos_runner_bootstrap?.phase==="STARTED"?" | runatload":""}
  }`;
  const table=`${process.getuid?.()||0} 123 1 /bin/bash ${service}\n${process.getuid?.()||0} 124 123 ${node} ${script}\n${process.getuid?.()||0} 125 124 ${f.executable} run --startuptype service`;
  const commandRunner=(command,args)=>{if(command==="/bin/ps")return args.includes("lstart=")?{ok:true,output:start}:{ok:true,output:table};if(command==="launchctl"&&args[0]==="print")return {ok:active,output:active?print():`Could not find service "${f.state.launch_agent_label}" in domain for user gui:${process.getuid?.()||0}`};return f.options.commandRunner(command,args);};
  return {...f,runner,plist,rendered,options:{...f.options,commandRunner,runnerInspector:()=>runner,capabilityVerifier:()=>{throw Error("native helper must not run");}}};
}

test("trusted status and doctor inspect inactive service without native helper",()=>{
  const f=trustedFixture();try{for(const action of ["status","doctor"]){const before=fs.readdirSync(f.home),result=macosRuntimeAction(action,f.options);assert.equal(result.status,"PASS");assert.equal(result.readiness_profile,TRUSTED_SINGLE_USER_READINESS_PROFILE);assert.equal(result.runner_action_state,"ACTION_APPROVAL_REQUIRED");assert.equal(result.mutations_performed,false);assert.equal(result.launchctl_state,"not-loaded");assert.deepEqual(fs.readdirSync(f.home),before);}assert.equal(f.calls.some(x=>["bootstrap","bootout"].includes(x.args[0])),false);}finally{f.cleanup();}
});

test("trusted active launchd verifies pinned process chain without native helper",()=>{
  const f=trustedFixture({active:true});try{const result=macosRuntimeAction("status",f.options);assert.equal(result.status,"PASS");assert.deepEqual(result.job_identity,{pid:123,observed_start:"Mon Jan  1 00:00:00 2024"});assert.deepEqual(result.listener_identity,{pid:125,observed_start:"Mon Jan  1 00:00:00 2024"});assert.equal(f.calls.some(x=>x.command==="launchctl"&&["bootstrap","bootout"].includes(x.args[0])),false);
    assert.equal(macosRuntimeAction("status",{...f.options,runnerInspector:()=>({...f.runner,local_listener_pid:126})}).error_id,"MACOS-LAUNCHCTL-IDENTITY");
  }finally{f.cleanup();}
});

test("trusted status rejects forged runner observation and plist drift",()=>{
  const f=trustedFixture({active:true});try{assert.equal(macosRuntimeAction("status",{...f.options,runnerInspector:()=>({...f.runner,local_process_observation:"forged"})}).error_id,"MACOS-RUNNER-LINEAGE-INVALID");fs.writeFileSync(f.plist,f.rendered.replace("ACTIONS_RUNNER_SVC","FOREIGN"),{mode:0o600});assert.equal(macosRuntimeAction("doctor",f.options).error_id,"MACOS-PLIST-NATIVE-PATH-MISMATCH");assert.equal(f.calls.some(x=>x.command==="launchctl"&&["bootstrap","bootout"].includes(x.args[0])),false);}finally{f.cleanup();}
});

test("trusted read-only status rejects contradictory journals without mutation",()=>{
  const f=trustedFixture();try{f.state.macos_runner_bootstrap={phase:"INSTALL_INTENT",operation:"foreign",runner_id:f.runner.runner_id,install_challenge:"install:"+"a".repeat(64),start_challenge:"start:"+"b".repeat(64)};assert.equal(macosRuntimeAction("status",f.options).error_id,"MACOS-FIRST-BOOT-JOURNAL");f.state.macos_runner_bootstrap={phase:"INSTALL_INTENT",operation:"install",runner_id:"foreign",install_challenge:"install:"+"a".repeat(64),start_challenge:"start:"+"b".repeat(64)};assert.equal(macosRuntimeAction("doctor",f.options).error_id,"MACOS-RUNNER-APPROVAL-DRIFT");assert.equal(f.calls.some(x=>["bootstrap","kickstart","bootout"].includes(x.args[0])),false);}finally{f.cleanup();}
});

test("trusted stop and repair stay blocked without mutation",()=>{
  const f=fixture();try{assert.equal(macosRuntimeAction("status",{...f.options,capabilityVerifier:()=>({status:"MISSING"})}).error_id,"MACOS-NATIVE-CAPABILITY-INVALID");const trusted=trustedFixture();try{for(const action of ["stop","repair"])assert.equal(macosRuntimeAction(action,trusted.options).error_id,"MACOS-RUNNER-TRUSTED-ACTION-UNSUPPORTED");assert.equal(trusted.calls.some(x=>["bootstrap","bootout"].includes(x.args[0])),false);}finally{trusted.cleanup();}}finally{f.cleanup();}
});

function approveTrustedAction(f,action,phase=action==="install"?"INSTALL_INTENT":"START_INTENT",attempt=1){
  const challengeFor=operation=>operation+":"+crypto.createHash("sha256").update(JSON.stringify([f.state.installation_id,f.state.instance_id,f.state.instance_root,f.state.control_repository,f.state.control_repository_id,f.state.sandbox_repository,f.state.sandbox_repository_id,f.state.sandbox_project_key,f.state.runner_label,f.runner.runner_id,f.runner.runner_executable,f.runner.approval_sha256,f.state.browser_profile,f.state.browser_port,f.state.pending_wake_outbox,...(attempt===1?[]:[{proven_rejection_attempt:attempt}])])).digest("hex");
  const challenge=challengeFor(action);
  const baselineFor=operation=>operation+":"+crypto.createHash("sha256").update(JSON.stringify([f.state.installation_id,f.state.instance_id,f.state.instance_root,f.state.control_repository,f.state.control_repository_id,f.state.sandbox_repository,f.state.sandbox_repository_id,f.state.sandbox_project_key,f.state.runner_label,f.runner.runner_id,f.runner.runner_executable,f.runner.approval_sha256,f.state.browser_profile,f.state.browser_port,f.state.pending_wake_outbox])).digest("hex");
  f.state.macos_runner_bootstrap={phase,operation:action,attempt,action_challenge:challenge,runner_id:f.runner.runner_id,install_challenge:baselineFor("install"),start_challenge:baselineFor("start")};
  f.state.macos_action_approval=action;f.state.macos_runner_action_approval=challenge;
  const claim=path.join(f.state.instance_root,`macos-runner-${action}${attempt===1?"":`-attempt-${attempt}`}-claim.json`);
  fs.writeFileSync(claim,JSON.stringify({schema_version:1,installation_id:f.state.installation_id,instance_id:f.state.instance_id,action,attempt,challenge,pid:process.pid,claimed_at:"2026-10-22T00:00:00Z"})+"\n",{mode:0o600});
  f.state.macos_runner_bootstrap.claim_path=claim;
  if(action==="start"){f.state.macos_activation_challenge=challenge;f.state.macos_runner_activation={installation_id:f.state.installation_id,runner_id:f.runner.runner_id,approval_sha256:f.runner.approval_sha256,challenge,login_restart_approved:true,approved_at:"2026-10-22T00:00:00Z"};}
  return challenge;
}
function retainedRejection(f,operation,attempt=1){
  const action_challenge=approveTrustedAction(f,operation,"REJECTED",attempt),claim_path=f.state.macos_runner_bootstrap.claim_path;
  return {installation_id:f.state.installation_id,operation,attempt,claim_path,action_challenge,result:{status:"ERROR",action:operation,pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false}};
}

test("trusted install preflight binds official service without native helper",()=>{
  const f=trustedFixture();try{approveTrustedAction(f,"install");assert.equal(macosRuntimeAction("install",{...f.options,preflightOnly:true}).status,"PASS");const installed=macosRuntimeAction("install",f.options);assert.equal(installed.status,"PASS");assert.match(fs.readFileSync(installed.plist,"utf8"),/ACTIONS_RUNNER_SVC/);assert.doesNotMatch(fs.readFileSync(installed.plist,"utf8"),/NATIVE_HELPER/);}finally{f.cleanup();}
});

test("trusted start preclaim and postclaim require exact persisted intent",()=>{
  const f=trustedFixture();try{
    approveTrustedAction(f,"install");delete f.state.macos_runner_bootstrap;
    const before=f.calls.length;
    assert.equal(macosRuntimeAction("install",{...f.options,preflightOnly:true}).status,"PASS");assert.equal(f.calls.slice(before).some(call=>["bootstrap","kickstart","bootout"].includes(call.args?.[0])),false);
    approveTrustedAction(f,"install");assert.equal(macosRuntimeAction("install",f.options).status,"PASS");
    const start=approveTrustedAction(f,"start","START_INTENT");
    f.state.macos_runner_bootstrap.phase="PLIST_INSTALLED";f.state.macos_runner_bootstrap.operation="install";delete f.state.macos_runner_bootstrap.action_challenge;
    const startPreflight=macosRuntimeAction("start",{...f.options,preflightOnly:true});assert.equal(startPreflight.status,"PASS",JSON.stringify(startPreflight));assert.equal(f.calls.some(call=>call.args?.[0]==="bootstrap"),false);
    f.state.macos_runner_bootstrap={...f.state.macos_runner_bootstrap,phase:"START_INTENT",operation:"start",attempt:1,action_challenge:start};
    const postclaim=macosRuntimeAction("start",f.options);assert.notEqual(postclaim.error_id,"MACOS-ACTION-APPROVAL");assert.equal(f.calls.some(call=>call.args?.[0]==="bootstrap"),true);
  }finally{f.cleanup();}
});

test("trusted proven rejection retry binds attempt two and rejects uncertain replay",()=>{
  const f=trustedFixture();try{
    const retry=approveTrustedAction(f,"install","INSTALL_INTENT",2);
    f.state.macos_runner_bootstrap.rejections=[{operation:"install",attempt:1,claim_path:"/private/claim-1",result:{pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false}}];
    assert.equal(macosRuntimeAction("install",{...f.options,preflightOnly:true}).status,"PASS");
    f.state.macos_runner_bootstrap.action_challenge=retry.replace(/.$/,value=>value==="0"?"1":"0");assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-ACTION-APPROVAL");
    f.state.macos_runner_bootstrap={...f.state.macos_runner_bootstrap,phase:"ERROR",result:{mutations_performed:"UNKNOWN"}};assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-ACTION-APPROVAL");
  }finally{f.cleanup();}
});

test("trusted rejected install attempt two needs fresh preclaim approval",()=>{
  const f=trustedFixture();try{const first=retainedRejection(f,"install");f.state.macos_runner_bootstrap={...f.state.macos_runner_bootstrap,phase:"REJECTED",rejected_operation:"install",rejections:[first]};assert.equal(macosRuntimeAction("install",{...f.options,preflightOnly:true}).error_id,"MACOS-ACTION-APPROVAL");approveTrustedAction(f,"install","REJECTED",2);f.state.macos_runner_bootstrap.rejected_operation="install";f.state.macos_runner_bootstrap.rejections=[first];assert.equal(macosRuntimeAction("install",{...f.options,preflightOnly:true}).status,"PASS");assert.notEqual(first.action_challenge,f.state.macos_runner_action_approval);}finally{f.cleanup();}
});

test("trusted rejected start attempt two needs fresh preclaim approval",()=>{
  const f=trustedFixture();try{const first=retainedRejection(f,"start");approveTrustedAction(f,"start","REJECTED",2);f.state.macos_runner_bootstrap.rejected_operation="start";f.state.macos_runner_bootstrap.rejections=[first];assert.equal(macosRuntimeAction("start",{...f.options,preflightOnly:true}).error_id,"MACOS-PLIST-MISSING");assert.equal(f.calls.some(call=>["bootstrap","kickstart","bootout"].includes(call.args?.[0])),false);f.state.macos_runner_action_approval=f.state.macos_runner_action_approval.replace(/.$/,value=>value==="0"?"1":"0");assert.equal(macosRuntimeAction("start",{...f.options,preflightOnly:true}).error_id,"MACOS-ACTION-APPROVAL");assert.equal(f.calls.some(call=>["bootstrap","kickstart","bootout"].includes(call.args?.[0])),false);}finally{f.cleanup();}
});

test("trusted attempt two STARTED status binds activated plist after approval consumed",()=>{
  const f=trustedFixture({active:true});try{const challenge=approveTrustedAction(f,"start","STARTED",2),base=operation=>operation+":"+crypto.createHash("sha256").update(JSON.stringify([f.state.installation_id,f.state.instance_id,f.state.instance_root,f.state.control_repository,f.state.control_repository_id,f.state.sandbox_repository,f.state.sandbox_repository_id,f.state.sandbox_project_key,f.state.runner_label,f.runner.runner_id,f.runner.runner_executable,f.runner.approval_sha256,f.state.browser_profile,f.state.browser_port,f.state.pending_wake_outbox])).digest("hex");f.state.macos_runner_bootstrap.install_challenge=base("install");f.state.macos_runner_bootstrap.start_challenge=base("start");f.state.macos_runner_bootstrap.rejections=[{operation:"start",attempt:1,claim_path:path.join(f.state.instance_root,"macos-runner-start-claim.json"),result:{pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false}}];fs.writeFileSync(f.plist,renderLaunchAgent({label:f.state.launch_agent_label,runnerPath:f.runner.service_executable,programArguments:[],instanceRoot:f.state.instance_root,workingDirectory:f.state.runner_path,activated:true,officialService:true}),{mode:0o600});delete f.state.macos_runner_action_approval;delete f.state.macos_action_approval;f.state.macos_runner_activation.challenge=challenge;const status=macosRuntimeAction("status",f.options);assert.equal(status.status,"PASS",JSON.stringify(status));f.state.macos_runner_activation.challenge="start:"+"0".repeat(64);assert.equal(macosRuntimeAction("status",f.options).error_id,"MACOS-PLIST-NATIVE-PATH-MISMATCH");}finally{f.cleanup();}
});

test("trusted postclaim requires exact durable single-use claim before mutation",()=>{
  const f=trustedFixture();try{approveTrustedAction(f,"install");fs.unlinkSync(f.state.macos_runner_bootstrap.claim_path);assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");assert.equal(f.calls.some(x=>x.args?.[0]==="bootstrap"),false);const challenge=approveTrustedAction(f,"install");fs.writeFileSync(f.state.macos_runner_bootstrap.claim_path,JSON.stringify({schema_version:1,installation_id:f.state.installation_id,instance_id:f.state.instance_id,action:"install",attempt:1,challenge:"install:"+"0".repeat(64),pid:process.pid,claimed_at:"2026-10-22T00:00:00Z"}),{mode:0o600});assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");assert.match(challenge,/^install:/);}finally{f.cleanup();}
});

test("mixed rejected history preserves install while authorizing only start attempt two",()=>{
  const f=trustedFixture();try{const install=retainedRejection(f,"install"),startFirst=retainedRejection(f,"start"),start=approveTrustedAction(f,"start","REJECTED",2),base=operation=>operation+":"+crypto.createHash("sha256").update(JSON.stringify([f.state.installation_id,f.state.instance_id,f.state.instance_root,f.state.control_repository,f.state.control_repository_id,f.state.sandbox_repository,f.state.sandbox_repository_id,f.state.sandbox_project_key,f.state.runner_label,f.runner.runner_id,f.runner.runner_executable,f.runner.approval_sha256,f.state.browser_profile,f.state.browser_port,f.state.pending_wake_outbox])).digest("hex");fs.mkdirSync(path.dirname(f.plist),{recursive:true,mode:0o700});fs.writeFileSync(f.plist,f.rendered,{mode:0o600});f.state.macos_runner_bootstrap.install_challenge=base("install");f.state.macos_runner_bootstrap.start_challenge=base("start");f.state.macos_runner_bootstrap.rejected_operation="start";f.state.macos_runner_bootstrap.rejections=[install,startFirst];assert.equal(macosRuntimeAction("start",{...f.options,preflightOnly:true}).status,"PASS");assert.match(start,/^start:/);}finally{f.cleanup();}
});

test("trusted history rejects impossible mixed ordering and contradictory result identities",()=>{
  const f=trustedFixture();try{const start=retainedRejection(f,"start"),install=retainedRejection(f,"install");approveTrustedAction(f,"install","REJECTED",2);f.state.macos_runner_bootstrap.rejected_operation="install";f.state.macos_runner_bootstrap.rejections=[start,install];assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-ACTION-APPROVAL");f.state.macos_runner_bootstrap.rejections=[{...install,result:{...install.result,action:"start"}}];assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-ACTION-APPROVAL");}finally{f.cleanup();}
});

test("trusted claim read rejects mid-inspection metadata and content drift",()=>{
  const f=trustedFixture();try{approveTrustedAction(f,"install");const claim=f.state.macos_runner_bootstrap.claim_path,read=fs.readSync;let changed=false;fs.readSync=(...args)=>{const value=read(...args);if(!changed){changed=true;fs.writeFileSync(claim,fs.readFileSync(claim,"utf8").replace("install","install"));}return value;};assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");fs.readSync=read;}finally{f.cleanup();}
});

test("trusted attempt nine and malformed claim history fail before service mutation",()=>{
  const f=trustedFixture();try{approveTrustedAction(f,"install","REJECTED",8);f.state.macos_runner_bootstrap.rejected_operation="install";f.state.macos_runner_bootstrap.rejections=[{...retainedRejection(f,"install",1),attempt:9}];assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-ACTION-APPROVAL");assert.equal(f.calls.some(call=>["bootstrap","kickstart"].includes(call.args?.[0])),false);}finally{f.cleanup();}
});

test("contradictory rejected history cannot reach a service mutation",()=>{
  const f=trustedFixture();try{approveTrustedAction(f,"install","REJECTED",2);f.state.macos_runner_bootstrap.rejected_operation="install";f.state.macos_runner_bootstrap.rejections=[{operation:"install",attempt:2,claim_path:path.join(f.state.instance_root,"macos-runner-install-attempt-2-claim.json"),result:{status:"ERROR",pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false}}];assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-ACTION-APPROVAL");assert.equal(f.calls.some(call=>["bootstrap","kickstart"].includes(call.args?.[0])),false);}finally{f.cleanup();}
});

test("claim inspection rejects mode link and symlink swaps before service mutation",()=>{
  const f=trustedFixture();try{approveTrustedAction(f,"install");const claim=f.state.macos_runner_bootstrap.claim_path;fs.chmodSync(claim,0o644);assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");fs.chmodSync(claim,0o600);const alias=path.join(f.state.instance_root,"claim-link");fs.linkSync(claim,alias);assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");fs.unlinkSync(alias);fs.unlinkSync(claim);fs.symlinkSync("/dev/null",claim);assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");assert.equal(f.calls.some(call=>["bootstrap","kickstart"].includes(call.args?.[0])),false);}finally{f.cleanup();}
});

test("claim inspection rejects conflicting JSON keys before service mutation",()=>{
  const f=trustedFixture();try{const challenge=approveTrustedAction(f,"install"),claim=f.state.macos_runner_bootstrap.claim_path;fs.writeFileSync(claim,`{"schema_version":1,"schema_version":1,"installation_id":"${f.state.installation_id}","instance_id":"${f.state.instance_id}","action":"install","attempt":1,"challenge":"${challenge}","pid":${process.pid},"claimed_at":"2026-10-22T00:00:00Z"}\n`,{mode:0o600});assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");assert.equal(f.calls.some(call=>["bootstrap","kickstart"].includes(call.args?.[0])),false);}finally{f.cleanup();}
});

test("trusted claim rejects unicode escaped duplicate JSON field",()=>{
  const f=trustedFixture();try{const challenge=approveTrustedAction(f,"install"),claim=f.state.macos_runner_bootstrap.claim_path;fs.writeFileSync(claim,`{"schema_version":1,"installation_id":"${f.state.installation_id}","instance_id":"${f.state.instance_id}","action":"install","\\u0061ction":"install","attempt":1,"challenge":"${challenge}","pid":${process.pid},"claimed_at":"2026-10-22T00:00:00Z"}\n`,{mode:0o600});assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");assert.equal(f.calls.some(call=>["bootstrap","kickstart","bootout"].includes(call.args?.[0])),false);}finally{f.cleanup();}
});

test("trusted claim rejects noncanonical raw UTF8 bytes despite identical decoded text",()=>{
  const f=trustedFixture();try{
    f.state.instance_id="instance-\ufffd";
    const challenge=approveTrustedAction(f,"install"),claim=f.state.macos_runner_bootstrap.claim_path;
    assert.equal(trustedClaimRead({state:f.state,home:f.home,action:"install",attempt:1,challenge,claim_path:claim}),true);
    const canonical=fs.readFileSync(claim),replacement=Buffer.from("\ufffd","utf8"),offset=canonical.indexOf(replacement);assert.ok(offset>=0);
    const invalid=Buffer.concat([canonical.subarray(0,offset),Buffer.from([0xff]),canonical.subarray(offset+replacement.length)]);
    fs.writeFileSync(claim,invalid,{mode:0o600});
    assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");assert.equal(f.calls.some(call=>["bootstrap","kickstart","bootout"].includes(call.args?.[0])),false);
    fs.writeFileSync(claim,`{"schema_version":1,"installation_id":"${f.state.installation_id}","instance_id":"${f.state.instance_id}","action":"install","\\u0061ction":"install","attempt":1,"challenge":"${challenge}","pid":${process.pid},"claimed_at":"2026-10-22T00:00:00Z"}\n`,{mode:0o600});
    assert.equal(macosRuntimeAction("install",f.options).error_id,"MACOS-FIRST-BOOT-CLAIM");assert.equal(f.calls.some(call=>["bootstrap","kickstart","bootout"].includes(call.args?.[0])),false);
  }finally{f.cleanup();}
});

test("trusted install cannot authorize startup or login restart",()=>{
  const f=trustedFixture();try{const challenge=approveTrustedAction(f,"install");assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_runner_bootstrap={...f.state.macos_runner_bootstrap,phase:"PLIST_INSTALLED",operation:"start",start_challenge:"start:"+"d".repeat(64)};f.state.macos_action_approval="start";f.state.macos_runner_action_approval=challenge;assert.equal(macosRuntimeAction("start",f.options).error_id,"MACOS-ACTION-APPROVAL");}finally{f.cleanup();}
});

test("trusted start requires installed plist and distinct approval",()=>{
  const f=trustedFixture();try{approveTrustedAction(f,"start");assert.equal(macosRuntimeAction("start",f.options).error_id,"MACOS-PLIST-MISSING");f.state.macos_runner_action_approval="install:"+"a".repeat(64);assert.equal(macosRuntimeAction("start",f.options).error_id,"MACOS-ACTION-APPROVAL");}finally{f.cleanup();}
});

test("trusted start rejects changed runner or launchd identity",()=>{
  const f=trustedFixture();try{approveTrustedAction(f,"start");assert.equal(macosRuntimeAction("start",{...f.options,runnerInspector:()=>({...f.runner,runner_id:"foreign"})}).error_id,"MACOS-RUNNER-APPROVAL-DRIFT");const active=trustedFixture({active:true});try{approveTrustedAction(active,"start");const result=macosRuntimeAction("start",active.options);assert.equal(result.error_id,"MACOS-LAUNCHCTL-IDENTITY");assert.equal(result.mutations_performed,false);}finally{active.cleanup();}}finally{f.cleanup();}
});

test("trusted single-user readiness blocks Runner actions before inspection",()=>{
  const f=trustedFixture();try{for(const action of ["install","start"]){let inspected=false;const result=macosRuntimeAction(action,{...f.options,runnerInspector:()=>{inspected=true;return f.runner;}});assert.equal(result.error_id,"MACOS-ACTION-APPROVAL");assert.equal(inspected,false);}}finally{f.cleanup();}
});

test("legacy and invalid profiles preserve native helper gate and mutation block",()=>{
  const f=fixture();try{assert.equal(macosRuntimeAction("status",{...f.options,capabilityVerifier:()=>({status:"MISSING"})}).error_id,"MACOS-NATIVE-CAPABILITY-INVALID");const invalid={...f.state,macos_service_policy:{...f.state.macos_service_policy,readiness_profile:TRUSTED_SINGLE_USER_READINESS_PROFILE}};assert.equal(macosRuntimeAction("install",{state:invalid}).error_id,"MACOS-READINESS-PROFILE-INVALID");}finally{f.cleanup();}
});

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
