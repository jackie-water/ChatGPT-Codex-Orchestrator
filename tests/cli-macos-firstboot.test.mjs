import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { MACOS_PERSONAL_USE_POLICY, TRUSTED_SINGLE_USER_READINESS_PROFILE, hasMacosPersonalUsePolicy, hasTrustedSingleUserReadinessProfile, hasTrustedSingleUserReadinessProfileMarker, hasTrustedSingleUserReadinessIdentity, macosPersonalUsePolicyChallenge, trustedSingleUserReadinessProfileChallenge } from "../src/lib/macos-personal-use-service.mjs";
import {canonicalInstallationId, defaultLocalPaths} from "../src/lib/control-render.mjs";
import {ensureInstallerChatRegistration, findRegisteredChatRoute, normalizeChatUrl} from "../src/lib/chat-registration.mjs";
import {githubReadOnlyApi, issueTrustedRecoveryEvidence, verifyTrustedRecoveryEvidence} from "../src/lib/macos-trusted-recovery-evidence.mjs";
import {isMacosFreshFirstInstallBootstrap} from "../src/lib/macos-existing-instance-recovery.mjs";
import {macosPrerequisites, macosRuntimeAction, trustedClaimRead} from "../src/lib/macos-platform.mjs";

const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
const helpers=cli.slice(cli.indexOf("function macosRunnerActionChallenge("),cli.indexOf("function dryRun()"));

function fixture(t){
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"macos-firstboot-synthetic-"));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const state={installation_id:"abcd1234-test",instance_id:"abcd1234",instance_root:path.join(home,".chatgpt-codex-orchestrator","instances","abcd1234"),control_repository:"owner/chatgpt-codex-orchestrator-control-abcd1234",control_repository_id:"101",github_login:"owner",sandbox_repository:"owner/chatgpt-codex-orchestrator-sandbox-abcd1234",sandbox_repository_id:"202",sandbox_project_key:"sandbox-abcd1234",runner_label:"codex-orchestrator-abcd1234",browser_profile:path.join(home,"profile"),browser_port:19432,pending_wake_outbox:path.join(home,"outbox")};
  state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:state.control_repository_id,approval:macosPersonalUsePolicyChallenge(state),approved_at:"2026-10-22T00:00:00Z"};
  const identity={pid:303,start_sec:123,start_usec:456};
  const runner={local_listener_identity:identity,status:"PASS",runner_id:"303",runner_executable:path.join(state.instance_root,"runner","bin","Runner.Listener"),approval_sha256:"a".repeat(64)};
  const calls=[],snapshots=[];
  const settings={online:false,fail:null,plist:true,idle:false,rejectPreflight:false,rejectFinal:false};
  const context=vm.createContext({crypto,os,fs,path,process,canonicalInstallationId,trustedClaimRead,hasMacosPersonalUsePolicy,hasTrustedSingleUserReadinessProfile,macosPersonalUsePolicyChallenge,trustedSingleUserReadinessProfileChallenge,TRUSTED_SINGLE_USER_READINESS_PROFILE,isMacosFreshFirstInstallBootstrap,inspectMacosRunnerBootstrap:()=>{throw Error("No real inspector in synthetic test");},macosRuntimeAction:()=>{throw Error("No real service in synthetic test");},saveState:()=>{throw Error("No real installer state in synthetic test");}});
  vm.runInContext(helpers+"\nthis.advance=advanceMacosFirstBootRunner;this.challenge=macosRunnerActionChallenge;this.claim=claimMacosFirstBootOperation;",context);
  const inspect=({requireOnline})=>{calls.push(requireOnline?"inspect-online":"inspect-package");return requireOnline&&!settings.online?{status:"NEEDS_USER_ACTION",error_id:"MACOS-RUNNER-OFFLINE"}:{...runner};};
  const runtime=(operation,{state:actual,preflightOnly})=>{
    if(preflightOnly){calls.push("preflight-"+operation);return settings.rejectPreflight?{status:"ERROR",error_id:"PROVEN-PRE-MUTATION",pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false}:{status:"PASS",preflight_only:true,mutations_performed:false};}
    calls.push(operation);
    if(operation!=="status"){
      assert.equal(actual.macos_action_approval,operation);
      assert.equal(state.macos_runner_action_approval,undefined,"approval consumed before service operation");
      assert.equal(snapshots.at(-1).macos_runner_bootstrap.phase,operation==="install"?"INSTALL_INTENT":"START_INTENT");
    }
    if(settings.rejectFinal&&(settings.rejectFinal===true&&operation==="start"||settings.rejectFinal===operation))return {status:"ERROR",error_id:"PROVEN-PRE-MUTATION",pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false};
    if(settings.fail===operation) return {status:"ERROR",error_id:"SYNTHETIC-INTERRUPTION",mutations_performed:"UNKNOWN"};
    return {status:"PASS",launchctl_state:"loaded",listener_running:!settings.idle,listener_identity:settings.idle?null:identity,plist_verified:settings.plist,mutations_performed:operation!=="status"};
  };
  return {home,state,runner,calls,snapshots,settings,context,inspect,claim:(action,attempt=1)=>context.claim({state,action,attempt,challenge:context.challenge(action,state,runner,attempt),home}),challenge:op=>context.challenge(op,state,runner),advance:()=>context.advance(state,{home,inspect,runtime,claim:()=>({status:"OWNED"}),persist:state=>snapshots.push(JSON.parse(JSON.stringify(state)))})};
}

test("first boot separately approves install/start then waits for a real matching online Runner",t=>{
  const f=fixture(t);
  let result=f.advance();
  assert.equal(result.action_id,"macos_runner_install");
  assert.equal(f.calls.includes("install"),false);
  f.state.macos_runner_action_approval=result.approval_challenge;
  result=f.advance();
  assert.equal(result.action_id,"macos_runner_start");
  assert.equal(f.state.macos_runner_bootstrap.phase,"PLIST_INSTALLED");
  assert.equal(f.calls.includes("start"),false);
  f.state.macos_runner_action_approval=result.approval_challenge;
  result=f.advance();
  assert.equal(result.status,"WAITING");
  assert.equal(result.action_id,"macos_runner_online");
  assert.equal(f.state.macos_runner_bootstrap.phase,"STARTED");
  f.settings.online=true;
  result=f.advance();
  assert.equal(result.status,"READY");
  assert.equal(f.calls.filter(x=>x==="install").length,1);
  assert.equal(f.calls.filter(x=>x==="start").length,1);
  assert.equal(f.state.sandbox_review_route,undefined,"registration does not need its own preexisting Chat route");
});

test("trusted install requires its own exact approval before intent",t=>{
  const f=fixture(t);f.state.macos_setup_approved=true;f.state.macos_service_policy.readiness_profile=TRUSTED_SINGLE_USER_READINESS_PROFILE;f.state.macos_service_policy.approval=trustedSingleUserReadinessProfileChallenge(f.state);
  let result=f.advance();
  assert.equal(result.action_id,"macos_runner_install");assert.equal(f.state.macos_runner_bootstrap,undefined);
  f.state.macos_runner_action_approval="true";assert.equal(f.advance().action_id,"macos_runner_install");
  f.state.macos_runner_action_approval=result.approval_challenge;result=f.advance();
  assert.equal(result.action_id,"macos_runner_start");assert.equal(f.state.macos_runner_bootstrap.phase,"PLIST_INSTALLED");
});

test("trusted first install preclaims through the actual runtime gate",t=>{
  const f=fixture(t),previousHome=process.env.HOME,runnerPath=path.join(f.state.instance_root,"runner"),service=path.join(runnerPath,"bin","runsvc.sh"),listener=path.join(runnerPath,"bin","Runner.Listener");
  try{
    process.env.HOME=f.home;for(const file of [service,listener]){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,"synthetic\n",{mode:0o700});}
    Object.assign(f.state,{runner_path:runnerPath,launch_agent_label:"com.chatgpt.codex.firstboot",macos_setup_approved:true});f.state.macos_service_policy.readiness_profile=TRUSTED_SINGLE_USER_READINESS_PROFILE;f.state.macos_service_policy.approval=trustedSingleUserReadinessProfileChallenge(f.state);
    const actualRunner={...f.runner,runner_executable:listener,service_executable:service,service_arguments:[],local_process_observation:"trusted-single-user-ps-v1",local_listener_pid:null,local_listener_identity:null,local_service_pids:[]};
    const commandRunner=(command,args)=>command==="launchctl"&&args[0]==="list"?{ok:true,output:""}:command==="launchctl"&&args[0]==="print"?{ok:false,output:`Could not find service \"${f.state.launch_agent_label}\" in domain for user gui:${process.getuid?.()||0}`}:{ok:false,output:"unexpected"};
    const runtime=(action,options)=>options.preflightOnly?macosRuntimeAction(action,{...options,platform:"darwin",arch:"arm64",commandRunner,runnerInspector:()=>actualRunner,capabilityVerifier:()=>{throw Error("legacy helper must not run");}}):{status:"PASS",launchctl_state:"loaded",listener_running:true,listener_identity:f.runner.local_listener_identity,plist_verified:true,mutations_performed:true};
    f.state.macos_runner_action_approval=f.context.challenge("install",f.state,actualRunner);const output=f.context.advance(f.state,{home:f.home,inspect:()=>actualRunner,runtime,claim:()=>({status:"OWNED",path:path.join(f.state.instance_root,"claim")}),persist:state=>f.snapshots.push(JSON.parse(JSON.stringify(state)))});
    assert.equal(output.action_id,"macos_runner_start",JSON.stringify(output));assert.equal(f.state.macos_runner_bootstrap.phase,"PLIST_INSTALLED");assert.equal(f.calls.includes("install"),false);
  }finally{if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;}
});

test("ambiguous service action preserves its journal and cannot automatically repeat",t=>{
  const f=fixture(t);
  f.state.macos_runner_action_approval=f.challenge("install");
  f.settings.fail="install";
  assert.equal(f.advance().recovery_status,"MANUAL_RECOVERY_REQUIRED");
  assert.equal(f.state.macos_runner_bootstrap.phase,"ERROR");
  f.settings.fail=null;
  f.state.macos_runner_action_approval=f.challenge("install");
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-INTERRUPTED");
  assert.equal(f.calls.filter(x=>x==="install").length,1);
});

test("trusted interrupted action cannot consume approval twice",t=>{
  const f=fixture(t);f.state.macos_setup_approved=true;f.state.macos_service_policy.readiness_profile=TRUSTED_SINGLE_USER_READINESS_PROFILE;f.state.macos_service_policy.approval=trustedSingleUserReadinessProfileChallenge(f.state);
  f.state.macos_runner_action_approval=f.challenge("install");f.settings.fail="install";
  assert.equal(f.advance().recovery_status,"MANUAL_RECOVERY_REQUIRED");const intent=JSON.stringify(f.state.macos_runner_bootstrap);
  f.state.macos_runner_action_approval=f.challenge("install");f.settings.fail=null;
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-INTERRUPTED");assert.equal(JSON.stringify(f.state.macos_runner_bootstrap),intent);assert.equal(f.calls.filter(x=>x==="install").length,1);
});

test("one-time operation claims cannot be shared or reclaimed by a second resume",t=>{
  const f=fixture(t);
  fs.mkdirSync(f.state.instance_root,{recursive:true,mode:0o700});
  const first=f.claim("install");
  assert.equal(first.status,"OWNED");
  const bytes=fs.readFileSync(first.path);
  assert.equal(f.claim("install").error_id,"MACOS-FIRST-BOOT-ALREADY-CLAIMED");
  assert.deepEqual(fs.readFileSync(first.path),bytes);
  assert.equal(f.claim("start").status,"OWNED","start has a distinct separately approved operation claim");
  assert.equal(f.calls.includes("install"),false);
});

test("boolean approvals, changed package/IDs, and bogus loaded-plist claims fail closed",t=>{
  const f=fixture(t);
  f.state.macos_runner_action_approval=true;
  assert.equal(f.advance().action_id,"macos_runner_install");
  f.state.macos_runner_action_approval=f.challenge("install");
  f.advance();
  f.runner.approval_sha256="b".repeat(64);
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-IDENTITY");
  f.runner.approval_sha256="a".repeat(64);
  f.state.macos_runner_action_approval=f.challenge("start");
  f.settings.online=true;f.settings.plist=false;
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-SERVICE");
  f.state.control_repository_id="999";
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-IDENTITY");
});

