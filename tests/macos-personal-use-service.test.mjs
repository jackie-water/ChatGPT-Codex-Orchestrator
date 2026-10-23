import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { macosRuntimeAction } from "../src/lib/macos-platform.mjs";
import { MACOS_RUNNER_RUNTIME_PATH } from "../src/lib/macos-runner-bootstrap.mjs";
import { MACOS_PERSONAL_USE_POLICY, hasMacosPersonalUsePolicy, inspectMacosPersonalUseLineage, macosPersonalUsePolicyChallenge } from "../src/lib/macos-personal-use-service.mjs";

function inspectNoJobLineage(runner) {
  return inspectMacosPersonalUseLineage({jobPid:null,runner,commandRunner:()=>assert.fail("No-job lineage must not inspect processes"),identityReader:()=>assert.fail("No-job lineage must not read native process identity")});
}

function fixture(t) {
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"personal-service-synthetic-")),oldHome=process.env.HOME;
  process.env.HOME=home;
  t.after(()=>{if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;fs.rmSync(home,{recursive:true,force:true});});
  const root=path.join(home,".chatgpt-codex-orchestrator","instances","abcdef12"),runnerPath=path.join(root,"runner"),helper=path.join(root,"runtime/native/macos/process-identity");
  const state={installation_id:"abcdef12-test",instance_id:"abcdef12",instance_root:root,runner_path:runnerPath,runner_owner:"abcdef12-test",runner_label:"codex-orchestrator-abcdef12",launch_agent_label:"com.chatgpt.codex.abcdef12",sandbox_only:true,target_environment_ready:false,github_login:"owner",control_repository:"owner/chatgpt-codex-orchestrator-control-abcdef12",control_repository_id:"101",macos_setup_approved:true,macos_action_approval:"install"};
  for(const relative of ["bin/Runner.Listener","bin/runsvc.sh","bin/RunnerService.js","externals/node24/bin/node"]) {
    const file=path.join(runnerPath,relative);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,"synthetic private payload never executed\n",{mode:0o700});
  }
  fs.mkdirSync(path.dirname(helper),{recursive:true,mode:0o700});fs.writeFileSync(helper,"synthetic helper never executed\n",{mode:0o700});
  const configFile=path.join(runnerPath,".runner"),configBytes=Buffer.from(JSON.stringify({agentId:303,agentName:state.runner_label,gitHubUrl:`https://github.com/${state.control_repository}`,serverUrl:"https://pipelines.actions.githubusercontent.com/example",workFolder:"_work"}));
  fs.writeFileSync(configFile,configBytes,{mode:0o600});const st=fs.lstatSync(configFile),configIdentity=Object.fromEntries(["dev","ino","uid","gid","mode","nlink","size","mtimeMs","ctimeMs"].map(key=>[key,st[key]]));
  state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:state.control_repository_id,approval:macosPersonalUsePolicyChallenge(state),approved_at:"2026-10-22T00:00:00Z"};
  const settings={loaded:false,started:false,listener:true,online:false,reuse:false,foreign:false,changedPlist:false,bootstrapFails:false},calls=[];
  const runner={status:"PASS",runner_executable:path.join(runnerPath,"bin/Runner.Listener"),program_arguments:["run"],service_executable:path.join(runnerPath,"bin/runsvc.sh"),service_arguments:[],service_node:path.join(runnerPath,"externals/node24/bin/node"),service_node_version:"node24",service_script:path.join(runnerPath,"bin/RunnerService.js"),service_sha256:"b".repeat(64),runner_id:"303",approval_sha256:"a".repeat(64),config_sha256:crypto.createHash("sha256").update(configBytes).digest("hex"),config_identity:configIdentity,env_sha256:null,path_sha256:null};
  const plist=path.join(home,"Library/LaunchAgents",`${state.launch_agent_label}.plist`),job=`gui/${process.getuid?.()||0}/${state.launch_agent_label}`;
  const capability={status:"PASS",installation_id:state.installation_id,instance_path:root,helper_path:helper,receipt_path:path.join(root,"macos-native-helper-capability.json")};
  const jobOutput=()=>`${job} = {
    active count = 1
    path = ${plist}
    type = LaunchAgent
    state = ${settings.started?"running":"not running"}
    program = ${runner.service_executable}
    arguments = {
      ${runner.service_executable}
    }
    working directory = ${runnerPath}
    inherited environment = {
      DISPLAY => /private/tmp/synthetic
    }
    default environment = {
      PATH => /usr/bin:/bin:/usr/sbin:/sbin
    }
    environment = {
      PATH => ${MACOS_RUNNER_RUNTIME_PATH}
      ACTIONS_RUNNER_SVC => 1
      ORCHESTRATOR_MACOS_NATIVE_HELPER => ${helper}
      ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY => 1
      XPC_SERVICE_NAME => ${state.launch_agent_label}
    }
    domain = gui/${process.getuid?.()||0} [100003]
    ${settings.started?"pid = 101":""}
    event triggers = {
      nested => {
        stream = com.apple.launchd.synthetic
      }
    }
    properties = ${state.macos_runner_activation?"runatload |":""} inferred program |
      managed by launchd
  }`;
  const commandRunner=(command,args)=>{
    calls.push({command,args});
    if(command==="/bin/ps") {
      const uid=process.getuid?.()||0;
      return {ok:true,output:settings.started?`${uid} 101 1 /bin/bash ${runner.service_executable}\n${uid} 102 101 ./externals/node24/bin/node ./bin/RunnerService.js\n${settings.listener?`${settings.foreign?uid+1:uid} 103 102 ${runner.runner_executable} run --startuptype service\n`:""}`:""};
    }
    assert.equal(command,"launchctl","fixture forbids all real commands");
    if(args[0]==="list")return {ok:true,output:settings.loaded?`${settings.started?101:"-"}\t0\t${state.launch_agent_label}`:"PID\tStatus\tLabel"};
    if(args[0]==="print")return {ok:settings.loaded,output:settings.loaded?jobOutput():`Bad request.\nCould not find service "${state.launch_agent_label}" in domain for user gui: ${process.getuid?.()||0}`};
    if(args[0]==="bootstrap") {
      settings.loaded=true;settings.started=true;
      if(settings.changedPlist)fs.appendFileSync(plist,"\n<!-- changed -->\n");
      return {ok:!settings.bootstrapFails,output:settings.bootstrapFails?"ambiguous failure":""};
    }
    if(args[0]==="bootout"){settings.loaded=false;settings.started=false;return {ok:true,output:""};}
    throw new Error("Unexpected command in synthetic fixture");
  };
  let nativeCalls=0;
  const identityReader=pid=>{nativeCalls++;return {status:"OK",pid,start_sec:settings.reuse&&nativeCalls>3?999:123,start_usec:pid};};
  const runnerInspector=()=>({...runner,runner_status:settings.online?"online":"offline",local_listener_pid:settings.started&&settings.listener?103:null,local_listener_identity:settings.started&&settings.listener?{pid:103,start_sec:123,start_usec:103}:null,local_service_pids:settings.started?[101,102]:[]});
  const options={state,home,platform:"darwin",arch:"arm64",commandRunner,runnerInspector,capabilityVerifier:()=>capability,identityReader};
  const activate=()=>{state.macos_action_approval="start";state.macos_activation_challenge="start:"+"c".repeat(64);state.macos_runner_bootstrap={phase:"START_INTENT",start_challenge:state.macos_activation_challenge};state.macos_runner_activation={installation_id:state.installation_id,runner_id:runner.runner_id,approval_sha256:runner.approval_sha256,challenge:state.macos_activation_challenge,login_restart_approved:true,approved_at:"2026-10-22T00:00:00Z"};};
  return {state,settings,calls,runner,plist,options,activate};
}

