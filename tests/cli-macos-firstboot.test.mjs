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
import {macosPrerequisites} from "../src/lib/macos-platform.mjs";

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
  const context=vm.createContext({crypto,os,fs,path,process,canonicalInstallationId,hasMacosPersonalUsePolicy,hasTrustedSingleUserReadinessProfile,macosPersonalUsePolicyChallenge,trustedSingleUserReadinessProfileChallenge,TRUSTED_SINGLE_USER_READINESS_PROFILE,isMacosFreshFirstInstallBootstrap,inspectMacosRunnerBootstrap:()=>{throw Error("No real inspector in synthetic test");},macosRuntimeAction:()=>{throw Error("No real service in synthetic test");},saveState:()=>{throw Error("No real installer state in synthetic test");}});
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
    if(settings.rejectFinal&&operation==="start")return {status:"ERROR",error_id:"PROVEN-PRE-MUTATION",pre_mutation_rejection:true,service_action_state:"NOT_ATTEMPTED",mutations_performed:false};
    if(settings.fail===operation) return {status:"ERROR",error_id:"SYNTHETIC-INTERRUPTION",mutations_performed:"UNKNOWN"};
    return {status:"PASS",launchctl_state:"loaded",listener_running:!settings.idle,listener_identity:settings.idle?null:identity,plist_verified:settings.plist,mutations_performed:operation!=="status"};
  };
  return {home,state,runner,calls,snapshots,settings,claim:(action,attempt=1)=>context.claim({state,action,attempt,challenge:context.challenge(action,state,runner,attempt),home}),challenge:op=>context.challenge(op,state,runner),advance:()=>context.advance(state,{home,inspect,runtime,claim:()=>({status:"OWNED"}),persist:state=>snapshots.push(JSON.parse(JSON.stringify(state)))})};
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

test("trusted single-user readiness blocks Runner actions before inspection",t=>{
  const f=fixture(t);f.state.macos_setup_approved=true;f.state.macos_service_policy.readiness_profile=TRUSTED_SINGLE_USER_READINESS_PROFILE;f.state.macos_service_policy.approval=trustedSingleUserReadinessProfileChallenge(f.state);
  const result=f.advance();
  assert.equal(result.status,"BLOCKED_UNIMPLEMENTED");assert.equal(result.error_id,"MACOS-RUNNER-SAME-UID-LINEAGE-UNIMPLEMENTED");
  assert.deepEqual(f.calls,[]);assert.equal(f.state.macos_runner_bootstrap,undefined);
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
  const prerequisites=macosPrerequisites({state:selected,commandRunner:name=>({ok:true,output:name==="node"?"v22.0.0":"synthetic"}),nativeHelperPreflight:()=>({status:"MISSING"})});assert.equal(prerequisites.legacy_native_helper_gate,"NOT_APPLICABLE_SUPERSEDED");assert.equal(prerequisites.runner_lineage.status,"BLOCKED_UNIMPLEMENTED");
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