test("official macOS installer orders all identity and native gates before first registration",()=>{
  const begin=cli.indexOf("function runSetup() {");
  const end=cli.indexOf("\n  state.installation_id ||= crypto.randomUUID();",begin);
  const mac=cli.slice(begin,end);
  const registration=mac.indexOf("registration=ensureInstallerChatRegistration");
  for(const gate of ["github_plugin_authorization_verified!==true","verifyMacosGeneratedRepositories({state})","prepareMacosNativeHelper({state","if(!state.codex_trust_sandbox)","if(!state.reviewer_browser_ready)","const runnerBootstrap=advanceMacosFirstBootRunner(state)","runnerBootstrap.status!==\"READY\""]){
    assert.ok(mac.indexOf(gate)>=0&&mac.indexOf(gate)<registration,gate);
  }
  assert.doesNotMatch(mac,/activateTargetProject\(/);
  assert.match(mac,/MACOS-POST-SANDBOX-UNSUPPORTED/);
  const windows=cli.slice(end,cli.indexOf("function codexLogin()",end));
  assert.match(windows,/scripts","install-runner\.ps1/);
  assert.doesNotMatch(windows,/advanceMacosFirstBootRunner|macos_runner_package_approval/);
});

test("fresh bootstrap admits only the exact two-root aggregate and complete independent provenance",()=>{
  const start=cli.indexOf("function macosBootstrapMayAdvance(");
  const end=cli.indexOf("function macosSelectedAwaitingFirstRoute(",start);
  const context=vm.createContext({path,os:{homedir:()=>"/Users/test"},canonicalInstallationId:id=>id,findRegisteredChatRoute:(actual,{projectKey,chatUrl})=>actual.__delivered&&projectKey===actual.sandbox_project_key&&chatUrl===actual.reviewer_chat_url?{route:actual.sandbox_review_route,project:projectKey,chat_url:chatUrl,installation_id:actual.installation_id,registration_issue:Number(String(actual.sandbox_review_route||"").slice(5))}:null});
  vm.runInContext(cli.slice(start,end)+"\nthis.fresh=macosFreshBootstrapMayAdvance;",context);
  const state={macos_setup_approved:true,installation_id:"new-install",instance_id:"new-install",instance_root:"/Users/test/.chatgpt-codex-orchestrator/instances/new-install",control_repository:"org/control",sandbox_repository:"org/sandbox",control_repository_id:"101",sandbox_repository_id:"202",control_environment_ready:true,target_environment_ready:false,github_login:"owner",github_owner_id:"42",reviewer_chat_url:"https://chatgpt.com/c/approved",sandbox_project_key:"sandbox-new-install"};
  const recovery={status:"NEEDS_VERIFICATION",instance_ids:["new-install"],instances:[{instance_id:"new-install",status:"NEEDS_VERIFICATION",route_names:[],route_bindings:[],missing_verification_gates:["chat_routes_metadata","migration_snapshot_metadata","registered_route_evidence"],identity:{instance_id:"new-install",installation_id:"new-install",control_repository:"org/control",sandbox_repository:"org/sandbox"}}]};
  const evidence={status:"NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE",provenance:{control_repository_id:"101",sandbox_repository_id:"202"}};
  assert.equal(context.fresh(state,recovery,evidence),true);
  assert.equal(context.fresh({...state,fresh_first_install_bootstrap:true}, {...recovery,instance_ids:["new-install","foreign"],instances:[...recovery.instances,{identity:{instance_id:"foreign"}}]}, evidence),false);
  assert.equal(context.fresh(state,recovery,{...evidence,provenance:{control_repository_id:"101"}}),false);
  assert.equal(context.fresh({...state,target_environment_ready:true},recovery,evidence),false);
  const scannerOmission={...recovery,status:"CONFLICT",instance_ids:["1832f0bb","new-install"],instances:[
    {instance_id:"1832f0bb",status:"CONFLICT",fresh_first_install_candidate:true,missing_verification_gates:["safe_instance_tree"]},
    {...recovery.instances[0],identity:undefined,missing_verification_gates:["verified_role_identities"]}
  ]};
  const connectorEvidence={...evidence,status:"NEW_INSTALL_AWAITING_CONNECTOR_AUTH",provenance:{...evidence.provenance,github_owner_id:"42",github_login:"owner"}};
  assert.equal(context.fresh(state,scannerOmission,connectorEvidence),true);
  const foreignRoot={instance_id:"foreign",status:"NEEDS_VERIFICATION",missing_verification_gates:["verified_role_identities"]};
  const thirdRoot={...scannerOmission,instance_ids:[...scannerOmission.instance_ids,"foreign"],instances:[...scannerOmission.instances,foreignRoot]};
  assert.equal(context.fresh(state,thirdRoot,connectorEvidence),false,"a third root is never lower-authority admission");
  assert.equal(context.fresh({...state,instance_root:"/Users/test/foreign"},scannerOmission,connectorEvidence),false,"a foreign instance root is rejected");
  assert.equal(context.fresh(state,{...scannerOmission,instance_ids:["foreign","new-install"],instances:[foreignRoot,scannerOmission.instances[1]]},connectorEvidence),false,"a foreign root cannot replace the historical conflict");
  assert.equal(context.fresh({...state,github_owner_id:"99"},scannerOmission,connectorEvidence),false,"foreign owner provenance is rejected");
  for (const [key,foreign] of [["github_owner_id","99"],["github_login","Owner"]]) {
    for (const value of [undefined,null,"",foreign]) {
      assert.equal(context.fresh({...state,[key]:value},scannerOmission,connectorEvidence),false,`invalid state ${key} is rejected`);
      assert.equal(context.fresh(state,scannerOmission,{...connectorEvidence,provenance:{...connectorEvidence.provenance,[key]:value}}),false,`invalid provenance ${key} is rejected`);
    }
  }
  assert.equal(context.fresh(state,{...scannerOmission,instances:scannerOmission.instances.map(item=>item.instance_id==="new-install"?{...item,missing_verification_gates:["verified_role_identities","unexpected_gate"]}:item)},evidence),false);
  assert.equal(context.fresh(state,scannerOmission,{...connectorEvidence,provenance:undefined}),false,"missing provenance is rejected");
  for (const key of ["control_repository_id","sandbox_repository_id"]) {
    assert.equal(context.fresh(state,scannerOmission,{...connectorEvidence,provenance:{...connectorEvidence.provenance,[key]:undefined}}),false,`missing ${key} provenance is rejected`);
    assert.equal(context.fresh(state,scannerOmission,{...connectorEvidence,provenance:{...connectorEvidence.provenance,[key]:"999"}}),false,`wrong ${key} provenance is rejected`);
  }
  assert.equal(context.fresh(state,scannerOmission,evidence),true,"prepared awaiting-route admission still requires no route");
  for (const phase of ["NEW_INSTALL_REGISTRATION_PENDING","NEW_INSTALL_PREPARED","VERIFIED"])
    assert.equal(context.fresh(state,scannerOmission,{...evidence,status:phase}),false);
  const pendingEvidence={...evidence,status:"NEW_INSTALL_REGISTRATION_PENDING",provenance:{...evidence.provenance,registration_issue_id:408}};
  state.sandbox_chat_registration_issue=`https://github.com/${state.control_repository}/issues/408`;
  const boundRecovery={...scannerOmission,instances:scannerOmission.instances.map(item=>item.instance_id==="new-install"?{...item,route_names:["chat-408"],route_bindings:[{route:"chat-408",status:"active",project:"sandbox-new-install",instance_id:"new-install",installation_id:"new-install",control_repository:"org/control",sandbox_repository:"org/sandbox"}]}:item)};
  assert.equal(context.fresh(state,boundRecovery,evidence),false,"prepared awaiting-route admission rejects an existing route");
  assert.equal(context.fresh(state,boundRecovery,pendingEvidence),true);
  assert.equal(context.fresh(state,{...boundRecovery,instances:boundRecovery.instances.map(item=>item.instance_id==="new-install"?{...item,route_bindings:[{...item.route_bindings[0],route:"chat-409"}]}:item)},pendingEvidence),false);
  const preparedEvidence={...pendingEvidence,status:"NEW_INSTALL_PREPARED"};
  const preparedState={...state,sandbox_review_route:"chat-408",__delivered:false};
  assert.equal(context.fresh(preparedState,boundRecovery,preparedEvidence),false);
  assert.equal(context.fresh({...preparedState,__delivered:true},boundRecovery,preparedEvidence),true);
  assert.equal(context.fresh({...preparedState,__delivered:true,review_route:"chat-409"},boundRecovery,preparedEvidence),false);
  assert.equal(context.fresh({...preparedState,__delivered:true,sandbox_review_route:"chat-409"},boundRecovery,preparedEvidence),false);
});

test("dry-run behavior admits the exact two-root bootstrap without mutation and denies foreign state",t=>{
  const begin=cli.indexOf("function dryRun() {");
  const end=cli.indexOf("function codexLogin()",begin);
  const dryHome=path.resolve(os.tmpdir());
  const state={macos_setup_approved:true,installation_id:"new-install",instance_id:"new-install",instance_root:path.join(dryHome,".chatgpt-codex-orchestrator","instances","new-install"),control_repository:"org/control",sandbox_repository:"org/sandbox",control_repository_id:"101",sandbox_repository_id:"202",control_environment_ready:true,target_environment_ready:false,github_login:"owner",github_owner_id:"42",reviewer_chat_url:"https://chatgpt.com/c/approved",sandbox_project_key:"sandbox-new-install",generated_repo_authorized:false};
  const exactRecovery={status:"CONFLICT",instance_ids:["1832f0bb","new-install"],instances:[{instance_id:"1832f0bb",status:"CONFLICT",fresh_first_install_candidate:true,missing_verification_gates:["safe_instance_tree"]},{instance_id:"new-install",status:"NEEDS_VERIFICATION",route_names:[],route_bindings:[],missing_verification_gates:["verified_role_identities"],identity:undefined}]};
  const evidence={status:"NEW_INSTALL_AWAITING_CONNECTOR_AUTH",provenance:{control_repository_id:"101",sandbox_repository_id:"202",github_owner_id:"42",github_login:"owner"}};
  const run=(recovery,actualEvidence,{actualState=state,expectedNativeCalls=0}={})=>{
    const before=JSON.stringify({state:actualState,recovery,evidence:actualEvidence});
    const emitted=[],nativeCalls=[];
    const nativePreflight={status:"PASS",mutations_performed:false};
    const context=vm.createContext({path,os:{...os,homedir:()=>dryHome},process:{platform:"darwin"},loadState:options=>{assert.equal(options.create,false);return actualState;},ensureStateLanguage:()=>"en",macosRecoveryReport:()=>recovery,macosTrustedRecoveryEvidence:()=>actualEvidence,commandExists:()=>({ok:true}),macosPrerequisites:()=>({node:true,session_auth:true,native_helper:{status:"PASS"}}),migrationPreflight:()=>({status:"READY"}),macosNativeHelperPreflight:options=>{nativeCalls.push(options);return nativePreflight;},emit:(result,code=0)=>{emitted.push({result,code});},findRegisteredChatRoute:()=>null,canonicalInstallationId:id=>id});
    const stateGate=cli.slice(cli.indexOf("function macosStateBound("),cli.indexOf("function macosGithubApi("));
    const bootstrapGate=cli.slice(cli.indexOf("function macosBootstrapMayAdvance("),cli.indexOf("function macosTrustedRecoveryEvidence("));
    vm.runInContext(stateGate+bootstrapGate+cli.slice(begin,end)+"\nthis.runDry=dryRun;",context);
    context.runDry();
    assert.equal(JSON.stringify({state:actualState,recovery,evidence:actualEvidence}),before);
    assert.equal(emitted.length,1);
    assert.equal(emitted[0].result.mutations_performed,false);
    assert.equal(nativeCalls.length,expectedNativeCalls);
    for (const options of nativeCalls) {
      assert.deepEqual(Object.keys(options).sort(),["installationId","state"]);
      assert.equal(options.state,actualState);
      assert.equal(options.installationId,actualState.installation_id);
      assert.equal(emitted[0].result.macos_native_helper,nativePreflight);
    }
    return emitted[0];
  };
  const admitted=run(exactRecovery,evidence,{expectedNativeCalls:1});
  assert.equal(admitted.result.status,"PASS");
  assert.equal(admitted.code,0);
  assert.equal(admitted.result.dry_run,true);
  assert.equal(admitted.result.mutations_performed,false);
  const foreignRecovery={...exactRecovery,instance_ids:[...exactRecovery.instance_ids,"foreign"],instances:[...exactRecovery.instances,{instance_id:"foreign",status:"NEEDS_VERIFICATION"}]};
  const denied=run(foreignRecovery,evidence);
  assert.equal(denied.result.status,"ERROR");
  assert.equal(denied.code,1);
  assert.equal(denied.result.mutations_performed,false);
  assert.equal(run({...exactRecovery,status:"UNKNOWN"},evidence).result.status,"NEEDS_USER_ACTION");
  assert.equal(run(exactRecovery,evidence,{actualState:{...state,instance_root:path.join(dryHome,"foreign")}}).result.status,"ERROR");
  assert.equal(run({...exactRecovery,instance_ids:["foreign","new-install"],instances:[{...exactRecovery.instances[0],instance_id:"foreign"},exactRecovery.instances[1]]},evidence).result.status,"ERROR");
  for (const [key,foreign] of [["github_owner_id","99"],["github_login","Owner"]]) {
    for (const value of [undefined,null,"",foreign]) {
      assert.equal(run(exactRecovery,evidence,{actualState:{...state,[key]:value}}).result.status,"ERROR",`invalid state ${key} is denied`);
      assert.equal(run(exactRecovery,{...evidence,provenance:{...evidence.provenance,[key]:value}}).result.status,"ERROR",`invalid provenance ${key} is denied`);
    }
  }
  assert.equal(run(exactRecovery,{...evidence,provenance:{control_repository_id:"101"}}).result.status,"ERROR");
  assert.equal(run(exactRecovery,{...evidence,provenance:undefined}).result.status,"ERROR");
  for (const key of ["control_repository_id","sandbox_repository_id"]) {
    assert.equal(run(exactRecovery,{...evidence,provenance:{...evidence.provenance,[key]:undefined}}).result.status,"ERROR");
    assert.equal(run(exactRecovery,{...evidence,provenance:{...evidence.provenance,[key]:"999"}}).result.status,"ERROR");
  }
  assert.equal(run(exactRecovery,evidence,{actualState:{...state,target_environment_ready:true}}).result.status,"ERROR");
});

test("official setup requires approval before writes and uses the post-approval evidence phase",()=>{
  const begin=cli.indexOf("function runSetup() {");
  const end=cli.indexOf("\n  state.installation_id ||= crypto.randomUUID();",begin);
  const mac=cli.slice(begin,end);
  assert.ok(mac.indexOf("isMacosFreshFirstInstallBootstrap") < mac.indexOf("macos_setup_approval"));
  assert.ok(mac.indexOf("freshFirstInstall&&!state.macos_setup_approved") < mac.indexOf("macosTrustedRecoveryEvidence(state"));
  assert.ok(mac.indexOf("mutations_performed:false",mac.indexOf("macos_setup_approval")) < mac.indexOf("prepareMigrationIntent"));
  assert.match(mac,/const freshFirstInstallAfterApproval=freshFirstInstall \|\| approvedFreshContinuation/);
  assert.match(mac,/!freshFirstInstallAfterApproval&&earlyTrustedEvidence\.status===\"NEEDS_HUMAN_LEGACY\"/);
  assert.match(mac,/earlyTrustedEvidence\.status===\"NEW_INSTALL_AWAITING_CONNECTOR_AUTH\"/);
  assert.doesNotMatch(mac,/!freshFirstInstall&&earlyTrustedEvidence\.status===\"NEEDS_HUMAN_LEGACY\"/);
});

test("latest macOS evidence pins a pending first Issue before registration can create one",()=>{
  const begin=cli.indexOf("function runSetup() {");
  const end=cli.indexOf("\n  state.installation_id ||= crypto.randomUUID();",begin);
  const mac=cli.slice(begin,end);
  const latest=mac.indexOf("const latestPending=trustedEvidence.status===\"NEW_INSTALL_REGISTRATION_PENDING\";");
  const registration=mac.indexOf("registration=ensureInstallerChatRegistration");
  assert.ok(latest>=0&&latest<registration);
  assert.ok(mac.indexOf("savedIssueId>0",latest)<registration);
  assert.ok(mac.indexOf("Number(delivered.registration_issue)===savedIssueId",latest)<registration);
  assert.ok(mac.indexOf("normalizeChatUrl(delivered.chat_url)===normalizeChatUrl(state.reviewer_chat_url)",latest)<registration);
  assert.match(mac,/ensureInstallerChatRegistration\(state,\{projectKey:state\.sandbox_project_key\}\)/);
});

test("only independently approved fresh identity can await its first route without legacy adoption",()=>{
  const start=cli.indexOf("function macosSelectedAwaitingFirstRoute(");
  const end=cli.indexOf("function macosTrustedRecoveryEvidence(",start);
  const context=vm.createContext({});
  vm.runInContext(cli.slice(start,end)+"\nthis.awaiting=macosSelectedAwaitingFirstRoute;",context);
  const approved={status:"SELECTED_FRESH_INSTANCE_VERIFIED",route_count:0};
  assert.equal(context.awaiting({},approved),true);
  assert.equal(context.awaiting({}, {...approved,status:"NEEDS_USER_ACTION"}),false);
  assert.equal(context.awaiting({}, {...approved,status:"NEEDS_VERIFICATION"}),false);
  assert.equal(context.awaiting({}, {...approved,route_count:1}),false);
  assert.equal(context.awaiting({}, {...approved,route_count:1,first_route_pending:true}),true);
  assert.equal(context.awaiting({sandbox_review_route:"chat-408"},approved),false);
});

function pendingRegistrationResume(t){
  const f=fixture(t),state=f.state,calls=[],saved=[];
  Object.assign(state,{
    instance_platform:"darwin",instance_arch:"arm64",github_owner_id:"42",macos_setup_approved:true,
    github_plugin_authorized:true,github_plugin_authorization_verified:true,generated_repo_authorized:true,
    control_environment_ready:true,sandbox_only:true,target_environment_ready:false,sandbox_verified:false,
    reviewer_chat_url:"https://chatgpt.com/c/firstboot-pending",target_repository:"owner/target",completed:[],
    codex_trust_sandbox:true,reviewer_browser_ready:true,
    control_clone_path:defaultLocalPaths({home:f.home,installationId:state.installation_id,projectKey:state.sandbox_project_key}).control,
    chat_route_file:path.join(state.instance_root,"chat-routes.json")
  });
  Object.assign(state,{
    github_plugin_authorization_installation_id:state.installation_id,
    github_plugin_authorization_control_repository:state.control_repository,
    github_plugin_authorization_sandbox_repository:state.sandbox_repository,
    github_plugin_authorization_chat_url:state.reviewer_chat_url,
    sandbox_chat_registration_issue:`https://github.com/${state.control_repository}/issues/511`
  });
  const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value)+"\n",{mode:0o600});};
  const identity={instance_id:state.instance_id,installation_id:state.installation_id,control_repository:state.control_repository,sandbox_repository:state.sandbox_repository};
  write(path.join(state.control_clone_path,"instance.json"),{schema_version:1,...identity,role:"control",platform:"darwin",arch:"arm64",trusted_github_username:state.github_login,github_owner_id:state.github_owner_id,control_repository_id:state.control_repository_id,sandbox_repository_id:state.sandbox_repository_id});
  write(path.join(state.instance_root,"migration-intent.json"),{schema_version:1,phase:"PREPARED",installation_id:state.installation_id,generated_repositories:{control:state.control_repository,sandbox:state.sandbox_repository}});
  const route={route:"chat-511",project:state.sandbox_project_key,status:"active",chat_url:state.reviewer_chat_url,registration_issue:511,installation_id:state.installation_id};
  const hash=crypto.createHash("sha256").update(state.reviewer_chat_url).digest("hex").slice(0,16);
  const issue={number:511,html_url:state.sandbox_chat_registration_issue,url:`https://api.github.com/repos/${state.control_repository}/issues/511`,state:"open",title:`[CHAT-REGISTER] INSTALL-CHAT-${state.instance_id}-${state.sandbox_project_key}-${hash}`,user:{login:state.github_login,id:42},body:JSON.stringify({project:state.sandbox_project_key,chat_url:state.reviewer_chat_url,installation_id:state.installation_id})};
  const settings={offline:false,offlineAfterFirstProof:false,removeProofBeforeConsumption:false,queueDuringPrerequisites:false,issueListEmpty:false,firstEver:false},
  queueRoute=()=>write(state.chat_route_file,{version:1,routes:[route]}),
  deliverRoute=()=>{
    write(outbox,{delivery_state:"DELIVERED",delivery_owner:"register-chat.mjs",callback_id:callbackId,chat_url:state.reviewer_chat_url,verified_by:"existing-user-message"});
    write(journal,{schema_version:1,status:"DELIVERED",verified_role:"user",verified_by:"existing-user-message",callback_id:callbackId,chat_url:state.reviewer_chat_url,callback_state_sha256:crypto.createHash("sha256").update(fs.readFileSync(outbox)).digest("hex")});
  },api={
    getAuthenticatedUser:()=>({login:state.github_login,id:42}),
    getRepository:repository=>{
      if(settings.offline)throw Error("synthetic offline");
      const role=repository===state.control_repository?"control":"sandbox";
      return {id:role==="control"?101:202,private:true,visibility:"private",name:repository.split("/")[1],full_name:repository,owner:{login:state.github_login,id:42},description:`ChatGPT Codex Orchestrator ${role} installation ${state.installation_id}`};
    },
    getIssue:(repository,number)=>{assert.equal(repository,state.control_repository);assert.equal(number,511);return issue;}
  };
  const callbackId=`chat-register-${state.sandbox_project_key}-511`,outbox=path.join(state.instance_root,"pending-wakes",callbackId+".json"),journal=path.join(state.instance_root,"registration-delivery",callbackId+".json");
  const deliver=()=>{
    write(outbox,{delivery_state:"DELIVERED",delivery_owner:"register-chat.mjs",callback_id:callbackId,chat_url:state.reviewer_chat_url,verified_by:"existing-user-message"});
    write(journal,{schema_version:1,status:"DELIVERED",verified_role:"user",verified_by:"existing-user-message",callback_id:callbackId,chat_url:state.reviewer_chat_url,callback_state_sha256:crypto.createHash("sha256").update(fs.readFileSync(outbox)).digest("hex")});
  };
  const commandRunner=args=>{
    calls.push("issue-"+args[1]);
    if(args[1]==="create") { assert.equal(settings.firstEver,true); settings.firstEver=false; return {ok:true,stdout:issue.html_url}; }
    if(args[1]!=="list") return {ok:true,stdout:JSON.stringify(issue)};
    return {ok:true,stdout:JSON.stringify(settings.issueListEmpty||settings.firstEver?[]:[{...issue,state:"OPEN",url:issue.html_url}])};
  };
  const context=vm.createContext({
    crypto,path,os:{...os,homedir:()=>f.home},process:{platform:"darwin",cwd:()=>f.home},
    canonicalInstallationId,findRegisteredChatRoute,normalizeChatUrl,githubReadOnlyApi,issueTrustedRecoveryEvidence,hasMacosPersonalUsePolicy,hasTrustedSingleUserReadinessProfile,hasTrustedSingleUserReadinessProfileMarker,trustedSingleUserReadinessProfileChallenge,TRUSTED_SINGLE_USER_READINESS_PROFILE,
    isMacosFreshFirstInstallBootstrap,
    loadState:()=>state,ensureStateLanguage:()=>"en",saveState:actual=>{assert.equal(actual.target_environment_ready,false);saved.push(JSON.parse(JSON.stringify(actual)));},
    emit:(result,code=0)=>({result,code}),
    macosRecoveryReport:()=>({status:"NEEDS_VERIFICATION",instance_ids:[state.instance_id],instances:[{identity}]}),
    macosTrustedRecoveryEvidence:(actual,{requireReceipt})=>verifyTrustedRecoveryEvidence({state:actual,home:f.home,githubApi:api,requireReceipt}),
    macosPrerequisites:()=>{calls.push("prerequisites");if(settings.queueDuringPrerequisites){queueRoute();deliverRoute();settings.queueDuringPrerequisites=false;}if(settings.offlineAfterFirstProof)settings.offline=true;return {node:true,git:true,gh:true,codex:true,session_auth:true,github_auth:true,native_helper:{status:"PASS"},legacy_native_helper_gate:"PASS"};},
    migrationPreflight:()=>({status:"READY"}),authenticatedGithubLogin:()=>state.github_login,
    prepareMigrationIntent:()=>({path:path.join(state.instance_root,"migration-intent.json"),phase:"PREPARED"}),
    prepareControlEnvironment:()=>assert.fail("prepared Control must not be recreated"),
    verifyMacosGeneratedRepositories:()=>({control_repository_id:"101",sandbox_repository_id:"202",github_owner_id:"42"}),
    prepareMacosNativeHelper:()=>{calls.push("native-mock");if(settings.removeProofBeforeConsumption)fs.rmSync(journal);return {status:"PASS",instance_path:state.instance_root};},
    advanceMacosFirstBootRunner:()=>{calls.push("runner-mock");return {status:"READY"};},
    ensureInstallerChatRegistration:(actual,options)=>{calls.push("registration");assert.equal(actual.sandbox_review_route,undefined);return ensureInstallerChatRegistration(actual,{...options,commandRunner:options.commandRunner||commandRunner});},
    spawnSafeSync:(executable,args)=>{
      assert.equal(executable,"gh");assert.deepEqual(Array.from(args).slice(0,3),["api","--hostname","github.com"]);
      const endpoint=args[3];let value;
      if(endpoint==="user")value=api.getAuthenticatedUser();
      else if(endpoint===`repos/${state.control_repository}/issues/511`)value=api.getIssue(state.control_repository,511);
      else if(endpoint===`repos/${state.control_repository}`)value=api.getRepository(state.control_repository);
      else if(endpoint===`repos/${state.sandbox_repository}`)value=api.getRepository(state.sandbox_repository);
      else assert.fail("unexpected synthetic GitHub endpoint");
      return {status:0,stdout:JSON.stringify(value)};
    },
    sandboxSmokeStatus:()=>{calls.push("sandbox-status");assert.equal(state.trusted_recovery_evidence_status,"VERIFIED");return {status:"WAITING",stage:"RUNNING"};},
    startSandboxSmoke:()=>assert.fail("fixture must never dispatch Sandbox"),action:()=>assert.fail("unexpected installer action")
  });
  const stateGate=cli.slice(cli.indexOf("function macosStateBound("),cli.indexOf("function macosGithubApi("));
  const bootstrapGate=cli.slice(cli.indexOf("function macosBootstrapMayAdvance("),cli.indexOf("function macosTrustedRecoveryEvidence("));
  const setup=cli.slice(cli.indexOf("function runSetup() {"),cli.indexOf("function codexLogin()"));
  vm.runInContext(stateGate+bootstrapGate+setup+"\nthis.resume=runSetup;",context);
  write(state.chat_route_file,{version:1,routes:[]});
  return {state,home:f.home,api,route,issue,calls,saved,settings,outbox,journal,write,deliver:deliverRoute,resume:()=>context.resume(),queue:queueRoute};
}

test("verified first-ever install creates exactly one Issue, then waits for receipt",t=>{
  const f=pendingRegistrationResume(t);delete f.state.sandbox_chat_registration_issue;f.settings.firstEver=true;
  let result=f.resume().result;
  assert.equal(result.status,"WAITING");assert.equal(result.registration_issue,f.issue.html_url);
  assert.equal(f.calls.filter(call=>call==="registration").length,1);
  assert.equal(f.calls.filter(call=>call.startsWith("issue-create")).length,1);
  assert.equal(f.state.sandbox_chat_registration_issue,f.issue.html_url);
  f.queue();f.calls.length=0;result=f.resume().result;assert.equal(result.status,"WAITING");assert.deepEqual(f.calls,[]);
  f.deliver();assert.equal(f.resume().result.action_id,"sandbox_verification");
});

test("ordinary first registration resumes zero routes through real delivery consumption before saving its route",t=>{
  const f=pendingRegistrationResume(t);
  assert.equal(f.resume().result.action_id,"sandbox_chat_registration");
  assert.equal(f.state.sandbox_review_route,undefined);
  assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.saved,[]);
  f.queue();f.calls.length=0;
  const before=JSON.stringify(f.state),savedBefore=f.saved.length;
  const waiting=f.resume().result;
  assert.equal(waiting.status,"WAITING");assert.equal(waiting.trusted_recovery_evidence.status,"NEW_INSTALL_REGISTRATION_PENDING");
  assert.equal(JSON.stringify(f.state),before);assert.equal(f.saved.length,savedBefore);assert.deepEqual(f.calls,[]);
  f.deliver();
  const result=f.resume().result;
  assert.equal(result.action_id,"sandbox_verification");
  assert.ok(f.calls.includes("registration"));assert.equal(f.calls.some(call=>call.startsWith("issue-")),false,"delivered proof avoids another Issue lookup/submission");
  assert.equal(f.state.sandbox_review_route,"chat-511");assert.equal(f.saved.at(-1).sandbox_review_route,"chat-511");
  assert.equal(f.state.trusted_recovery_evidence_status,"VERIFIED");
  assert.equal(verifyTrustedRecoveryEvidence({state:f.state,home:f.home,githubApi:f.api}).status,"VERIFIED");
  assert.equal(f.state.sandbox_verified,false);assert.equal(f.state.target_environment_ready,false);
});