test("personal policy is explicit, owner-bound, and never implied by setup consent",()=>{
  assert.equal(hasMacosPersonalUsePolicy({macos_setup_approved:true}),false);
  assert.equal(hasMacosPersonalUsePolicy({macos_service_policy:{policy:MACOS_PERSONAL_USE_POLICY}}),false);
});

test("no-job idle requires an empty independent supervisor inventory without process inspection",()=>{
  for(const local_listener_pid of [null,undefined]) {
    assert.deepEqual(inspectNoJobLineage({status:"PASS",local_listener_pid,local_service_pids:[]}),{listener_running:false,job_identity:null,listener_identity:null});
  }
});

test("no-job idle rejects an independently observed integer supervisor PID",()=>{
  assert.throws(()=>inspectNoJobLineage({status:"PASS",local_listener_pid:null,local_service_pids:[707]}),/extra or unmanaged runner supervisor/);
});

test("no-job idle rejects invalid, unknown, and missing supervisor inventories",()=>{
  for(const local_service_pids of [[0],[-1],[1],[1.5],[NaN],[Number.MAX_SAFE_INTEGER+1],[null],[undefined],["unknown"],[{}],Array(1),null,undefined,"unknown",707,{}]) {
    assert.throws(()=>inspectNoJobLineage({status:"PASS",local_listener_pid:null,local_service_pids}),/extra or unmanaged runner supervisor/);
  }
  assert.throws(()=>inspectNoJobLineage({status:"PASS",local_listener_pid:null}),/extra or unmanaged runner supervisor/);
});

