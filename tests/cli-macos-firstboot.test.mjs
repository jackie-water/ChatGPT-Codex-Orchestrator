import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { MACOS_PERSONAL_USE_POLICY, hasMacosPersonalUsePolicy, macosPersonalUsePolicyChallenge } from "../src/lib/macos-personal-use-service.mjs";
import {canonicalInstallationId, defaultLocalPaths} from "../src/lib/control-render.mjs";
import {ensureInstallerChatRegistration, findRegisteredChatRoute, normalizeChatUrl} from "../src/lib/chat-registration.mjs";
import {githubReadOnlyApi, issueTrustedRecoveryEvidence, verifyTrustedRecoveryEvidence} from "../src/lib/macos-trusted-recovery-evidence.mjs";
import {isMacosFreshFirstInstallBootstrap} from "../src/lib/macos-existing-instance-recovery.mjs";

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
  const context=vm.createContext({crypto,os,fs,path,process,canonicalInstallationId,hasMacosPersonalUsePolicy,macosPersonalUsePolicyChallenge,isMacosFreshFirstInstallBootstrap,inspectMacosRunnerBootstrap:()=>{throw Error("No real inspector in synthetic test");},macosRuntimeAction:()=>{throw Error("No real service in synthetic test");},saveState:()=>{throw Error("No real installer state in synthetic test");}});
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

test("official setup presents scoped approval before legacy evidence in fresh-first bootstrap",()=>{
  const begin=cli.indexOf("function runSetup() {");
  const end=cli.indexOf("\n  state.installation_id ||= crypto.randomUUID();",begin);
  const mac=cli.slice(begin,end);
  assert.ok(mac.indexOf("isMacosFreshFirstInstallBootstrap") < mac.indexOf("macos_setup_approval"));
  assert.ok(mac.indexOf("freshFirstInstall&&!state.macos_setup_approved") < mac.indexOf("macosTrustedRecoveryEvidence(state"));
  assert.match(mac,/!freshFirstInstall&&earlyTrustedEvidence\.status===\"NEEDS_HUMAN_LEGACY\"/);
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
  const issue={number:511,html_url:state.sandbox_chat_registration_issue,url:state.sandbox_chat_registration_issue,state:"open",title:`[CHAT-REGISTER] INSTALL-CHAT-${state.instance_id}-${state.sandbox_project_key}-${hash}`,user:{login:state.github_login,id:42},body:JSON.stringify({project:state.sandbox_project_key,chat_url:state.reviewer_chat_url,installation_id:state.installation_id})};
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
    return {ok:true,stdout:JSON.stringify(settings.issueListEmpty||settings.firstEver?[]:[{...issue,state:"OPEN"}])};
  };
  const context=vm.createContext({
    crypto,path,os:{...os,homedir:()=>f.home},process:{platform:"darwin",cwd:()=>f.home},
    canonicalInstallationId,findRegisteredChatRoute,normalizeChatUrl,githubReadOnlyApi,issueTrustedRecoveryEvidence,
    isMacosFreshFirstInstallBootstrap,
    loadState:()=>state,ensureStateLanguage:()=>"en",saveState:actual=>{assert.equal(actual.target_environment_ready,false);saved.push(JSON.parse(JSON.stringify(actual)));},
    emit:(result,code=0)=>({result,code}),
    macosRecoveryReport:()=>({status:"NEEDS_VERIFICATION",instance_ids:[state.instance_id],instances:[{identity}]}),
    macosTrustedRecoveryEvidence:(actual,{requireReceipt})=>verifyTrustedRecoveryEvidence({state:actual,home:f.home,githubApi:api,requireReceipt}),
    macosPrerequisites:()=>{calls.push("prerequisites");if(settings.queueDuringPrerequisites){queueRoute();deliverRoute();settings.queueDuringPrerequisites=false;}if(settings.offlineAfterFirstProof)settings.offline=true;return {node:true,git:true,gh:true,codex:true,session_auth:true,github_auth:true,native_helper:{status:"PASS"}};},
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
      if(endpoint===`repos/${state.control_repository}/issues/511`)value=api.getIssue(state.control_repository,511);
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