for(const [name,mutate] of [
  ["missing outbox",f=>fs.rmSync(f.outbox)],
  ["missing journal",f=>fs.rmSync(f.journal)],
  ["forged terminal outbox",f=>{const value=JSON.parse(fs.readFileSync(f.outbox));value.delivery_owner="other";f.write(f.outbox,value);}],
  ["forged user role",f=>{const value=JSON.parse(fs.readFileSync(f.journal));value.verified_role="assistant";f.write(f.journal,value);}],
  ["forged delivery hash",f=>{const value=JSON.parse(fs.readFileSync(f.journal));value.callback_state_sha256="0".repeat(64);f.write(f.journal,value);}]
])test(`pending first-route CLI gate preserves the first Issue on ${name}`,t=>{
  const f=pendingRegistrationResume(t);f.queue();f.deliver();mutate(f);
  const before=JSON.stringify(f.state),routes=fs.readFileSync(f.state.chat_route_file);
  const result=f.resume().result;
  assert.equal(result.status,"WAITING");assert.equal(result.registration_issue,f.issue.html_url);
  assert.equal(result.mutations_performed,false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.saved,[]);
  assert.equal(JSON.stringify(f.state),before);assert.deepEqual(fs.readFileSync(f.state.chat_route_file),routes);
  assert.equal(fs.existsSync(path.join(f.state.instance_root,"trusted-recovery-evidence-v1.json")),false);
});

test("pending first-route CLI gate rejects offline or changed evidence before native or Runner steps",t=>{
  const f=pendingRegistrationResume(t);f.queue();f.deliver();
  f.settings.offline=true;
  assert.equal(f.resume().result.error_id,"MACOS-EXISTING-INSTANCE-REVIEW");assert.deepEqual(f.calls,[]);assert.deepEqual(f.saved,[]);
  f.settings.offline=false;f.settings.offlineAfterFirstProof=true;
  assert.equal(f.resume().result.error_id,"MACOS-TRUSTED-RECOVERY-EVIDENCE");assert.deepEqual(f.calls,["prerequisites"]);assert.deepEqual(f.saved,[]);
  assert.equal(f.state.sandbox_review_route,undefined);
});

test("first-registration proof lost after the early gate cannot create another Issue or save a route",t=>{
  const f=pendingRegistrationResume(t);f.queue();f.deliver();f.settings.removeProofBeforeConsumption=true;
  const result=f.resume().result;
  assert.equal(result.error_id,"MACOS-CHAT-REGISTRATION");assert.ok(f.calls.includes("registration"));
  assert.equal(f.calls.some(call=>call.startsWith("issue-")),false);
  assert.equal(f.state.sandbox_chat_registration_issue,f.issue.html_url);assert.equal(f.state.sandbox_review_route,undefined);
  assert.equal(f.saved.some(state=>state.sandbox_review_route!==undefined),false);
  assert.equal(fs.existsSync(path.join(f.state.instance_root,"trusted-recovery-evidence-v1.json")),false);
});

test("interleaved second read pinned Issue cannot be recreated",t=>{
  const f=pendingRegistrationResume(t);f.settings.issueListEmpty=true;
  const result=f.resume().result;
  assert.equal(result.status,"WAITING");
  assert.equal(result.action_id,"sandbox_chat_registration");
  assert.deepEqual(f.calls,[]);
  assert.equal(f.calls.filter(call=>call.startsWith("issue-create")).length,0);
  assert.equal(f.state.sandbox_chat_registration_issue,f.issue.html_url);
  assert.equal(f.state.sandbox_review_route,undefined);
  assert.deepEqual(f.saved,[]);
  assert.equal(fs.existsSync(path.join(f.state.instance_root,"trusted-recovery-evidence-v1.json")),false);
});

test("saved first Issue with zero routes and an empty Issue list fails closed",t=>{
  const f=pendingRegistrationResume(t);f.settings.issueListEmpty=true;
  const result=f.resume().result;
  assert.ok(result.status==="WAITING"||result.status==="ERROR");
  assert.equal(f.calls.filter(call=>call.startsWith("issue-create")).length,0);
  assert.equal(f.state.sandbox_chat_registration_issue,f.issue.html_url);
  assert.equal(f.state.sandbox_review_route,undefined);
  assert.equal(f.saved.some(state=>state.sandbox_review_route!==undefined),false);
});

for(const value of ["not-a-url","https://github.com/other/control/issues/511"])
test(`saved non-canonical Issue ${value} fails closed`,t=>{
  const f=pendingRegistrationResume(t);f.state.sandbox_chat_registration_issue=value;
  const before=JSON.stringify(f.state),result=f.resume().result;
  assert.equal(result.error_id,"MACOS-TRUSTED-RECOVERY-EVIDENCE");assert.equal(JSON.stringify(f.state),before);assert.deepEqual(f.calls,[]);assert.deepEqual(f.saved,[]);
});


test("personal account policy requires a separate exact installer selection",t=>{
  const f=fixture(t);delete f.state.macos_service_policy;
  const result=f.advance();assert.equal(result.action_id,"macos_personal_use_service_policy");
  assert.match(result.approval_challenge,/no same-account attacker resistance/);
  assert.equal(f.calls.includes("install"),false);
});