test("no-job idle rejects an absent or invalid independent runner identity",()=>{
  for(const runner of [undefined,null,false,707,"unknown",[],{}, {local_listener_pid:null,local_service_pids:[]}, {status:"ERROR",local_listener_pid:null,local_service_pids:[]}]) {
    assert.throws(()=>inspectNoJobLineage(runner),/runner identity is unavailable or invalid/);
  }
});

test("no-job idle rejects every non-null listener PID",()=>{
  for(const local_listener_pid of [103,0,false,"unknown"]) {
    assert.throws(()=>inspectNoJobLineage({status:"PASS",local_listener_pid,local_service_pids:[]}),/listener exists outside the imported service/);
  }
});

test("inactive install grants no login execution; activation uses the official supervised service chain",t=>{
  const f=fixture(t),installed=macosRuntimeAction("install",f.options);
  assert.equal(installed.status,"PASS");assert.match(fs.readFileSync(f.plist,"utf8"),/<key>RunAtLoad<\/key><false\/>/);
  assert.ok(fs.readFileSync(f.plist,"utf8").includes(f.runner.service_executable));assert.equal(f.calls.some(call=>call.args[0]==="bootstrap"),false);
  f.activate();assert.equal(macosRuntimeAction("start",{...f.options,preflightOnly:true}).status,"PASS");assert.equal(f.calls.some(call=>call.args[0]==="bootstrap"),false);
  const started=macosRuntimeAction("start",f.options);assert.equal(started.status,"PASS");assert.equal(started.listener_running,true);assert.equal(started.pid,101);assert.equal(started.listener_identity.pid,103);assert.notEqual(started.pid,started.listener_identity.pid);
  assert.match(fs.readFileSync(f.plist,"utf8"),/<key>RunAtLoad<\/key><true\/>/);assert.doesNotMatch(fs.readFileSync(f.plist,"utf8"),/<key>KeepAlive/);
  const health=macosRuntimeAction("status",f.options);assert.equal(health.status,"PASS");assert.equal(health.runner_state,"listener-running");assert.equal(health.github_online,false);
  assert.equal(f.calls.some(call=>call.args.some(arg=>String(arg).includes("--disableupdate"))),false);
});

test("loaded idle is distinct from a verified listener and from remote online",t=>{
  const f=fixture(t);assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.activate();f.settings.listener=false;f.settings.online=true;
  const result=macosRuntimeAction("start",f.options);assert.equal(result.status,"PASS");assert.equal(result.launchctl_state,"loaded");assert.equal(result.runner_state,"loaded-idle");assert.equal(result.listener_running,false);assert.equal(result.github_online,true);
});

test("loaded without a job PID is idle only with an empty independent supervisor inventory",t=>{
  const f=fixture(t);assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.settings.loaded=true;
  let nativeCalls=0;
  const result=macosRuntimeAction("status",{...f.options,identityReader:()=>{nativeCalls++;assert.fail("Idle status must not read native process identity");}});
  assert.equal(result.status,"PASS");assert.equal(result.launchctl_state,"loaded");assert.equal(result.runner_state,"loaded-idle");assert.equal(result.listener_running,false);assert.equal(result.job_identity,null);assert.equal(result.listener_identity,null);
  assert.equal(nativeCalls,0);assert.equal(f.calls.some(call=>call.command==="/bin/ps"),false);
});