test("profile selection answer requires the prepared Control and verified originating Chat binding",()=>{
  const state={macos_setup_approved:true,current_step:"macos_personal_use_service_policy",installation_id:"abcd1234-test",github_login:"owner",control_repository:"owner/chatgpt-codex-orchestrator-control-abcd1234",control_repository_id:"101",sandbox_repository:"owner/chatgpt-codex-orchestrator-sandbox-abcd1234",sandbox_repository_id:"202",reviewer_chat_url:"https://chatgpt.com/c/approved",control_environment_ready:true,target_environment_ready:false,github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:"abcd1234-test",github_plugin_authorization_control_repository:"owner/chatgpt-codex-orchestrator-control-abcd1234",github_plugin_authorization_sandbox_repository:"owner/chatgpt-codex-orchestrator-sandbox-abcd1234",github_plugin_authorization_chat_url:"https://chatgpt.com/c/approved"};
  const input={"--action":"macos_personal_use_service_policy","--value":trustedSingleUserReadinessProfileChallenge(state)},emissions=[];let saves=0,verifications=0;
  const start=cli.indexOf("function answer() {"),end=cli.indexOf("function runSetup() {",start);
  const context=vm.createContext({process:{platform:"darwin"},loadState:()=>state,ensureStateLanguage:()=>"en",valueOf:key=>input[key]||"",t:()=>"saved",hasTrustedSingleUserReadinessIdentity,trustedSingleUserReadinessProfileChallenge,MACOS_PERSONAL_USE_POLICY,TRUSTED_SINGLE_USER_READINESS_PROFILE,macosRecoveryReport:()=>({status:"ABSENT"}),macosBootstrapMayAdvance:()=>false,macosTrustedRecoveryEvidence:()=>{throw Error("unexpected recovery evidence");},verifyMacosGeneratedRepositories:({state})=>{verifications++;if(state.control_repository_id!=="101")throw Error("stale Control ID");return {control_repository_id:"101",sandbox_repository_id:"202"};},saveState:()=>{saves++;},emit:(payload,exitCode=0)=>emissions.push({payload,exitCode})});
  vm.runInContext(cli.slice(start,end)+"\nthis.answer=answer;",context);
  for(const change of [{current_step:"other"},{control_environment_ready:false},{target_environment_ready:true},{github_plugin_authorization_installation_id:"stale"},{control_repository_id:""},{control_repository_id:"999"}]){
    Object.assign(state,{current_step:"macos_personal_use_service_policy",control_environment_ready:true,target_environment_ready:false,github_plugin_authorization_installation_id:state.installation_id,control_repository_id:"101"},change);input["--value"]=trustedSingleUserReadinessProfileChallenge(state);context.answer();assert.equal(emissions.at(-1).payload.error_id,"MACOS-PERSONAL-USE-POLICY-APPROVAL");assert.equal(saves,0);
  }
  Object.assign(state,{current_step:"macos_personal_use_service_policy",control_environment_ready:true,target_environment_ready:false,github_plugin_authorization_installation_id:state.installation_id,control_repository_id:"101"});input["--value"]=trustedSingleUserReadinessProfileChallenge(state);context.answer();assert.equal(emissions.at(-1).payload.status,"PASS");assert.equal(saves,1);assert.equal(verifications,2);assert.equal(state.macos_service_policy.readiness_profile,TRUSTED_SINGLE_USER_READINESS_PROFILE);
});

test("profile selection preserves an unresolved Runner intent even when recovery inspection is absent",()=>{
  const state={macos_setup_approved:true,current_step:"macos_personal_use_service_policy",installation_id:"abcd1234-test",github_login:"owner",control_repository:"owner/control",control_repository_id:"101",sandbox_repository:"owner/sandbox",sandbox_repository_id:"202",reviewer_chat_url:"https://chatgpt.com/c/approved",control_environment_ready:true,target_environment_ready:false,github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:"abcd1234-test",github_plugin_authorization_control_repository:"owner/control",github_plugin_authorization_sandbox_repository:"owner/sandbox",github_plugin_authorization_chat_url:"https://chatgpt.com/c/approved",macos_runner_bootstrap:{phase:"START_INTENT",bytes:"preserve"}};
  const original=JSON.stringify(state.macos_runner_bootstrap),input={"--action":"macos_personal_use_service_policy","--value":trustedSingleUserReadinessProfileChallenge(state)},emissions=[];let saves=0;
  const start=cli.indexOf("function answer() {"),end=cli.indexOf("function runSetup() {",start);
  const context=vm.createContext({process:{platform:"darwin"},loadState:()=>state,ensureStateLanguage:()=>"en",valueOf:key=>input[key]||"",hasTrustedSingleUserReadinessIdentity,trustedSingleUserReadinessProfileChallenge,macosRecoveryReport:()=>({status:"ABSENT"}),saveState:()=>{saves++;},emit:(payload,exitCode=0)=>emissions.push({payload,exitCode})});
  vm.runInContext(cli.slice(start,end)+"\nthis.answer=answer;",context);
  context.answer();assert.equal(emissions.at(-1).payload.error_id,"MACOS-PERSONAL-USE-POLICY-APPROVAL");assert.equal(saves,0);assert.equal(JSON.stringify(state.macos_runner_bootstrap),original);assert.equal(state.macos_service_policy,undefined);
});

test("profile answer rejects originating-chat and sandbox identity drift",()=>{
  const base={macos_setup_approved:true,current_step:"macos_personal_use_service_policy",installation_id:"abcd1234-test",github_login:"owner",control_repository:"owner/control",control_repository_id:"101",sandbox_repository:"owner/sandbox",sandbox_repository_id:"202",reviewer_chat_url:"https://chatgpt.com/c/approved",control_environment_ready:true,target_environment_ready:false,github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:"abcd1234-test",github_plugin_authorization_control_repository:"owner/control",github_plugin_authorization_sandbox_repository:"owner/sandbox",github_plugin_authorization_chat_url:"https://chatgpt.com/c/approved"};
  const source=cli.slice(cli.indexOf("function answer() {"),cli.indexOf("function runSetup() {"));
  for(const [name,change] of [["chat",{reviewer_chat_url:"https://chatgpt.com/c/stale"}],["sandbox ID",{sandbox_repository_id:"999"}],["sandbox name",{sandbox_repository:"owner/stale"}]]){
    const state={...base,...change},emissions=[];let saves=0;
    const context=vm.createContext({process:{platform:"darwin"},loadState:()=>state,ensureStateLanguage:()=>"en",valueOf:key=>key==="--action"?"macos_personal_use_service_policy":key==="--value"?trustedSingleUserReadinessProfileChallenge(state):"",hasTrustedSingleUserReadinessIdentity,trustedSingleUserReadinessProfileChallenge,MACOS_PERSONAL_USE_POLICY,TRUSTED_SINGLE_USER_READINESS_PROFILE,macosRecoveryReport:()=>({status:"ABSENT"}),macosBootstrapMayAdvance:()=>false,macosTrustedRecoveryEvidence:()=>({status:"ABSENT"}),verifyMacosGeneratedRepositories:({state:actual})=>{assert.equal(actual.sandbox_repository_id,"202","pinned GitHub identity");assert.equal(actual.sandbox_repository,"owner/sandbox","pinned GitHub repository");return {control_repository_id:"101",sandbox_repository_id:"202"};},saveState:()=>{saves++;},emit:(payload,code=0)=>emissions.push({payload,code})});
    vm.runInContext(source+"\nthis.answer=answer;",context);context.answer();
    assert.equal(emissions.at(-1).payload.error_id,"MACOS-PERSONAL-USE-POLICY-APPROVAL",name);assert.equal(saves,0,name);assert.equal(state.macos_service_policy,undefined,name);assert.equal(state.macos_runner_bootstrap,undefined,name);
  }
});

test("profile answer rejects conflicting legacy recovery",()=>{
  const state={macos_setup_approved:true,current_step:"macos_personal_use_service_policy",installation_id:"abcd1234-test",github_login:"owner",control_repository:"owner/control",control_repository_id:"101",sandbox_repository:"owner/sandbox",sandbox_repository_id:"202",reviewer_chat_url:"https://chatgpt.com/c/approved",control_environment_ready:true,target_environment_ready:false,github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:"abcd1234-test",github_plugin_authorization_control_repository:"owner/control",github_plugin_authorization_sandbox_repository:"owner/sandbox",github_plugin_authorization_chat_url:"https://chatgpt.com/c/approved"};
  const source=cli.slice(cli.indexOf("function answer() {"),cli.indexOf("function runSetup() {"));
  for(const status of ["CONFLICT","NEEDS_HUMAN_LEGACY"]){
    const emissions=[];let saves=0;const context=vm.createContext({process:{platform:"darwin"},loadState:()=>state,ensureStateLanguage:()=>"en",valueOf:key=>key==="--action"?"macos_personal_use_service_policy":key==="--value"?trustedSingleUserReadinessProfileChallenge(state):"",hasTrustedSingleUserReadinessIdentity,trustedSingleUserReadinessProfileChallenge,MACOS_PERSONAL_USE_POLICY,TRUSTED_SINGLE_USER_READINESS_PROFILE,macosRecoveryReport:()=>({status}),macosBootstrapMayAdvance:()=>false,macosTrustedRecoveryEvidence:()=>({status}),verifyMacosGeneratedRepositories:()=>assert.fail("recovery must reject first"),saveState:()=>{saves++;},emit:(payload,code=0)=>emissions.push({payload,code})});
    vm.runInContext(source+"\nthis.answer=answer;",context);context.answer();assert.equal(emissions.at(-1).payload.error_id,"MACOS-PERSONAL-USE-POLICY-APPROVAL");assert.equal(saves,0);assert.equal(state.macos_service_policy,undefined);
  }
});

test("new profile setup with missing native helper reaches explicit selection without runner mutation",()=>{
  const state={macos_setup_approved:true,installation_id:"new-install",github_login:"owner",target_repository:"owner/target",reviewer_chat_url:"https://chatgpt.com/c/approved",github_plugin_authorized:true,control_repository:"owner/control",control_repository_id:"101",sandbox_repository:"owner/sandbox",sandbox_repository_id:"202",github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:"new-install",github_plugin_authorization_control_repository:"owner/control",github_plugin_authorization_sandbox_repository:"owner/sandbox",github_plugin_authorization_chat_url:"https://chatgpt.com/c/approved",codex_trust_sandbox:true,reviewer_browser_ready:true};
  const calls=[],emissions=[],saves=[];
  const setup=cli.slice(cli.indexOf("function runSetup() {"),cli.indexOf("function codexLogin()"));
  const context=vm.createContext({crypto:{randomUUID:()=>"unexpected"},process:{platform:"darwin",cwd:()=>"/synthetic"},os:{homedir:()=>"/synthetic-home"},loadState:()=>state,ensureStateLanguage:()=>"en",hasTrustedSingleUserReadinessProfileMarker:()=>false,hasTrustedSingleUserReadinessProfile:()=>false,hasMacosPersonalUsePolicy:()=>false,isMacosFreshFirstInstallBootstrap:()=>false,macosRecoveryReport:()=>({status:"ABSENT"}),macosTrustedRecoveryEvidence:()=>({status:"ABSENT"}),macosFreshBootstrapMayAdvance:()=>false,macosBootstrapMayAdvance:()=>false,macosStateBound:()=>false,findRegisteredChatRoute:()=>null,normalizeChatUrl:x=>x,macosPrerequisites:()=>{calls.push("prerequisites/preflight");return {node:true,git:true,gh:true,codex:true,session_auth:true,github_auth:true,native_helper:{status:"MISSING"},legacy_native_helper_gate:"DEFERRED_PENDING_PROFILE_SELECTION"};},migrationPreflight:()=>({status:"READY"}),authenticatedGithubLogin:()=>"owner",prepareMigrationIntent:()=>{calls.push("migration intent");return {path:"/synthetic/intent",phase:"PREPARED"};},saveState:actual=>saves.push(JSON.parse(JSON.stringify(actual))),prepareControlEnvironment:()=>{calls.push("Control/Sandbox preparation");return {control_repository:"owner/control",control_repository_id:"101",sandbox_repository:"owner/sandbox",sandbox_repository_id:"202"};},verifyMacosGeneratedRepositories:()=>{calls.push("independent repo identities");return {control_repository_id:"101",sandbox_repository_id:"202"};},advanceMacosFirstBootRunner:()=>({status:"NEEDS_USER_ACTION",action_id:"macos_personal_use_service_policy",approval_challenge:"I understand trusted-single-user-v1"}),prepareMacosNativeHelper:()=>{calls.push("native helper");return {status:"PASS"};},ensureInstallerChatRegistration:()=>{calls.push("registration");return {status:"READY"};},sandboxSmokeStatus:()=>({status:"WAITING"}),startSandboxSmoke:()=>assert.fail("no Sandbox activation"),action:(actual,id)=>({status:"NEEDS_USER_ACTION",action_id:id}),emit:(result,code=0)=>emissions.push({result,code})});
  vm.runInContext(setup+"\nthis.runSetup=runSetup;",context);context.runSetup();
  assert.deepEqual(calls,["prerequisites/preflight","migration intent","Control/Sandbox preparation","independent repo identities"]);const result=emissions.at(-1).result;assert.equal(result.status,"NEEDS_USER_ACTION");assert.equal(result.action_id,"macos_personal_use_service_policy");assert.match(result.approval_challenge,/trusted-single-user-v1/);assert.equal(calls.some(call=>/native|runner|registration/.test(call)),false);assert.equal(saves.length>0,true);
  const selected={...state,macos_service_policy:{schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,readiness_profile:TRUSTED_SINGLE_USER_READINESS_PROFILE,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:state.control_repository_id,approval:trustedSingleUserReadinessProfileChallenge(state),approved_at:"2026-10-22T00:00:00Z"}};
  const prerequisites=macosPrerequisites({state:selected,commandRunner:name=>({ok:true,output:name==="node"?"v22.0.0":"synthetic"}),nativeHelperPreflight:()=>({status:"MISSING"})});assert.equal(prerequisites.legacy_native_helper_gate,"NOT_APPLICABLE_SUPERSEDED");assert.equal(prerequisites.runner_lineage.status,"ACTION_APPROVAL_REQUIRED");
});

test("legacy helper failure stops CLI before migration intent or Control preparation",()=>{
  const state={macos_setup_approved:true,installation_id:"legacy",github_login:"owner",control_repository:"owner/control",control_repository_id:"101",sandbox_repository:"owner/sandbox",sandbox_repository_id:"202",target_repository:"owner/target",reviewer_chat_url:"https://chatgpt.com/c/origin",github_plugin_authorized:true,github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:"legacy",github_plugin_authorization_control_repository:"owner/control",github_plugin_authorization_sandbox_repository:"owner/sandbox",github_plugin_authorization_chat_url:"https://chatgpt.com/c/origin"},calls=[],emissions=[];
  state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:state.control_repository_id,approval:macosPersonalUsePolicyChallenge(state),approved_at:"2026-10-22T00:00:00Z"};
  const policy=JSON.stringify(state.macos_service_policy),commandRunner=name=>{calls.push("command "+name);return {ok:true,output:name==="node"?"v22.0.0":"synthetic"};};
  assert.equal(hasMacosPersonalUsePolicy(state),true);assert.equal(hasTrustedSingleUserReadinessProfile(state),false);assert.equal(Object.hasOwn(state.macos_service_policy,"readiness_profile"),false);
  const setup=cli.slice(cli.indexOf("function runSetup() {"),cli.indexOf("function codexLogin()"));
  const context=vm.createContext({process:{platform:"darwin",cwd:()=>"/synthetic"},os:{homedir:()=>"/synthetic-home"},loadState:()=>state,ensureStateLanguage:()=>"en",hasMacosPersonalUsePolicy,hasTrustedSingleUserReadinessProfileMarker:()=>false,hasTrustedSingleUserReadinessProfile,isMacosFreshFirstInstallBootstrap:()=>false,macosRecoveryReport:()=>({status:"ABSENT"}),macosTrustedRecoveryEvidence:()=>({status:"ABSENT"}),macosFreshBootstrapMayAdvance:()=>false,macosBootstrapMayAdvance:()=>false,macosStateBound:()=>false,findRegisteredChatRoute:()=>null,macosPrerequisites:options=>macosPrerequisites({...options,commandRunner,nativeHelperPreflight:()=>({status:"MISSING"})}),migrationPreflight:()=>{calls.push("migration preflight");return {status:"READY"};},prepareMigrationIntent:()=>assert.fail("missing helper stops before migration intent"),prepareControlEnvironment:()=>assert.fail("missing helper stops before Control preparation"),prepareMacosNativeHelper:()=>assert.fail("missing helper stops before native preparation"),advanceMacosFirstBootRunner:()=>assert.fail("legacy policy must not request profile selection"),ensureInstallerChatRegistration:()=>assert.fail("missing helper stops before registration"),saveState:()=>assert.fail("missing helper must not save state"),emit:(result,code=0)=>emissions.push({result,code})});
  vm.runInContext(setup+"\nthis.runSetup=runSetup;",context);context.runSetup();assert.equal(emissions.at(-1).result.error_id,"MACOS-PREREQUISITE-OR-MIGRATION");assert.deepEqual(calls,["command node","command git","command gh","command codex","command codex","command gh","migration preflight"]);assert.equal(JSON.stringify(state.macos_service_policy),policy);
});

test("legacy valid policy with helper PASS enters native preparation",()=>{
  const state={macos_setup_approved:true,installation_id:"legacy",github_login:"owner",control_repository:"owner/control",control_repository_id:"101",sandbox_repository:"owner/sandbox",sandbox_repository_id:"202",target_repository:"owner/target",reviewer_chat_url:"https://chatgpt.com/c/origin",github_plugin_authorized:true,github_plugin_authorization_verified:true,github_plugin_authorization_installation_id:"legacy",github_plugin_authorization_control_repository:"owner/control",github_plugin_authorization_sandbox_repository:"owner/sandbox",github_plugin_authorization_chat_url:"https://chatgpt.com/c/origin",control_environment_ready:true,codex_trust_sandbox:true,reviewer_browser_ready:true},calls=[],emissions=[],saves=[];
  state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:state.control_repository_id,approval:macosPersonalUsePolicyChallenge(state),approved_at:"2026-10-22T00:00:00Z"};
  const policy=JSON.stringify(state.macos_service_policy),commandRunner=name=>{calls.push("command "+name);return {ok:true,output:name==="node"?"v22.0.0":"synthetic"};};
  assert.equal(hasMacosPersonalUsePolicy(state),true);assert.equal(hasTrustedSingleUserReadinessProfile(state),false);assert.equal(Object.hasOwn(state.macos_service_policy,"readiness_profile"),false);
  const setup=cli.slice(cli.indexOf("function runSetup() {"),cli.indexOf("function codexLogin()"));
  const context=vm.createContext({process:{platform:"darwin",cwd:()=>"/synthetic"},os:{homedir:()=>"/synthetic-home"},loadState:()=>state,ensureStateLanguage:()=>"en",hasMacosPersonalUsePolicy,hasTrustedSingleUserReadinessProfileMarker:()=>false,hasTrustedSingleUserReadinessProfile,isMacosFreshFirstInstallBootstrap:()=>false,macosRecoveryReport:()=>({status:"ABSENT"}),macosTrustedRecoveryEvidence:()=>({status:"ABSENT"}),macosFreshBootstrapMayAdvance:()=>false,macosBootstrapMayAdvance:()=>false,macosStateBound:()=>false,findRegisteredChatRoute:()=>null,macosPrerequisites:options=>macosPrerequisites({...options,commandRunner,nativeHelperPreflight:()=>({status:"PASS"})}),migrationPreflight:()=>{calls.push("migration preflight");return {status:"READY"};},authenticatedGithubLogin:()=>"owner",prepareMigrationIntent:()=>{calls.push("migration intent");return {path:"/synthetic/intent",phase:"PREPARED"};},saveState:actual=>saves.push(JSON.parse(JSON.stringify(actual))),verifyMacosGeneratedRepositories:()=>{calls.push("repository identities");return {control_repository_id:"101",sandbox_repository_id:"202"};},prepareMacosNativeHelper:options=>{calls.push("native helper");assert.equal(options.state.installation_id,"legacy");assert.equal(options.approved,true);assert.equal(options.home,"/synthetic-home");return {status:"NEEDS_USER_ACTION",error_id:"SYNTHETIC-NATIVE-STOP",mutations_performed:false};},prepareControlEnvironment:()=>assert.fail("legacy Control must be reused"),advanceMacosFirstBootRunner:()=>assert.fail("legacy policy must not request profile selection"),ensureInstallerChatRegistration:()=>assert.fail("native stop precedes registration"),startSandboxSmoke:()=>assert.fail("native stop precedes target activation"),emit:(result,code=0)=>emissions.push({result,code})});
  vm.runInContext(setup+"\nthis.runSetup=runSetup;",context);context.runSetup();assert.equal(emissions.at(-1).result.error_id,"SYNTHETIC-NATIVE-STOP");assert.deepEqual(calls,["command node","command git","command gh","command codex","command codex","command gh","migration preflight","migration intent","repository identities","native helper"]);assert.equal(saves.length>0,true);assert.equal(JSON.stringify(state.macos_service_policy),policy);assert.equal(state.target_environment_ready,undefined);
});

test("invalid readiness markers stop setup before legacy native preparation",t=>{
  const f=pendingRegistrationResume(t);f.state.macos_service_policy.readiness_profile="unknown-profile";
  const result=f.resume().result;
  assert.equal(result.error_id,"MACOS-READINESS-PROFILE-INVALID");assert.deepEqual(f.calls,[]);assert.deepEqual(f.saved,[]);
});

test("preflight rejection creates no operation intent or start claim",t=>{
  const f=fixture(t);f.state.macos_runner_action_approval=f.challenge("install");f.advance();
  f.state.macos_runner_action_approval=f.challenge("start");f.settings.rejectPreflight=true;
  assert.equal(f.advance().error_id,"PROVEN-PRE-MUTATION");
  assert.equal(f.state.macos_runner_bootstrap.phase,"PLIST_INSTALLED");
  assert.equal(f.state.macos_runner_action_approval,f.challenge("start"));
  assert.equal(f.calls.includes("start"),false);
});

test("a proven final rejection retains the original journal and needs a distinct new approval",t=>{
  const f=fixture(t);f.state.macos_runner_action_approval=f.challenge("install");f.advance();
  f.state.macos_runner_action_approval=f.challenge("start");f.settings.rejectFinal=true;
  assert.equal(f.advance().recovery_status,"NEW_EXACT_APPROVAL_REQUIRED_OR_INSPECT");
  const original=JSON.stringify(f.state.macos_runner_bootstrap.original_rejection_journal);
  assert.equal(f.state.macos_runner_bootstrap.phase,"REJECTED");
  const retry=f.advance();assert.equal(retry.action_id,"macos_runner_start");assert.notEqual(retry.approval_challenge,f.challenge("start"));
  f.state.macos_runner_action_approval=retry.approval_challenge;f.settings.rejectFinal=false;f.settings.online=true;
  assert.equal(f.advance().status,"READY");
  assert.equal(JSON.stringify(f.state.macos_runner_bootstrap.original_rejection_journal),original);
});

test("a loaded idle job and a native identity mismatch cannot publish registration",t=>{
  const f=fixture(t);f.state.macos_runner_action_approval=f.challenge("install");f.advance();
  f.state.macos_runner_action_approval=f.challenge("start");f.settings.idle=true;f.settings.online=true;
  assert.equal(f.advance().action_id,"macos_runner_local_listener");
  f.settings.idle=false;f.runner.local_listener_identity={pid:303,start_sec:999,start_usec:456};
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-NATIVE-IDENTITY");
});

test("crashed start intent is never retried or reconciled from a missing PID",t=>{
  const f=fixture(t);f.state.macos_runner_bootstrap={phase:"START_INTENT",install_challenge:f.challenge("install"),start_challenge:f.challenge("start")};
  f.settings.online=true;assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-INTERRUPTED");
  assert.equal(f.calls.includes("start"),false);
});

test("distinct claims after proven rejections preserve all original claim bytes",t=>{
  const f=fixture(t);fs.mkdirSync(f.state.instance_root,{recursive:true,mode:0o700});
  const original=f.claim("start"),bytes=fs.readFileSync(original.path),next=f.claim("start",2);
  assert.equal(next.status,"OWNED");assert.notEqual(next.path,original.path);assert.deepEqual(fs.readFileSync(original.path),bytes);
  assert.equal(f.claim("start",2).error_id,"MACOS-FIRST-BOOT-ALREADY-CLAIMED");
});

test("trusted legacy reconciliation requires a real immutable retained claim",t=>{
  const f=fixture(t);fs.mkdirSync(f.state.instance_root,{recursive:true,mode:0o700});const claim=f.claim("install"),challenge=f.challenge("install");
  f.state.macos_runner_bootstrap={phase:"ERROR",operation:"install",attempt:1,claim_path:claim.path,action_challenge:challenge,install_challenge:challenge,start_challenge:f.challenge("start"),runner_id:f.runner.runner_id,result:{status:"ERROR",action:"install",pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false}};
  assert.equal(f.advance().action_id,"macos_runner_install");assert.equal(f.state.macos_runner_bootstrap.phase,"REJECTED");
  f.state.macos_runner_bootstrap={...f.state.macos_runner_bootstrap,phase:"ERROR",result:{status:"ERROR",action:"install",pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false}};fs.chmodSync(claim.path,0o644);
  assert.equal(f.advance().error_id,"MACOS-FIRST-BOOT-JOURNAL");assert.equal(f.state.macos_runner_bootstrap.phase,"ERROR");
});

test("trusted mixed install start retry binds actual preclaim and postclaim",t=>{
  const f=fixture(t),previousHome=process.env.HOME,runnerPath=path.join(f.state.instance_root,"runner"),service=path.join(runnerPath,"bin","runsvc.sh"),node=path.join(runnerPath,"externals","node20","bin","node"),script=path.join(runnerPath,"bin","RunnerService.js"),listener=path.join(runnerPath,"bin","Runner.Listener");process.env.HOME=f.home;t.after(()=>{if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;});
  fs.mkdirSync(f.state.instance_root,{recursive:true,mode:0o700});for(const file of [service,node,script,listener]){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,"synthetic\n",{mode:0o700});}const config=Buffer.from(JSON.stringify({agentId:303,agentName:f.state.runner_label,gitHubUrl:`https://github.com/${f.state.control_repository}`,serverUrl:"https://pipelines.actions.githubusercontent.com/example",workFolder:"_work"})),configPath=path.join(runnerPath,".runner");fs.writeFileSync(configPath,config,{mode:0o600});const configStat=fs.lstatSync(configPath),configIdentity=Object.fromEntries(["dev","ino","uid","gid","mode","nlink","size","mtimeMs","ctimeMs"].map(key=>[key,configStat[key]]));
  Object.assign(f.state,{runner_path:runnerPath,launch_agent_label:"com.chatgpt.codex.firstboot",macos_setup_approved:true});f.state.macos_service_policy.readiness_profile=TRUSTED_SINGLE_USER_READINESS_PROFILE;f.state.macos_service_policy.approval=trustedSingleUserReadinessProfileChallenge(f.state);
  let loaded=false,started=false,rejectInstall=false,rejectInstallNext=true,rejectStart=false,rejectStartNext=true;const effects=[];
  const listenerIdentity={pid:125,observed_start:"Mon Jan  1 00:00:00 2024"},runner={...f.runner,runner_executable:listener,service_executable:service,service_arguments:[],service_node:node,service_node_version:"node20",service_script:script,config_sha256:crypto.createHash("sha256").update(config).digest("hex"),config_identity:configIdentity,local_process_observation:"trusted-single-user-ps-v1",get local_listener_pid(){return started?125:null;},get local_listener_identity(){return started?listenerIdentity:null;},get local_service_pids(){return started?[123,124]:[];}};
  const plist=path.join(f.home,"Library","LaunchAgents",`${f.state.launch_agent_label}.plist`),job=`gui/${process.getuid?.()||0}/${f.state.launch_agent_label}`,print=()=>`${job} = {\n    path = ${plist}\n    type = LaunchAgent\n    state = running\n    program = ${service}\n    arguments = {\n      ${service}\n    }\n    working directory = ${runnerPath}\n    environment = {\n      PATH => /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n      ACTIONS_RUNNER_SVC => 1\n      XPC_SERVICE_NAME => ${f.state.launch_agent_label}\n    }\n    domain = gui/${process.getuid?.()||0} [100003]\n    pid = 123\n    properties = inferred program | runatload\n  }`;
  const table=`${process.getuid?.()||0} 123 1 /bin/bash ${service}\n${process.getuid?.()||0} 124 123 ${node} ${script}\n${process.getuid?.()||0} 125 124 ${listener} run --startuptype service`;
  const commandRunner=(command,args)=>{if(command==="/bin/ps")return args.includes("lstart=")?{ok:true,output:"Mon Jan  1 00:00:00 2024"}:{ok:true,output:table};if(command!=="launchctl")return {ok:false,output:"unexpected"};if(args[0]==="list"){if(rejectInstall||rejectStart)return {ok:false,output:"proven no-effect rejection"};return {ok:true,output:loaded?`${started?123:"-"} 0 ${f.state.launch_agent_label}`:""};}if(args[0]==="print")return {ok:loaded,output:loaded?print():`Could not find service \"${f.state.launch_agent_label}\" in domain for user gui:${process.getuid?.()||0}`};if(args[0]==="bootstrap"){effects.push("bootstrap");loaded=true;started=true;return {ok:true,output:""};}return {ok:false,output:"unexpected"};};
  const runtime=(action,options)=>{if(action==="install"&&!options.preflightOnly&&rejectInstallNext){rejectInstall=true;rejectInstallNext=false;}if(action==="start"&&!options.preflightOnly&&rejectStartNext){rejectStart=true;rejectStartNext=false;}const result=macosRuntimeAction(action,{...options,platform:"darwin",arch:"arm64",commandRunner,runnerInspector:()=>runner,capabilityVerifier:()=>{throw Error("native helper must not run");}});rejectInstall=false;rejectStart=false;return result;};
  const advance=()=>f.context.advance(f.state,{home:f.home,inspect:()=>runner,runtime,persist:state=>f.snapshots.push(JSON.parse(JSON.stringify(state)))});
  let prompt=advance();assert.equal(prompt.action_id,"macos_runner_install");f.state.macos_runner_action_approval=prompt.approval_challenge;let result=advance();assert.equal(result.recovery_status,"NEW_EXACT_APPROVAL_REQUIRED_OR_INSPECT",JSON.stringify(result));assert.equal(f.state.macos_runner_bootstrap.phase,"REJECTED");assert.equal(f.state.macos_runner_bootstrap.rejections[0].result.service_action_state,"NOT_ATTEMPTED");assert.equal(effects.length,0);assert.equal(f.state.macos_runner_action_approval,undefined);
  prompt=advance();assert.equal(prompt.action_id,"macos_runner_install");f.state.macos_runner_action_approval=prompt.approval_challenge;result=advance();assert.equal(result.action_id,"macos_runner_start",JSON.stringify([result,f.state.macos_runner_bootstrap]));assert.equal(f.state.macos_runner_bootstrap.phase,"PLIST_INSTALLED");assert.equal(fs.existsSync(path.join(f.state.instance_root,"macos-runner-install-attempt-2-claim.json")),true);assert.equal(f.state.macos_runner_action_approval,undefined);
  prompt=advance();assert.equal(prompt.action_id,"macos_runner_start");f.state.macos_runner_action_approval=prompt.approval_challenge;f.state.macos_runner_activation={installation_id:f.state.installation_id,runner_id:runner.runner_id,approval_sha256:runner.approval_sha256,challenge:prompt.approval_challenge,login_restart_approved:true,approved_at:"2026-10-22T00:00:00Z"};result=advance();assert.equal(result.recovery_status,"NEW_EXACT_APPROVAL_REQUIRED_OR_INSPECT",JSON.stringify([result,f.state.macos_runner_bootstrap]));assert.equal(f.state.macos_runner_bootstrap.phase,"REJECTED");assert.equal(fs.existsSync(path.join(f.state.instance_root,"macos-runner-start-claim.json")),true);assert.equal(effects.length,0);
  prompt=advance();assert.equal(prompt.action_id,"macos_runner_start");f.state.macos_runner_action_approval=prompt.approval_challenge;f.state.macos_runner_activation={installation_id:f.state.installation_id,runner_id:runner.runner_id,approval_sha256:runner.approval_sha256,challenge:prompt.approval_challenge,login_restart_approved:true,approved_at:"2026-10-22T00:00:00Z"};result=advance();assert.equal(result.status,"READY",JSON.stringify(result));assert.equal(f.state.macos_runner_bootstrap.phase,"STARTED");assert.equal(fs.existsSync(path.join(f.state.instance_root,"macos-runner-start-attempt-2-claim.json")),true);assert.deepEqual(effects,["bootstrap"]);assert.deepEqual(macosRuntimeAction("status",{state:f.state,home:f.home,platform:"darwin",arch:"arm64",commandRunner,runnerInspector:()=>runner}).listener_identity,listenerIdentity);
});