for(const action of ["status","start"]) {
  test(`${action} preflight rejects a loaded job without a PID when an independent supervisor exists`,t=>{
    const f=fixture(t);assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.settings.loaded=true;
    const before=fs.readFileSync(f.plist),runnerInspector=()=>({...f.options.runnerInspector(),local_service_pids:[707]});
    let nativeCalls=0;
    const result=macosRuntimeAction(action,{...f.options,runnerInspector,preflightOnly:true,identityReader:()=>{nativeCalls++;assert.fail("No-job preflight must not read native process identity");}});
    assert.equal(result.status,"ERROR");assert.equal(result.error_id,"MACOS-LAUNCHCTL-IDENTITY");assert.match(result.details,/extra or unmanaged runner supervisor/);
    assert.equal(result.mutations_performed,false);assert.equal(result.pre_mutation_rejection,true);assert.equal(result.service_action_state,"NOT_ATTEMPTED");
    assert.deepEqual(fs.readFileSync(f.plist),before);assert.equal(nativeCalls,0);assert.equal(f.calls.some(call=>call.command==="/bin/ps"),false);assert.equal(f.calls.some(call=>["bootstrap","bootout"].includes(call.args[0])),false);
  });
}

test("setup/action consent alone cannot activate a personal service",t=>{
  const f=fixture(t);assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.state.macos_action_approval="start";
  const result=macosRuntimeAction("start",f.options);assert.equal(result.error_id,"MACOS-ACTIVATION-APPROVAL");assert.equal(result.pre_mutation_rejection,true);assert.equal(result.service_action_state,"NOT_ATTEMPTED");assert.equal(f.calls.some(call=>call.args[0]==="bootstrap"),false);
});

for(const kind of ["reused-pid","foreign-listener","missing-native-proof","changed-plist","ambiguous-bootstrap"]){
  test(`personal activation preserves uncertain evidence after ${kind}`,t=>{
    const f=fixture(t);assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.activate();
    if(kind==="reused-pid")f.settings.reuse=true;if(kind==="foreign-listener")f.settings.foreign=true;if(kind==="changed-plist")f.settings.changedPlist=true;if(kind==="ambiguous-bootstrap")f.settings.bootstrapFails=true;
    const result=macosRuntimeAction("start",kind==="missing-native-proof"?{...f.options,identityReader:()=>({status:"MISSING"})}:f.options);
    assert.equal(result.status,"ERROR");assert.equal(result.mutations_performed,"UNKNOWN");assert.equal(result.recovery_status,"INSPECT_ONLY_NO_AUTOMATIC_RETRY");assert.equal(f.calls.filter(call=>call.args[0]==="bootstrap").length,1);assert.equal(f.calls.some(call=>call.args[0]==="bootout"),false);
  });
}


test("a same-UID listener with the wrong native supervisor lineage is rejected",t=>{
  const f=fixture(t);assert.equal(macosRuntimeAction("install",f.options).status,"PASS");f.activate();
  const original=f.options.commandRunner;
  const commandRunner=(command,args)=>{const result=original(command,args);return command==="/bin/ps"?{...result,output:result.output.replace("103 102 ","103 101 ")}:result;};
  const result=macosRuntimeAction("start",{...f.options,commandRunner});
  assert.equal(result.status,"ERROR");assert.equal(result.mutations_performed,"UNKNOWN");assert.equal(f.calls.filter(call=>call.args[0]==="bootstrap").length,1);
});

test("unknown print failure is not evidence that the user service is absent",t=>{
  const f=fixture(t),original=f.options.commandRunner;
  const result=macosRuntimeAction("install",{...f.options,commandRunner:(command,args)=>args[0]==="print"?{ok:false,output:"permission denied"}:original(command,args)});
  assert.equal(result.error_id,"MACOS-LAUNCHCTL-ABSENCE-UNKNOWN");assert.equal(result.pre_mutation_rejection,true);assert.equal(fs.existsSync(f.plist),false);
});