test("trusted complete mixed install start retry uses real preclaim and postclaim",t=>{
  const f=fixture(t),previousHome=process.env.HOME,runnerPath=path.join(f.state.instance_root,"runner"),service=path.join(runnerPath,"bin","runsvc.sh"),node=path.join(runnerPath,"externals","node20","bin","node"),script=path.join(runnerPath,"bin","RunnerService.js"),listener=path.join(runnerPath,"bin","Runner.Listener");process.env.HOME=f.home;t.after(()=>{if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;});
  fs.mkdirSync(f.state.instance_root,{recursive:true,mode:0o700});for(const file of [service,node,script,listener]){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,"synthetic\n",{mode:0o700});}const config=Buffer.from(JSON.stringify({agentId:303,agentName:f.state.runner_label,gitHubUrl:`https://github.com/${f.state.control_repository}`,serverUrl:"https://pipelines.actions.githubusercontent.com/example",workFolder:"_work"})),configPath=path.join(runnerPath,".runner");fs.writeFileSync(configPath,config,{mode:0o600});const configStat=fs.lstatSync(configPath),config_identity=Object.fromEntries(["dev","ino","uid","gid","mode","nlink","size","mtimeMs","ctimeMs"].map(key=>[key,configStat[key]]));
  Object.assign(f.state,{runner_path:runnerPath,launch_agent_label:"com.chatgpt.codex.complete-firstboot",macos_setup_approved:true});f.state.macos_service_policy.readiness_profile=TRUSTED_SINGLE_USER_READINESS_PROFILE;f.state.macos_service_policy.approval=trustedSingleUserReadinessProfileChallenge(f.state);
  let loaded=false,started=false,reject=null,rejectNext="install";const effects=[],listenerIdentity={pid:125,observed_start:"Mon Jan  1 00:00:00 2024"},runner={...f.runner,runner_executable:listener,service_executable:service,service_arguments:[],service_node:node,service_node_version:"node20",service_script:script,config_sha256:crypto.createHash("sha256").update(config).digest("hex"),config_identity,local_process_observation:"trusted-single-user-ps-v1",get local_listener_pid(){return started?125:null;},get local_listener_identity(){return started?listenerIdentity:null;},get local_service_pids(){return started?[123,124]:[];}};
  const plist=path.join(f.home,"Library","LaunchAgents",`${f.state.launch_agent_label}.plist`),job=`gui/${process.getuid?.()||0}/${f.state.launch_agent_label}`,print=()=>`${job} = {\n path = ${plist}\n type = LaunchAgent\n state = running\n program = ${service}\n arguments = {\n ${service}\n }\n working directory = ${runnerPath}\n environment = {\n PATH => /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n ACTIONS_RUNNER_SVC => 1\n XPC_SERVICE_NAME => ${f.state.launch_agent_label}\n }\n domain = gui/${process.getuid?.()||0} [100003]\n pid = 123\n properties = inferred program | runatload\n }`,table=`${process.getuid?.()||0} 123 1 /bin/bash ${service}\n${process.getuid?.()||0} 124 123 ${node} ${script}\n${process.getuid?.()||0} 125 124 ${listener} run --startuptype service`;
  const commandRunner=(command,args)=>{if(command==="/bin/ps")return args.includes("lstart=")?{ok:true,output:"Mon Jan  1 00:00:00 2024"}:{ok:true,output:table};if(command!=="launchctl")return {ok:false,output:"unexpected"};if(args[0]==="list")return reject?{ok:false,output:"proven no-effect rejection"}:{ok:true,output:loaded?`${started?123:"-"} 0 ${f.state.launch_agent_label}`:""};if(args[0]==="print")return {ok:loaded,output:loaded?print():`Could not find service \"${f.state.launch_agent_label}\" in domain for user gui:${process.getuid?.()||0}`};if(args[0]==="bootstrap"){effects.push("bootstrap");loaded=true;started=true;return {ok:true,output:""};}return {ok:false,output:"unexpected"};};
  const runtime=(action,options)=>{if(!options.preflightOnly&&["install","start"].includes(action)){const journal=options.state.macos_runner_bootstrap,snapshot=f.snapshots.at(-1),expected=action==="install"?"INSTALL_INTENT":"START_INTENT";assert.equal(f.state.macos_runner_action_approval,undefined);assert.notStrictEqual(snapshot,f.state);assert.notStrictEqual(snapshot.macos_runner_bootstrap,journal);assert.equal(snapshot.macos_runner_action_approval,undefined);assert.equal(snapshot.macos_action_approval,undefined);for(const key of ["phase","operation","attempt","action_challenge","claim_path"])assert.equal(snapshot.macos_runner_bootstrap[key],key==="phase"?expected:journal[key]);assert.equal(journal.phase,expected);assert.equal(trustedClaimRead({state:options.state,home:f.home,action,attempt:journal.attempt,challenge:journal.action_challenge,claim_path:journal.claim_path}),true);const bytes=fs.readFileSync(journal.claim_path);assert.equal(f.context.claim({state:f.state,action,attempt:journal.attempt,challenge:journal.action_challenge,home:f.home}).error_id,"MACOS-FIRST-BOOT-ALREADY-CLAIMED");assert.deepEqual(fs.readFileSync(journal.claim_path),bytes);reject=rejectNext===action?action:null;rejectNext=null;const result=macosRuntimeAction(action,{...options,platform:"darwin",arch:"arm64",commandRunner,runnerInspector:()=>runner,capabilityVerifier:()=>{throw Error("legacy helper must not run");}});reject=null;return result;}return macosRuntimeAction(action,{...options,platform:"darwin",arch:"arm64",commandRunner,runnerInspector:()=>runner,capabilityVerifier:()=>{throw Error("legacy helper must not run");}});};
  const advance=()=>f.context.advance(f.state,{home:f.home,inspect:()=>runner,runtime,persist:state=>f.snapshots.push(JSON.parse(JSON.stringify(state)))}),approve=prompt=>{f.state.macos_runner_action_approval=prompt.approval_challenge;if(prompt.action_id==="macos_runner_start")f.state.macos_runner_activation={installation_id:f.state.installation_id,runner_id:runner.runner_id,approval_sha256:runner.approval_sha256,challenge:prompt.approval_challenge,login_restart_approved:true,approved_at:"2026-10-22T00:00:00Z"};};
  let prompt=advance();approve(prompt);let result=advance();assert.equal(result.recovery_status,"NEW_EXACT_APPROVAL_REQUIRED_OR_INSPECT",JSON.stringify(result));assert.equal(f.state.macos_runner_bootstrap.phase,"REJECTED");const installOne=f.state.macos_runner_bootstrap.rejections[0].claim_path;assert.equal(fs.existsSync(installOne),true);prompt=advance();const installTwo=prompt.approval_challenge;assert.notEqual(installTwo,f.state.macos_runner_bootstrap.rejections[0].action_challenge);approve(prompt);result=advance();assert.equal(result.action_id,"macos_runner_start");assert.equal(fs.existsSync(path.join(f.state.instance_root,"macos-runner-install-attempt-2-claim.json")),true);rejectNext="start";
  prompt=advance();approve(prompt);result=advance();assert.equal(result.recovery_status,"NEW_EXACT_APPROVAL_REQUIRED_OR_INSPECT");assert.equal(f.state.macos_runner_bootstrap.phase,"REJECTED");prompt=advance();approve(prompt);result=advance();assert.equal(result.status,"READY");assert.deepEqual(effects,["bootstrap"]);assert.equal(f.state.macos_runner_action_approval,undefined);
});

test("trusted uncertain start bootstrap preserves claim and forbids automatic retry",t=>{
  const f=fixture(t),previousHome=process.env.HOME,runnerPath=path.join(f.state.instance_root,"runner"),service=path.join(runnerPath,"bin","runsvc.sh"),node=path.join(runnerPath,"externals","node20","bin","node"),script=path.join(runnerPath,"bin","RunnerService.js"),listener=path.join(runnerPath,"bin","Runner.Listener");process.env.HOME=f.home;t.after(()=>{if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;});
  fs.mkdirSync(f.state.instance_root,{recursive:true,mode:0o700});for(const file of [service,node,script,listener]){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,"synthetic\n",{mode:0o700});}const config=Buffer.from(JSON.stringify({agentId:303,agentName:f.state.runner_label,gitHubUrl:`https://github.com/${f.state.control_repository}`,serverUrl:"https://pipelines.actions.githubusercontent.com/example",workFolder:"_work"})),configPath=path.join(runnerPath,".runner");fs.writeFileSync(configPath,config,{mode:0o600});const configStat=fs.lstatSync(configPath),config_identity=Object.fromEntries(["dev","ino","uid","gid","mode","nlink","size","mtimeMs","ctimeMs"].map(key=>[key,configStat[key]]));
  Object.assign(f.state,{runner_path:runnerPath,launch_agent_label:"com.chatgpt.codex.uncertain-firstboot",macos_setup_approved:true});f.state.macos_service_policy.readiness_profile=TRUSTED_SINGLE_USER_READINESS_PROFILE;f.state.macos_service_policy.approval=trustedSingleUserReadinessProfileChallenge(f.state);
  let loaded=false,bootstrapCalls=0,bootoutCalls=0;const runner={...f.runner,runner_executable:listener,service_executable:service,service_arguments:[],service_node:node,service_node_version:"node20",service_script:script,config_sha256:crypto.createHash("sha256").update(config).digest("hex"),config_identity,local_process_observation:"trusted-single-user-ps-v1",local_listener_pid:null,local_listener_identity:null,local_service_pids:[]},plist=path.join(f.home,"Library","LaunchAgents",`${f.state.launch_agent_label}.plist`),job=`gui/${process.getuid?.()||0}/${f.state.launch_agent_label}`;
  const commandRunner=(command,args)=>{if(command==="/bin/ps")return {ok:true,output:""};if(command!=="launchctl")return {ok:false,output:"unexpected"};if(args[0]==="list")return {ok:true,output:loaded?`- 0 ${f.state.launch_agent_label}`:""};if(args[0]==="print")return {ok:loaded,output:loaded?`${job} = { state = running }`:`Could not find service \"${f.state.launch_agent_label}\" in domain for user gui:${process.getuid?.()||0}`};if(args[0]==="bootstrap"){bootstrapCalls++;return {ok:false,output:"simulated bootstrap uncertainty"};}if(args[0]==="bootout"){bootoutCalls++;return {ok:false,output:"unexpected cleanup"};}return {ok:false,output:"unexpected"};};
  const claims=[],claim=args=>{claims.push({action:args.action,attempt:args.attempt,challenge:args.challenge});return f.context.claim(args);},runtime=(action,options)=>macosRuntimeAction(action,{...options,platform:"darwin",arch:"arm64",commandRunner,runnerInspector:()=>runner,capabilityVerifier:()=>{throw Error("legacy helper must not run");}}),advance=()=>f.context.advance(f.state,{home:f.home,inspect:()=>runner,runtime,claim,persist:state=>f.snapshots.push(JSON.parse(JSON.stringify(state)))}),approve=prompt=>{f.state.macos_runner_action_approval=prompt.approval_challenge;if(prompt.action_id==="macos_runner_start")f.state.macos_runner_activation={installation_id:f.state.installation_id,runner_id:runner.runner_id,approval_sha256:runner.approval_sha256,challenge:prompt.approval_challenge,login_restart_approved:true,approved_at:"2026-10-22T00:00:00Z"};};
  let prompt=advance();assert.equal(prompt.action_id,"macos_runner_install");const installChallenge=prompt.approval_challenge;approve(prompt);let result=advance();assert.equal(result.action_id,"macos_runner_start",JSON.stringify(result));const installClaim=f.state.macos_runner_bootstrap.claim_path,installBytes=fs.readFileSync(installClaim);prompt=advance();assert.equal(prompt.action_id,"macos_runner_start");const startChallenge=prompt.approval_challenge;approve(prompt);result=advance();assert.equal(result.status,"ERROR");assert.equal(result.recovery_status,"MANUAL_RECOVERY_REQUIRED");assert.equal(f.state.macos_runner_bootstrap.phase,"ERROR");const claimPath=f.state.macos_runner_bootstrap.claim_path,startBytes=fs.readFileSync(claimPath);assert.deepEqual(claims,[{action:"install",attempt:1,challenge:installChallenge},{action:"start",attempt:1,challenge:startChallenge}]);assert.equal(f.state.macos_runner_action_approval,undefined);assert.equal(trustedClaimRead({state:f.state,home:f.home,action:"start",attempt:f.state.macos_runner_bootstrap.attempt,challenge:f.state.macos_runner_bootstrap.action_challenge,claim_path:claimPath}),true);assert.equal(bootstrapCalls,1);assert.equal(bootoutCalls,0);
  const [intent,error]=f.snapshots.slice(-2);assert.notStrictEqual(intent,error);assert.notStrictEqual(intent,f.state);assert.notStrictEqual(intent.macos_runner_bootstrap,f.state.macos_runner_bootstrap);assert.notStrictEqual(error,f.state);assert.notStrictEqual(error.macos_runner_bootstrap,f.state.macos_runner_bootstrap);assert.equal(intent.macos_runner_bootstrap.phase,"START_INTENT");assert.equal(intent.macos_runner_bootstrap.operation,"start");assert.equal(intent.macos_runner_bootstrap.attempt,1);assert.equal(intent.macos_runner_bootstrap.action_challenge,startChallenge);assert.equal(intent.macos_runner_bootstrap.claim_path,claimPath);assert.equal(intent.macos_runner_action_approval,undefined);assert.equal(intent.macos_action_approval,undefined);assert.equal(error.macos_runner_bootstrap.phase,"ERROR");assert.equal(error.macos_runner_bootstrap.operation,"start");assert.equal(error.macos_runner_bootstrap.attempt,1);assert.equal(error.macos_runner_bootstrap.action_challenge,startChallenge);assert.equal(error.macos_runner_bootstrap.claim_path,claimPath);assert.equal(error.macos_runner_action_approval,undefined);assert.equal(error.macos_action_approval,undefined);assert.equal(error.macos_runner_bootstrap.result.status,"ERROR");assert.equal(error.macos_runner_bootstrap.result.mutations_performed,"UNKNOWN");assert.equal(error.macos_runner_bootstrap.result.error_id,result.error_id);
  const snapshots=f.snapshots.length,journal=JSON.stringify(error),claimFiles=fs.readdirSync(f.state.instance_root).filter(file=>/macos-runner-(?:install|start)(?:-attempt-\d+)?-claim\.json/.test(file)).sort();result=advance();assert.equal(result.error_id,"MACOS-FIRST-BOOT-INTERRUPTED");assert.equal(f.snapshots.length,snapshots);assert.equal(JSON.stringify(f.snapshots.at(-1)),journal);assert.deepEqual(claims,[{action:"install",attempt:1,challenge:installChallenge},{action:"start",attempt:1,challenge:startChallenge}]);assert.deepEqual(fs.readdirSync(f.state.instance_root).filter(file=>/macos-runner-(?:install|start)(?:-attempt-\d+)?-claim\.json/.test(file)).sort(),claimFiles);assert.equal(bootstrapCalls,1);assert.equal(bootoutCalls,0);assert.deepEqual(fs.readFileSync(installClaim),installBytes);assert.deepEqual(fs.readFileSync(claimPath),startBytes);
});

test("G3 legacy evidence isolation: CLI passive paths use real classification and no external calls", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "g3-cli-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, ".chatgpt-codex-orchestrator", "instances", "1832f0bb");
  fs.mkdirSync(path.join(root, "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const state = { preferred_language: "en", macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" };
  const before = JSON.stringify(state), emitted = [];
  const context = vm.createContext({ path, os: { homedir: () => home }, process: { platform: "darwin" }, loadState: () => state, ensureStateLanguage: () => "en", valueOf: () => undefined, inspectMacosExistingInstanceRecovery, isMacosFreshFirstInstallBootstrap, emit: result => emitted.push(result), macosTrustedRecoveryEvidence: () => assert.fail("no external evidence calls"), commandExists: () => assert.fail("no commands") });
  const report = cli.slice(cli.indexOf("function macosRecoveryReport("), cli.indexOf("function macosBootstrapMayAdvance("));
  const dry = cli.slice(cli.indexOf("function dryRun() {"), cli.indexOf("function codexLogin()"));
  const preflight = cli.slice(cli.indexOf("function recoveryPreflight() {"), cli.indexOf("function reportProblem()"));
  vm.runInContext(report + dry + preflight + "\nthis.dry=dryRun;this.preflight=recoveryPreflight;", context);
  for (const run of [context.dry, context.preflight]) { run(); const result = emitted.pop(); assert.equal(result.status, "NEEDS_USER_ACTION"); assert.equal(result.action_id, "macos_official_fresh_preparation"); assert.equal(result.installation_authorized, false); assert.equal(result.runtime_readiness, "NOT_ASSESSED"); }
  fs.writeFileSync(path.join(root, "unexpected"), "x", { mode: 0o600 });
  for (const run of [context.dry, context.preflight]) { run(); const result = emitted.pop(); assert.equal(result.status, "ERROR"); assert.equal(result.official_fresh_first_install_bootstrap_eligible, false); }
  assert.equal(JSON.stringify(state), before);
});

test("G3 legacy evidence isolation: actual migration preflight blocks old runner observations before writes", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const { migrationPreflight } = await import("../src/lib/macos-platform.mjs");
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "g3-runtime-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, ".chatgpt-codex-orchestrator", "instances", "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 });
  for (const [name, stateExtra, response] of [
    ["old job", {}, { ok: true, output: "123 0 com.chatgpt.codex.old" }],
    ["old job without PID", {}, { ok: true, output: "- 0 com.chatgpt.codex.old" }],
    ["failed observation", {}, { ok: false, output: "failure" }],
    ["unknown ownership", { runner_label: "codex-orchestrator-old" }, { ok: true, output: "" }]
  ]) {
    const state = { preferred_language: "en", macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb", ...stateExtra };
    const recovery = inspectMacosExistingInstanceRecovery({ home, state });
    const emitted = [], calls = [];
    const context = vm.createContext({ process: { platform: "darwin" }, loadState: () => state, ensureStateLanguage: () => "en", hasTrustedSingleUserReadinessProfileMarker: () => false, macosRecoveryReport: () => recovery, isMacosFreshFirstInstallBootstrap, macosTrustedRecoveryEvidence: () => ({ status: "ABSENT" }), macosFreshBootstrapMayAdvance: () => false, macosPrerequisites: () => ({ node: true, git: true, gh: true, codex: true, session_auth: true, legacy_native_helper_gate: "PASS" }), migrationPreflight: ({ state: actual }) => migrationPreflight({ state: actual, home, commandRunner: (command, args) => { calls.push([command, args]); return response; } }), emit: result => emitted.push(result), saveState: () => assert.fail("save"), prepareMigrationIntent: () => assert.fail("intent"), prepareControlEnvironment: () => assert.fail("repositories") });
    vm.runInContext(cli.slice(cli.indexOf("function runSetup() {"), cli.indexOf("function codexLogin()")) + "\nthis.run=runSetup;", context);
    context.run();
    assert.equal(emitted[0].error_id, "MACOS-PREREQUISITE-OR-MIGRATION", name);
    assert.equal(emitted[0].migration.status, "CONFLICT", name);
    assert.equal(calls.length, 1, name);
  }
});

function g3RegistrationFixture(t, { installationId = "abcd1234-pending-install", instanceId = "abcd1234" } = {}) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "trusted-first-registration-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.chmodSync(home, 0o700);
  const instance = path.join(home, ".chatgpt-codex-orchestrator", "instances", instanceId);
  const project = `sandbox-${instanceId}`;
  const control = defaultLocalPaths({ home, installationId, projectKey: project }).control;
  fs.mkdirSync(control, { recursive: true, mode: 0o700 });
  fs.mkdirSync(instance, { recursive: true, mode: 0o700 });
  const state = {
    schema_version: 1, installation_id: installationId, instance_id: instanceId,
    instance_platform: "darwin", instance_arch: "arm64", instance_root: instance,
    control_clone_path: control, chat_route_file: path.join(instance, "chat-routes.json"),
    github_login: "owner", github_owner_id: "42", control_repository_id: "101", sandbox_repository_id: "202",
    control_repository: `owner/chatgpt-codex-orchestrator-control-${instanceId}`,
    sandbox_repository: `owner/chatgpt-codex-orchestrator-sandbox-${instanceId}`,
    sandbox_project_key: project, reviewer_chat_url: "https://chatgpt.com/c/pending-first-registration",
    macos_setup_approved: true, github_plugin_authorized: true, github_plugin_authorization_verified: true,
    generated_repo_authorized: true, control_environment_ready: true, target_environment_ready: false,
    sandbox_only: true, sandbox_verified: false
  };
  Object.assign(state, {
    github_plugin_authorization_installation_id: installationId,
    github_plugin_authorization_control_repository: state.control_repository,
    github_plugin_authorization_sandbox_repository: state.sandbox_repository,
    github_plugin_authorization_chat_url: state.reviewer_chat_url
  });
  const issueNumber = 51;
  state.sandbox_chat_registration_issue = `https://github.com/${state.control_repository}/issues/${issueNumber}`;
  const metadata = {
    schema_version: 1, instance_id: instanceId, installation_id: installationId,
    platform: "darwin", arch: "arm64", instance_root: instance, chat_route_file: state.chat_route_file,
    control_repository: state.control_repository, sandbox_repository: state.sandbox_repository,
    control_repository_id: state.control_repository_id, sandbox_repository_id: state.sandbox_repository_id,
    github_owner_id: state.github_owner_id, trusted_github_username: state.github_login, role: "control",
    origin: `https://github.com/${state.control_repository}.git`, remote_origin: `https://github.com/${state.control_repository}.git`
  };
  const intent = {
    schema_version: 1, phase: "PREPARED", installation_id: installationId,
    generated_repositories: { control: state.control_repository, sandbox: state.sandbox_repository },
    destination: { path: instance }
  };
  const route = {
    route: `chat-${issueNumber}`, project, status: "active", chat_url: state.reviewer_chat_url,
    registration_issue: issueNumber, installation_id: installationId
  };
  const issue = {
    number: issueNumber, state: "open", html_url: state.sandbox_chat_registration_issue,
    url: `https://api.github.com/repos/${state.control_repository}/issues/${issueNumber}`, user: { login: "owner", id: 42 },
    title: `[CHAT-REGISTER] INSTALL-CHAT-${instanceId}-${project}-${crypto.createHash("sha256").update(state.reviewer_chat_url).digest("hex").slice(0, 16)}`,
    body: JSON.stringify({ project, chat_url: state.reviewer_chat_url, installation_id: installationId })
  };
  const repositories = Object.fromEntries(["control", "sandbox"].map(role => {
    const repository = state[`${role}_repository`];
    return [repository, {
      id: Number(state[`${role}_repository_id`]), private: true, visibility: "private",
      name: repository.split("/")[1], full_name: repository, owner: { login: "owner", id: 42 },
      description: `ChatGPT Codex Orchestrator ${role} installation ${installationId}`
    }];
  }));
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value) + "\n", { mode: 0o600 });
  const controlFile = path.join(control, "instance.json");
  const intentFile = path.join(instance, "migration-intent.json");
  writeJson(controlFile, metadata);
  writeJson(intentFile, intent);
  writeJson(state.chat_route_file, { version: 1, instance_id: state.instance_id, installation_id: state.installation_id, control_repository: state.control_repository, sandbox_repository: state.sandbox_repository, routes: [] });
  const calls = [];
  const f = { home, instance, control, state, metadata, intent, route, issue, repositories, calls, writeJson, controlFile, intentFile };
  f.githubApi = {
    getAuthenticatedUser: () => { calls.push(["user"]); return { login: "owner", id: 42 }; },
    getRepository: repository => { calls.push(["repository", repository]); return repositories[repository]; },
    getIssue: (repository, number) => { calls.push(["issue", repository, number]); return f.issue; }
  };
  f.queue = () => writeJson(state.chat_route_file, { version: 1, routes: [f.route] });
  f.callbackId = `chat-register-${project}-${issueNumber}`;
  f.outbox = path.join(instance, "pending-wakes", `${f.callbackId}.json`);
  f.deliveryJournal = path.join(instance, "registration-delivery", `${f.callbackId}.json`);
  f.writeDeliveryProof = () => {
    for (const directory of [path.dirname(f.outbox), path.dirname(f.deliveryJournal)]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
    }
    writeJson(f.outbox, {
      delivery_state: "DELIVERED", delivery_owner: "register-chat.mjs", callback_id: f.callbackId,
      chat_url: state.reviewer_chat_url, verified_by: "existing-user-message"
    });
    writeJson(f.deliveryJournal, {
      schema_version: 1, status: "DELIVERED", verified_role: "user", verified_by: "existing-user-message",
      callback_id: f.callbackId, chat_url: state.reviewer_chat_url,
      callback_state_sha256: crypto.createHash("sha256").update(fs.readFileSync(f.outbox)).digest("hex")
    });
  };
  f.verify = (options = {}) => verifyTrustedRecoveryEvidence({ state, home, githubApi: f.githubApi, requireReceipt: false, ...options });
  return f;
}


test("G3 legacy evidence isolation: real two-root provenance and registration stages", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t);
  Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const context = vm.createContext({ path, os: { homedir: () => f.home }, canonicalInstallationId, findRegisteredChatRoute });
  vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + "\nthis.fresh=macosFreshBootstrapMayAdvance;", context);
  const check = expected => { const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }); const evidence = f.verify(); assert.equal(evidence.status, expected); assert.equal(context.fresh(f.state, recovery, evidence), true, expected); return { recovery, evidence }; };
  f.state.generated_repo_authorized = false;
  check("NEW_INSTALL_AWAITING_CONNECTOR_AUTH");
  f.state.generated_repo_authorized = true;
  check("NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE");
  f.queue();
  check("NEW_INSTALL_REGISTRATION_PENDING");
  assert.equal(findRegisteredChatRoute(f.state, { projectKey: f.state.sandbox_project_key, chatUrl: f.state.reviewer_chat_url }), null);
  f.writeDeliveryProof();
  const delivered = findRegisteredChatRoute(f.state, { projectKey: f.state.sandbox_project_key, chatUrl: f.state.reviewer_chat_url });
  assert.deepEqual(delivered, f.route);
  f.state.sandbox_review_route = delivered.route;
  check("NEW_INSTALL_PREPARED");
  assert.equal(fs.existsSync(path.join(f.instance, "instance.json")), false);
});

test("G3 legacy evidence isolation: actual provenance matrix", async t => {
for (const [name, mutate] of [
  ["state owner", f => { f.state.github_login = "foreign"; }],
  ["state owner ID", f => { f.state.github_owner_id = "43"; }],
  ["Control owner", f => { f.metadata.trusted_github_username = "foreign"; f.writeJson(f.controlFile, f.metadata); }],
  ["remote owner", f => { f.repositories[f.state.control_repository].owner.id = 43; }],
  ["remote duplicate ID", f => { f.repositories[f.state.sandbox_repository].id = 101; }],
  ["remote swapped ID", f => { f.repositories[f.state.control_repository].id = 202; f.repositories[f.state.sandbox_repository].id = 101; }],
  ["migration identity", f => { f.intent.installation_id = "wrong"; f.writeJson(f.intentFile, f.intent); }],
  ["migration phase", f => { f.intent.phase = "WRONG"; f.writeJson(f.intentFile, f.intent); }],
  ["foreign origin", f => { f.metadata.origin = "https://github.com/foreign/control.git"; f.writeJson(f.controlFile, f.metadata); }],
  ["target enabled", f => { f.state.target_environment_ready = true; }],
  ["route project", f => { f.route.project = "sandbox-other"; f.queue(); }],
  ["route chat", f => { f.route.chat_url = "https://chatgpt.com/c/foreign"; f.queue(); }],
  ["duplicate route", f => { f.writeJson(f.state.chat_route_file, { version: 1, routes: [f.route, f.route] }); }]
]) {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 }); mutate(f);
  const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), evidence = f.verify();
  const context = vm.createContext({ path, os: { homedir: () => f.home }, canonicalInstallationId, findRegisteredChatRoute });
  vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + "\nthis.fresh=macosFreshBootstrapMayAdvance;", context);
  assert.equal(context.fresh(f.state, recovery, evidence), false);
}
});

test("G3 legacy evidence isolation: delivery integrity matrix", t => {
for (const [name, mutate] of [
  ["assistant role", f => { const journal = JSON.parse(fs.readFileSync(f.deliveryJournal)); journal.verified_role = "assistant"; f.writeJson(f.deliveryJournal, journal); }],
  ["bad digest", f => { const journal = JSON.parse(fs.readFileSync(f.deliveryJournal)); journal.callback_state_sha256 = "0".repeat(64); f.writeJson(f.deliveryJournal, journal); }]
]) {
  const f = g3RegistrationFixture(t); f.queue(); f.writeDeliveryProof(); mutate(f);
  assert.equal(findRegisteredChatRoute(f.state, { projectKey: f.state.sandbox_project_key, chatUrl: f.state.reviewer_chat_url }), null);
  f.state.sandbox_review_route = f.route.route; assert.notEqual(f.verify().status, "NEW_INSTALL_PREPARED");
}
});

test("G3 legacy evidence isolation: continuation markers require exact fields and identity omission shape", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), evidence = f.verify();
  const context = vm.createContext({ path, os: { homedir: () => f.home }, canonicalInstallationId, findRegisteredChatRoute });
  vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + "\nthis.fresh=macosFreshBootstrapMayAdvance;", context);
  assert.equal(context.fresh(f.state, recovery, evidence), true);
  for (const key of ["schema_version", "classification", "instance_id", "diagnostics_subtree", "historical_instances_are_authority", "descendants_inspected", "runtime_activity_verified", "reason"]) for (const place of ["aggregate", "historical"]) {
    const copy = structuredClone(recovery), historical = copy.instances.find(item => item.instance_id === "1832f0bb"); (place === "aggregate" ? copy.legacy_evidence_isolation : historical.legacy_evidence_isolation)[key] = "tampered";
    assert.equal(context.fresh(f.state, copy, evidence), false, `${place} ${key}`);
  }
  for (const value of [null, false, 0, ""]) for (const place of ["aggregate", "historical"]) {
    const copy = structuredClone(recovery), historical = copy.instances.find(item => item.instance_id === "1832f0bb"); if (place === "aggregate") copy.legacy_evidence_isolation = value; else historical.legacy_evidence_isolation = value;
    assert.equal(context.fresh(f.state, copy, evidence), false, `${place} ${value}`);
  }
  const missing = structuredClone(recovery); delete missing.instances.find(item => item.instance_id === f.state.instance_id).identity; assert.equal(context.fresh(f.state, missing, evidence), false);
  const reordered = structuredClone(recovery); for (const holder of [reordered, reordered.instances.find(item => item.instance_id === "1832f0bb")]) holder.legacy_evidence_isolation = Object.fromEntries(Object.entries(holder.legacy_evidence_isolation).reverse()); assert.equal(context.fresh(f.state, reordered, evidence), true);
});

test("G3 legacy evidence isolation: explicit route identity matrix", async t => {
for (const field of ["instance_id", "control_repository", "sandbox_repository", "installation_id"]) for (const value of [null, "", "foreign"]) {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 }); f.route[field] = value; f.queue();
  const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), evidence = f.verify();
  const context = vm.createContext({ path, os: { homedir: () => f.home }, canonicalInstallationId, findRegisteredChatRoute });
  vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + "\nthis.fresh=macosFreshBootstrapMayAdvance;", context);
  assert.equal(context.fresh(f.state, recovery, evidence), false);
}
});

test("G3 legacy evidence isolation: real pending evidence makes runSetup wait before all writes", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { preferred_language: "en", fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 }); f.queue();
  const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), evidence = f.verify(), before = JSON.stringify(f.state);
  assert.equal(evidence.status, "NEW_INSTALL_REGISTRATION_PENDING");
  const forbidden = () => assert.fail("pending registration must stop before external effects"), context = vm.createContext({ path, os: { homedir: () => f.home }, process: { platform: "darwin" }, canonicalInstallationId, findRegisteredChatRoute, isMacosFreshFirstInstallBootstrap, loadState: () => f.state, ensureStateLanguage: () => "en", hasTrustedSingleUserReadinessProfileMarker: () => false, macosRecoveryReport: () => recovery, macosTrustedRecoveryEvidence: () => evidence, emit: result => result, macosPrerequisites: forbidden, migrationPreflight: forbidden, saveState: forbidden, prepareMigrationIntent: forbidden, prepareControlEnvironment: forbidden, ensureInstallerChatRegistration: forbidden, advanceMacosFirstBootRunner: forbidden });
  vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + cli.slice(cli.indexOf("function runSetup() {"), cli.indexOf("function codexLogin()")) + "\nthis.run=runSetup;", context);
  const result = context.run(); assert.equal(result.status, "WAITING"); assert.equal(result.action_id, "sandbox_chat_registration"); assert.equal(result.mutations_performed, false); assert.equal(JSON.stringify(f.state), before);
});

test("G3 legacy evidence isolation: jointly forged local owner cannot replace independent API owner", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb", github_owner_id: "43" });
  f.metadata.github_owner_id = "43"; f.writeJson(f.controlFile, f.metadata);
  fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), evidence = f.verify();
  const context = vm.createContext({ path, os: { homedir: () => f.home }, canonicalInstallationId, findRegisteredChatRoute });
  vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + "\nthis.fresh=macosFreshBootstrapMayAdvance;", context);
  assert.equal(["NEW_INSTALL_AWAITING_CONNECTOR_AUTH", "NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE", "NEW_INSTALL_REGISTRATION_PENDING", "NEW_INSTALL_PREPARED", "VERIFIED"].includes(evidence.status), false); assert.equal(context.fresh(f.state, recovery, evidence), false);
  assert.ok(f.calls.some(call => call[0] === "user")); for (const repo of [f.state.control_repository, f.state.sandbox_repository]) assert.ok(f.calls.some(call => call[0] === "repository" && call[1] === repo));
});

test("G3 legacy evidence isolation: Windows preflight and dry run avoid Mac inspection", () => {
  const forbidden = () => assert.fail("Windows path called Mac or external operation"), outputs = [], calls = [];
  const context = vm.createContext({ process: { platform: "win32" }, loadState: () => ({}), ensureStateLanguage: () => "en", emit: result => outputs.push(result), commandExists: (name, args) => { calls.push([name, args]); return { ok: true }; }, macosRecoveryReport: forbidden, macosTrustedRecoveryEvidence: forbidden, macosPrerequisites: forbidden, migrationPreflight: forbidden, macosNativeHelperPreflight: forbidden });
  vm.runInContext(cli.slice(cli.indexOf("function dryRun() {"), cli.indexOf("function codexLogin()")) + cli.slice(cli.indexOf("function recoveryPreflight() {"), cli.indexOf("function reportProblem()")) + "\nthis.dry=dryRun;this.preflight=recoveryPreflight;", context);
  context.preflight(); assert.equal(outputs[0].status, "PASS"); assert.equal(outputs[0].existing_instance_recovery.status, "UNSUPPORTED"); assert.equal(calls.length, 0);
  context.dry(); assert.equal(outputs[1].status, "PASS"); assert.equal(outputs[1].mutations_performed, false); assert.ok(outputs[1].plan.some(item => item.step === "isolated_control_environment")); assert.ok(calls.length > 0);
});

test("G3 legacy evidence isolation: old and new identity collision matrix", async t => {
for (const [name, oldMetadata] of [
  ["control numeric ID", { control_repository_id: 101 }], ["cross-role numeric ID", { control_repository_id: 202 }], ["sandbox numeric ID", { sandbox_repository_id: 202 }], ["cross-role sandbox ID", { sandbox_repository_id: 101 }], ["new instance ID", { instance_id: "abcd1234" }], ["new installation ID", { installation_id: "abcd1234-pending-install" }]
]) {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  const old = path.join(path.dirname(f.instance), "1832f0bb"); fs.mkdirSync(path.join(old, "short-turn-evidence"), { recursive: true, mode: 0o700 }); f.writeJson(path.join(old, "instance.json"), oldMetadata);
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }).legacy_evidence_isolation.classification, "REJECTED");
}
});

test("G3 legacy evidence isolation: two-root route casefold collision rejects", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  const old = path.join(path.dirname(f.instance), "1832f0bb"); fs.mkdirSync(path.join(old, "short-turn-evidence"), { recursive: true, mode: 0o700 }); f.writeJson(path.join(old, "chat-routes.json"), { routes: [{ route: "CHAT-51" }] }); f.queue();
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }).legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: explicit selected path dispatches to selected inspector", () => {
  const state = { instance_id: "abcd1234", ...{ macos_setup_approved: true, fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" } }, expected = { status: "NEEDS_USER_ACTION" }, calls = [];
  const context = vm.createContext({ os: { homedir: () => "/synthetic" }, valueOf: () => state.instance_id, macosGithubApi: () => ({}), inspectMacosSelectedFreshInstance: args => { calls.push(args); return expected; }, inspectMacosExistingInstanceRecovery: () => assert.fail("selected dispatch must not use aggregate inspector") });
  vm.runInContext(cli.slice(cli.indexOf("function macosRecoveryReport("), cli.indexOf("function macosBootstrapMayAdvance(")) + "\nthis.report=macosRecoveryReport;", context);
  assert.equal(context.report(state), expected); assert.equal(calls.length, 1); assert.equal(calls[0].state.selected_fresh_instance, true); assert.equal(state.selected_fresh_instance, undefined);
});

test("G3 legacy evidence isolation: actual conflicting trusted evidence blocks both CLI reports", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { preferred_language: "en", fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 }); f.metadata.instance_id = "foreign"; f.writeJson(f.controlFile, f.metadata);
  const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), evidence = f.verify(); assert.equal(evidence.status, "CONFLICT");
  const outputs = [], forbidden = () => assert.fail("conflicting evidence must stop before commands");
  const context = vm.createContext({ path, os: { homedir: () => f.home }, process: { platform: "darwin" }, canonicalInstallationId, findRegisteredChatRoute, loadState: () => f.state, ensureStateLanguage: () => "en", macosRecoveryReport: () => recovery, macosTrustedRecoveryEvidence: () => evidence, macosStateBound: () => false, macosSelectedAwaitingFirstRoute: () => false, emit: result => outputs.push(result), commandExists: forbidden, macosPrerequisites: forbidden });
  vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + cli.slice(cli.indexOf("function dryRun() {"), cli.indexOf("function codexLogin()")) + cli.slice(cli.indexOf("function recoveryPreflight() {"), cli.indexOf("function reportProblem()")) + "\nthis.dry=dryRun;this.preflight=recoveryPreflight;", context);
  context.dry(); context.preflight(); for (const result of outputs) { assert.notEqual(result.status, "PASS"); assert.equal(result.mutations_performed, false); }
});

test("G3 legacy evidence isolation: diagnostics cannot alias fresh instance inode", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" });
  const diag = path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"); fs.mkdirSync(diag, { recursive: true, mode: 0o700 }); const freshStat = fs.lstatSync(f.instance);
  const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync") return target[key]; return (...args) => { const stat = target.lstatSync(...args); if (args[0] !== diag) return stat; return new Proxy(stat, { get(object, prop) { if (prop === "dev" || prop === "ino") return freshStat[prop]; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); }; } });
  assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state, fsImpl: proxy }).legacy_evidence_isolation.classification, "REJECTED");
});

test("G3 legacy evidence isolation: two-root paths and partial provenance reject", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  for (const field of ["control_clone_path", "chat_route_file"]) {
    const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" }); fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 });
    f.state[field] = `${f.state[field]}/../${path.basename(f.state[field])}`;
    assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }).legacy_evidence_isolation.classification, "REJECTED", field);
  }
  for (const field of ["github_login", "github_owner_id", "control_repository_id", "sandbox_repository_id"]) {
    const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" }); fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 }); delete f.state[field];
    const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), evidence = f.verify();
    const context = vm.createContext({ path, os: { homedir: () => f.home }, canonicalInstallationId, findRegisteredChatRoute }); vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + "\nthis.fresh=macosFreshBootstrapMayAdvance;", context);
    assert.equal(context.fresh(f.state, recovery, evidence), false, field);
  }
});

test("G3 legacy evidence isolation: fresh root ownership, mode and alias checks", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  for (const kind of ["uid", "0755", "special", "inode-alias"]) {
    const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" }); const old = path.join(path.dirname(f.instance), "1832f0bb"); fs.mkdirSync(path.join(old, "short-turn-evidence"), { recursive: true, mode: 0o700 }); const oldStat = fs.lstatSync(old);
    const proxy = new Proxy(fs, { get(target, key) { if (key !== "lstatSync") return target[key]; return (...args) => { const stat = target.lstatSync(...args); if (args[0] !== f.instance) return stat; return new Proxy(stat, { get(object, prop) { if (kind === "uid" && prop === "uid") return (process.getuid?.() ?? 0) + 1; if (kind === "0755" && prop === "mode") return (object.mode & ~0o7777) | 0o755; if (kind === "special" && prop === "mode") return object.mode | 0o1000; if (kind === "inode-alias" && (prop === "dev" || prop === "ino")) return oldStat[prop]; const value = object[prop]; return typeof value === "function" ? value.bind(object) : value; } }); }; } });
    assert.equal(inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state, fsImpl: proxy }).legacy_evidence_isolation.classification, "REJECTED", kind);
  }
});

test("G3 legacy evidence isolation: wrong registration issue and route bindings fail", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  for (const kind of ["issue-number", "issue-owner", "issue-project", "route-number", "route-issue"]) {
    const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" }); fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 });
    if (kind === "issue-number") f.issue.number = 52; if (kind === "issue-owner") f.issue.user.id = 43; if (kind === "issue-project") f.issue.body = JSON.stringify({ project: "other", chat_url: f.state.reviewer_chat_url, installation_id: f.state.installation_id }); if (kind === "route-number") f.route.route = "chat-52"; if (kind === "route-issue") f.route.registration_issue = 52; f.queue();
    const recovery = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), evidence = f.verify(); const context = vm.createContext({ path, os: { homedir: () => f.home }, canonicalInstallationId, findRegisteredChatRoute }); vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + "\nthis.fresh=macosFreshBootstrapMayAdvance;", context); assert.equal(context.fresh(f.state, recovery, evidence), false, kind);
  }
});

test("G3 legacy evidence isolation: real continuation evidence advances both CLI reports", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { preferred_language: "en", fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" }); fs.mkdirSync(path.join(path.dirname(f.instance), "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const outputs = [], context = vm.createContext({ path, os: { homedir: () => f.home }, process: { platform: "darwin" }, canonicalInstallationId, findRegisteredChatRoute, loadState: () => f.state, ensureStateLanguage: () => "en", macosRecoveryReport: () => inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }), macosTrustedRecoveryEvidence: () => f.verify(), macosStateBound: () => false, macosSelectedAwaitingFirstRoute: () => false, emit: result => outputs.push(result), commandExists: () => ({ ok: true }), macosPrerequisites: () => ({ node: true, session_auth: true, native_helper: { status: "PASS" } }), migrationPreflight: () => ({ status: "READY" }), macosNativeHelperPreflight: () => ({ status: "PASS" }) });
  vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + cli.slice(cli.indexOf("function dryRun() {"), cli.indexOf("function codexLogin()")) + cli.slice(cli.indexOf("function recoveryPreflight() {"), cli.indexOf("function reportProblem()")) + "\nthis.dry=dryRun;this.preflight=recoveryPreflight;", context);
  assert.equal(f.verify().status, "NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE"); context.dry(); context.preflight(); assert.equal(outputs.length, 2); for (const result of outputs) { assert.equal(result.status, "PASS"); assert.equal(result.mutations_performed, false); }
});

test("G3 legacy evidence isolation: generated repository names cannot collide across old and new identities", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const oldControl = "owner/chatgpt-codex-orchestrator-control-1832f0bb", oldSandbox = "owner/chatgpt-codex-orchestrator-sandbox-1832f0bb";
  for (const [field, name] of [["control_repository", oldControl], ["sandbox_repository", oldSandbox.toUpperCase()], ["control_repository", oldSandbox], ["sandbox_repository", oldControl.toUpperCase()]]) {
    const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb", [field]: name });
    const old = path.join(path.dirname(f.instance), "1832f0bb"), file = path.join(old, "instance.json"); fs.mkdirSync(path.join(old, "short-turn-evidence"), { recursive: true, mode: 0o700 }); f.writeJson(file, { control_repository: oldControl, sandbox_repository: oldSandbox });
    const before = fs.readFileSync(file), stat = fs.lstatSync(file), report = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state });
    assert.equal(report.legacy_evidence_isolation.classification, "REJECTED", field); assert.equal(report.legacy_evidence_isolation.reason, "identity_collision", field); assert.equal(isMacosFreshFirstInstallBootstrap({ state: f.state, recovery: report }), false, field); assert.deepEqual(fs.readFileSync(file), before); for (const key of ["mode", "dev", "ino"]) assert.equal(fs.lstatSync(file)[key], stat[key]);
  }
});


test("G3 legacy evidence isolation: real third root blocks two-root continuation", async t => {
  const { inspectMacosExistingInstanceRecovery } = await import("../src/lib/macos-existing-instance-recovery.mjs");
  const f = g3RegistrationFixture(t); Object.assign(f.state, { fresh_first_install_bootstrap: true, fresh_first_install_legacy_instance_id: "1832f0bb" }); const instances = path.dirname(f.instance); fs.mkdirSync(path.join(instances, "1832f0bb", "short-turn-evidence"), { recursive: true, mode: 0o700 });
  const valid = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }); assert.equal(valid.legacy_evidence_isolation.classification, "OPAQUE_PRESERVED_NONAUTHORITY"); const evidence = f.verify();
  fs.mkdirSync(path.join(instances, "unexpected-third"), { mode: 0o700 }); const rejected = inspectMacosExistingInstanceRecovery({ home: f.home, state: f.state }); assert.equal(rejected.legacy_evidence_isolation.classification, "REJECTED");
  const context = vm.createContext({ path, os: { homedir: () => f.home }, canonicalInstallationId, findRegisteredChatRoute }); vm.runInContext(cli.slice(cli.indexOf("function macosBootstrapMayAdvance("), cli.indexOf("function macosSelectedAwaitingFirstRoute(")) + "\nthis.fresh=macosFreshBootstrapMayAdvance;", context); assert.equal(context.fresh(f.state, rejected, evidence), false);
});
