#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSafeSync } from "./lib/spawn-safe.mjs";
import { loadState as readInstallerState, saveState as writeInstallerState, stateRoot } from "./lib/state.mjs";
import { t, normalizeLanguage } from "./lib/i18n.mjs";
import { ERROR_CATALOG } from "./lib/errors.mjs";
import { sanitizeObject } from "./lib/sanitize.mjs";
import { submitDiagnosticReport } from "./lib/reporting.mjs";
import { prepareControlEnvironment, activateTargetProject, upgradeControlEnvironment, refreshControlRuntime, verifyMacosGeneratedRepositories, githubLogin as authenticatedGithubLogin } from "./lib/control-env.mjs";
import { renderProjectInstructions } from "./lib/project-instructions.mjs";
import { ensureInstallerChatRegistration, findRegisteredChatRoute, normalizeChatUrl } from "./lib/chat-registration.mjs";
import { pendingCallbackCount, doctorHealth, repairHealth } from "./lib/runtime-health.mjs";
import { macosPrerequisites, migrationPreflight, macosRuntimeAction, prepareMigrationIntent } from "./lib/macos-platform.mjs";
import { macosNativeHelperPreflight, prepareMacosNativeHelper, verifyMacosNativeCapability } from "./lib/macos-native-helper-install.mjs";
import { inspectMacosExistingInstanceRecovery, inspectMacosSelectedFreshInstance, approveMacosSelectedFreshInstance } from "./lib/macos-existing-instance-recovery.mjs";
import { MACOS_PERSONAL_USE_POLICY, hasMacosPersonalUsePolicy, macosPersonalUsePolicyChallenge } from "./lib/macos-personal-use-service.mjs";
import { inspectMacosRunnerBootstrap, approveMacosRunnerBootstrap } from "./lib/macos-runner-bootstrap.mjs";
import { verifyTrustedRecoveryEvidence, issueTrustedRecoveryEvidence, githubReadOnlyApi } from "./lib/macos-trusted-recovery-evidence.mjs";
import { canonicalInstallationId } from "./lib/control-render.mjs";
import {
  sandboxSmokeStatus,
  startSandboxSmoke,
  createSandboxCodeReview,
  createSandboxMergeApproval
} from "./lib/sandbox-smoke.mjs";

const argv = process.argv.slice(2);
const command = argv[0] || "help";
const wantsJson = argv.includes("--json");
const productConfig = JSON.parse(fs.readFileSync(new URL("../product.json", import.meta.url),"utf8"));

function macosStateFile({create=false}={}){
  const root=path.resolve(stateRoot({create:false})),home=path.resolve(os.homedir());
  if(!root.startsWith(home+path.sep)) throw new Error("macOS installer state must be isolated inside canonical HOME");
  let current=path.parse(root).root;
  for(const part of root.slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    let st;
    try{st=fs.lstatSync(current);}catch(error){if(error.code!=="ENOENT"||!create)throw error;fs.mkdirSync(current,{mode:0o700});st=fs.lstatSync(current);}
    const within=current===home||current.startsWith(home+path.sep);
    if(st.isSymbolicLink()||!st.isDirectory()||(typeof process.getuid==="function"&&st.uid!==process.getuid()&&!(st.uid===0&&!within))||((st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0&&!within))||(current===root&&(st.mode&0o077)!==0)) throw new Error("Unsafe macOS installer state ancestor; permission repair is forbidden");
  }
  const file=path.join(root,"install-state.json");
  try{const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||(typeof process.getuid==="function"&&st.uid!==process.getuid())||(st.mode&0o777)!==0o600) throw new Error("Unsafe macOS installer state file");}
  catch(error){if(error.code!=="ENOENT")throw error;}
  return file;
}

const macosStateOwners=new WeakMap();
function macosStateRevision(state){const revision=Number(state?.state_revision);return Number.isSafeInteger(revision)&&revision>=0?revision:0;}
function macosReadRevision(file){let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const value=JSON.parse(fs.readFileSync(fd,"utf8"));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("macOS installer state is contradictory");return macosStateRevision(value);}finally{if(fd!==undefined)fs.closeSync(fd);}}

function loadState(options={}){
  if(process.platform==="darwin"){
    const empty=()=>({schema_version:1,preferred_language:null,current_step:"not_started",completed:[],ready:false});
    let file;
    try{file=macosStateFile();}catch(error){if(error.code!=="ENOENT")throw error;return empty();}
    let fd;
    try{
      const before=fs.lstatSync(file);
      fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
      const opened=fs.fstatSync(fd);
      if(!opened.isFile()||opened.nlink!==1||opened.ino!==before.ino||opened.dev!==before.dev||(opened.mode&0o777)!==0o600||(typeof process.getuid==="function"&&opened.uid!==process.getuid())) throw new Error("macOS installer state changed during read");
      const state=JSON.parse(fs.readFileSync(fd,"utf8"));
      const after=fs.lstatSync(file);
      if(after.isSymbolicLink()||after.ino!==opened.ino||after.dev!==opened.dev||after.nlink!==1||(after.mode&0o777)!==0o600||!state||typeof state!=="object"||Array.isArray(state)) throw new Error("macOS installer state is contradictory");
      macosStateOwners.set(state,macosStateRevision(state));
      return state;
    }catch(error){if(error.code==="ENOENT")return empty();throw error;}
    finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  return readInstallerState(options);
}

function saveState(state){
  if(process.platform!=="darwin") return writeInstallerState(state);
  const file=macosStateFile({create:true});
  const lock=`${file}.lock`;
  try{fs.mkdirSync(lock,{mode:0o700});}catch(error){if(error.code==="EEXIST"){const conflict=new Error("macOS installer state lock is occupied; stale writer rejected");conflict.code="MACOS-STATE-CONFLICT";throw conflict;}throw error;}
  const ownerRevision=macosStateOwners.has(state)?macosStateOwners.get(state):macosStateRevision(state);
  let baselineExists=true,currentRevision=0;
  try{currentRevision=macosReadRevision(file);}
  catch(error){
    if(error.code!=="ENOENT") {try{fs.rmdirSync(lock);}catch{}throw error;}
    baselineExists=false;
    if(ownerRevision!==0){try{fs.rmdirSync(lock);}catch{}const conflict=new Error("macOS installer state changed; stale writer rejected");conflict.code="MACOS-STATE-CONFLICT";throw conflict;}
  }
  if(currentRevision!==ownerRevision){try{fs.rmdirSync(lock);}catch{}const error=new Error("macOS installer state changed; stale writer rejected");error.code="MACOS-STATE-CONFLICT";throw error;}
  const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const nextState={...state,state_revision:ownerRevision+1};
  let fd,renamed=false;
  try{
    fd=fs.openSync(temporary,"wx",0o600);
    try{fs.writeFileSync(fd,JSON.stringify(nextState,null,2)+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);fd=undefined;}
    if(baselineExists){
      if(macosReadRevision(file)!==ownerRevision){const error=new Error("macOS installer state changed; stale writer rejected");error.code="MACOS-STATE-CONFLICT";throw error;}
    }else{
      try{fs.lstatSync(file);const error=new Error("macOS installer state changed; stale writer rejected");error.code="MACOS-STATE-CONFLICT";throw error;}
      catch(error){if(error.code!=="ENOENT")throw error;}
    }
    macosStateFile();
    fs.renameSync(temporary,file);renamed=true;
    const directory=fs.openSync(path.dirname(file),"r");
    try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
    Object.assign(state,nextState);macosStateOwners.set(state,ownerRevision+1);
    fs.rmdirSync(lock);
  }catch(error){
    if(fd!==undefined)try{fs.closeSync(fd);}catch{}
    if(!renamed){try{fs.unlinkSync(temporary);}catch{}try{fs.rmdirSync(lock);}catch{}
    }
    throw error;
  }
}

function valueOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function emit(payload, code = 0) {
  if (wantsJson) process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  else {
    const zh=payload.preferred_language==="zh-CN";
    console.log(payload.message || payload.status || "");
    if(payload.error_id) console.log((zh?"错误编号":"Error ID")+": "+payload.error_id);
    if(payload.current_step) console.log((zh?"当前步骤":"Current step")+": "+payload.current_step);
    if(payload.report_file) console.log((zh?"本地诊断报告":"Local diagnostic report")+": "+payload.report_file);
    if(payload.consent_required_before_upload) {
      console.log(zh?"报告尚未上传。提交前会再次征求你的明确同意。":"The report has not been uploaded. Explicit consent will be requested before submission.");
    }
    if(payload.checks&&typeof payload.checks==="object"){
      console.log("");
      console.log(zh?"检查结果：":"Checks:");
      for(const [key,value] of Object.entries(payload.checks)){
        if(typeof value==="boolean") console.log("  "+(value?"✓":"✗")+" "+key.replaceAll("_"," "));
        else if(key==="pending_callbacks") console.log("  "+key.replaceAll("_"," ")+": "+value);
      }
    }
    if(payload.runtime&&typeof payload.runtime==="object"){
      console.log("");
      console.log(zh?"运行状态：":"Runtime:");
      for(const [key,value] of Object.entries(payload.runtime)){
        if(typeof value==="boolean") console.log("  "+(value?"✓":"✗")+" "+key.replaceAll("_"," "));
        else console.log("  "+key.replaceAll("_"," ")+": "+value);
      }
    }
    if (payload.details) console.log(payload.details);
  }
  process.exitCode = code;
}

function commandExists(name, args = ["--version"]) {
  const result = spawnSafeSync(name, args, { encoding: "utf8" });
  return { ok: result.status === 0, output: (result.stdout || result.stderr || "").trim() };
}

function ensureStateLanguage(state) {
  const requested = valueOf("--language");
  if (requested) state.preferred_language = normalizeLanguage(requested);
  state.preferred_language ||= "en";
  return state.preferred_language;
}

function action(state, actionId, messageKey, extra = {}) {
  state.current_step = actionId;
  saveState(state);
  return {
    status: "NEEDS_USER_ACTION",
    action_id: actionId,
    preferred_language: state.preferred_language,
    message_key: messageKey,
    message: t(state.preferred_language, messageKey),
    resume_command: "node src/cli.mjs resume --json",
    ...extra
  };
}

function macosStateBound(state, recovery) {
  const identity = recovery?.instances?.length === 1 ? recovery.instances[0]?.identity : null;
  const route = state?.sandbox_review_route || state?.review_route;
  const routeBinding = recovery?.instances?.length === 1
    ? recovery.instances[0]?.route_bindings?.find(item => item?.route === route)
    : null;
  if (!state?.installation_id || !state?.instance_id || !state?.instance_root || !state?.control_repository || !state?.sandbox_repository
    || recovery?.status !== "NEEDS_VERIFICATION" || recovery.instance_ids?.length !== 1
    || recovery.missing_verification_gates?.length || !identity
    || !identity.instance_id || !identity.installation_id || !identity.control_repository || !identity.sandbox_repository
    || !route || !routeBinding || routeBinding.status !== "active"
    || routeBinding.project !== state.sandbox_project_key
    || routeBinding.installation_id !== state.installation_id
    || (routeBinding.instance_id !== undefined && routeBinding.instance_id !== state.instance_id)
    || (routeBinding.control_repository !== undefined && routeBinding.control_repository !== state.control_repository)
    || (routeBinding.sandbox_repository !== undefined && routeBinding.sandbox_repository !== state.sandbox_repository)) return false;
  const instanceId = recovery.instance_ids[0];
  const expectedRoot = path.join(path.resolve(os.homedir()), ".chatgpt-codex-orchestrator", "instances", instanceId);
  return canonicalInstallationId(state.installation_id) === instanceId
    && state.instance_id === instanceId
    && state.instance_root === expectedRoot
    && identity.instance_id === state.instance_id
    && identity.installation_id === state.installation_id
    && identity.control_repository === state.control_repository
    && identity.sandbox_repository === state.sandbox_repository;
}

function macosGithubApi() {
  return githubReadOnlyApi({run:args=>{const result=spawnSafeSync("gh",args,{encoding:"utf8",timeout:10000,maxBuffer:1024*1024});return {ok:result.status===0,stdout:result.stdout||"",stderr:result.stderr||""};}});
}

function macosRecoveryReport(state={}) {
  const selected=valueOf("--selected-fresh-instance");
  if(selected!==undefined || state.selected_fresh_instance===true){
    if(selected!==undefined&&selected!==state.instance_id) return {status:"CONFLICT",mutations_performed:false,missing_verification_gates:["exact_selected_instance_id"]};
    return inspectMacosSelectedFreshInstance({state:{...state,selected_fresh_instance:true},home:os.homedir(),githubApi:macosGithubApi()});
  }
  return inspectMacosExistingInstanceRecovery({ home: os.homedir() });
}

function macosBootstrapMayAdvance(state, recovery, evidence) {
  if(recovery?.status==="SELECTED_FRESH_INSTANCE_VERIFIED") return true;
  if (!recovery || recovery.status !== "NEEDS_VERIFICATION" || recovery.instances?.length !== 1) return false;
  if (!["VERIFIED", "NEW_INSTALL_PREPARED", "NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE", "NEW_INSTALL_REGISTRATION_PENDING"].includes(evidence?.status)) return false;
  const identity = recovery.instances[0]?.identity || {};
  const instanceIdMatches = recovery.instance_ids?.length === 1 && recovery.instance_ids[0] === state?.instance_id;
  const root = path.join(path.resolve(os.homedir()), ".chatgpt-codex-orchestrator", "instances", String(state?.instance_id || ""));
  return Boolean(state?.instance_id && state?.installation_id && state?.control_repository && state?.sandbox_repository &&
    instanceIdMatches && path.resolve(String(state.instance_root || "")) === root &&
    (!identity.instance_id || (identity.instance_id === state.instance_id && identity.installation_id === state.installation_id &&
      identity.control_repository === state.control_repository && identity.sandbox_repository === state.sandbox_repository)));
}

function macosSelectedAwaitingFirstRoute(state,recovery){
  // The separate fresh-instance receipt proves the pre-registration identity.
  // A queued first route cannot prove delivery; only the canonical registration
  // owner and its real receipt can make ensureInstallerChatRegistration READY.
  return recovery?.status==="SELECTED_FRESH_INSTANCE_VERIFIED"&&(recovery.route_count===0||recovery.first_route_pending===true)&&!state.sandbox_review_route;
}

function macosTrustedRecoveryEvidence(state, { requireReceipt = true } = {}) {
  const api = githubReadOnlyApi({ run: args => { const result = spawnSafeSync("gh", args, { encoding: "utf8" }); return { ok: result.status === 0, stdout: result.stdout || "", stderr: result.stderr || "" }; } });
  return verifyTrustedRecoveryEvidence({ state, home: os.homedir(), githubApi: api, requireReceipt });
}

function macosRunnerActionChallenge(action,state,runner,attempt=1){
  const binding=[state.installation_id,state.instance_id,state.instance_root,state.control_repository,state.control_repository_id,state.sandbox_repository,state.sandbox_repository_id,state.sandbox_project_key,state.runner_label,runner.runner_id,runner.runner_executable,runner.approval_sha256,state.browser_profile,state.browser_port,state.pending_wake_outbox];
  if(attempt!==1)binding.push({proven_rejection_attempt:attempt});
  return action+":"+crypto.createHash("sha256").update(JSON.stringify(binding)).digest("hex");
}

function claimMacosFirstBootOperation({state,action,challenge,home=os.homedir(),attempt=1}){
  if(!["install","start"].includes(action)) return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-CLAIM-ACTION",mutations_performed:false};
  const root=path.join(path.resolve(home),".chatgpt-codex-orchestrator","instances",canonicalInstallationId(state.installation_id));
  if(state.instance_root!==root) return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-CLAIM-ROOT",mutations_performed:false};
  let current=path.parse(root).root;
  for(const part of root.slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    const st=fs.lstatSync(current),inside=current===path.resolve(home)||current.startsWith(path.resolve(home)+path.sep);
    if(st.isSymbolicLink()||!st.isDirectory()||(typeof process.getuid==="function"&&st.uid!==process.getuid()&&!(st.uid===0&&!inside))||((st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0&&!inside))||(current===root&&(st.mode&0o777)!==0o700)) return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-CLAIM-PATH",mutations_performed:false};
  }
  if(!Number.isSafeInteger(attempt)||attempt<1||attempt>8)return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-ATTEMPT-BOUND",mutations_performed:false};
  const file=path.join(root,`macos-runner-${action}${attempt===1?"":`-attempt-${attempt}`}-claim.json`);
  let fd,created=false;
  try{
    fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);created=true;
    fs.writeFileSync(fd,JSON.stringify({schema_version:1,installation_id:state.installation_id,instance_id:state.instance_id,action,attempt,challenge,pid:process.pid,claimed_at:new Date().toISOString()})+"\n");fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    const directory=fs.openSync(root,"r");try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
    // These one-time operation claims are retained permanently. Neither stale
    // PID guesses nor another resume process can reclaim an approved action.
    return {status:"OWNED",path:file,mutations_performed:true};
  }catch(error){return {status:"ERROR",error_id:error.code==="EEXIST"?"MACOS-FIRST-BOOT-ALREADY-CLAIMED":"MACOS-FIRST-BOOT-CLAIM-IO",recovery_status:"MANUAL_RECOVERY_REQUIRED",claim_path:file,mutations_performed:created?"UNKNOWN":false};}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}

// Only the official installer invokes these service gates. The journal is an
// intent/result record, never a replacement for live runner or PID evidence.
function advanceMacosFirstBootRunner(state,{inspect=inspectMacosRunnerBootstrap,runtime=macosRuntimeAction,persist=saveState,claim=claimMacosFirstBootOperation,home=os.homedir()}={}){
  const runner=inspect({state,home,requireOnline:false});
  if(runner.error_id==="MACOS-RUNNER-PROVISIONING-REQUIRED"){
    const candidate=inspect({state,home,requireOnline:false,requireApproval:false});
    if(candidate.action_id==="macos_runner_package_approval"&&candidate.approval_challenge) return {...candidate,message:"Review and separately approve this exact official package and independently registered Runner identity. Installation and start require further approvals."};
  }
  if(runner.status!=="PASS") return {...runner,action_id:runner.action_id||"provision_macos_runner",message:"The exact approved official macOS ARM64 Runner package and registration are required before installation or CHAT-REGISTER."};
  let journal=state.macos_runner_bootstrap;
  const installChallenge=macosRunnerActionChallenge("install",state,runner);
  const startChallenge=macosRunnerActionChallenge("start",state,runner);
  if(journal&&journal.install_challenge!==installChallenge) return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-IDENTITY",recovery_status:"MANUAL_RECOVERY_REQUIRED",mutations_performed:false};
  if(!hasMacosPersonalUsePolicy(state))return {status:"NEEDS_USER_ACTION",action_id:"macos_personal_use_service_policy",approval_challenge:macosPersonalUsePolicyChallenge(state),mutations_performed:false,message:"Select the personal Mac policy: trust this account and same-UID processes, execute only owner-authorized private Control tasks, and make no claim against an attacker controlling this account."};
  // The reviewed immutable-import refusal is known to precede any mutation.
  // No other legacy error is inferred safe merely from a false mutation flag.
  if(journal?.phase==="ERROR"&&journal.result?.mutations_performed===false&&(journal.result.pre_mutation_rejection===true&&journal.result.service_action_state==="NOT_ATTEMPTED"||journal.result.error_id==="MACOS-LAUNCHCTL-IMMUTABLE-IMPORT-REQUIRED")) {
    const operation=journal.operation||journal.result.action||(journal.result.error_id==="MACOS-LAUNCHCTL-IMMUTABLE-IMPORT-REQUIRED"?"start":null);
    if(!["install","start"].includes(operation))return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-JOURNAL",mutations_performed:false,recovery_status:"MANUAL_RECOVERY_REQUIRED"};
    state.macos_runner_bootstrap={...journal,phase:"REJECTED",rejected_operation:operation,original_rejection_journal:journal.original_rejection_journal||JSON.parse(JSON.stringify(journal)),rejections:[...(journal.rejections||[]),{operation,result:journal.result,at:journal.at}]};
    try{persist(state);}catch{return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-RECONCILE-PERSIST",mutations_performed:"UNKNOWN",recovery_status:"MANUAL_RECOVERY_REQUIRED"};}
    journal=state.macos_runner_bootstrap;
  }
  if(journal&&["INSTALL_INTENT","START_INTENT","ERROR"].includes(journal.phase)) return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-INTERRUPTED",recovery_status:"MANUAL_RECOVERY_REQUIRED",journal,mutations_performed:false,message:"A service operation has an uncertain outcome. Preserve its journal and independently review the exact LaunchAgent before any retry."};
  const phase=journal?.phase;
  if(phase&&!['PLIST_INSTALLED','STARTED','REJECTED'].includes(phase)) return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-JOURNAL",mutations_performed:false,recovery_status:"MANUAL_RECOVERY_REQUIRED"};
  const operation=!phase?"install":phase==="PLIST_INSTALLED"?"start":phase==="REJECTED"?journal.rejected_operation:null;
  if(operation){
    if(!["install","start"].includes(operation))return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-JOURNAL",mutations_performed:false};
    const attempt=1+(journal?.rejections||[]).filter(entry=>entry.operation===operation).length;
    if(attempt>8)return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-ATTEMPT-BOUND",mutations_performed:false,recovery_status:"MANUAL_RECOVERY_REQUIRED"};
    const challenge=macosRunnerActionChallenge(operation,state,runner,attempt);
    if(state.macos_runner_action_approval!==challenge) return {status:"NEEDS_USER_ACTION",action_id:`macos_runner_${operation}`,approval_challenge:challenge,runner_id:runner.runner_id,runner_executable:runner.runner_executable,mutations_performed:false,message:operation==="start"?"Approve activation of this exact Runner and normal restart on user login under the selected personal-use policy.":"Approve installation of this exact inactive LaunchAgent; installation grants no execution or login restart consent."};
    const actionState={...state,macos_action_approval:operation,macos_activation_challenge:state.macos_runner_activation?.challenge};
    let checked;
    try{checked=runtime(operation,{state:actionState,home,preflightOnly:true});}catch(error){return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-PREFLIGHT",mutations_performed:false,details:String(error.message||error)};}
    if(checked.status!=="PASS")return {...checked,mutations_performed:false};
    if(checked.preflight_only!==true||checked.mutations_performed!==false)return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-PREFLIGHT-CONTRACT",mutations_performed:"UNKNOWN",recovery_status:"MANUAL_RECOVERY_REQUIRED"};
    let ownership;
    try{ownership=claim({state,action:operation,challenge,home,attempt});}catch(error){return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-CLAIM-IO",recovery_status:"MANUAL_RECOVERY_REQUIRED",mutations_performed:"UNKNOWN"};}
    if(ownership.status!=="OWNED") return ownership;
    delete state.macos_runner_action_approval;
    delete state.macos_action_approval;
    state.macos_runner_bootstrap={...journal,phase:operation==="install"?"INSTALL_INTENT":"START_INTENT",install_challenge:installChallenge,start_challenge:operation==="start"?challenge:startChallenge,operation,attempt,claim_path:ownership.path,runner_id:runner.runner_id,at:new Date().toISOString()};
    try{persist(state);}catch(error){return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-INTENT-PERSIST",recovery_status:"MANUAL_RECOVERY_REQUIRED",claim_path:ownership.path,mutations_performed:true};} // Consume approval and record intent before launchctl/files.
    let result;
    try { result=runtime(operation,{state:{...state,macos_action_approval:operation,macos_activation_challenge:state.macos_runner_activation?.challenge},home}); }
    catch(error){result={status:"ERROR",error_id:"MACOS-FIRST-BOOT-IO",details:String(error.message||error),mutations_performed:"UNKNOWN"};}
    const provenRejected=result.status!=="PASS"&&result.mutations_performed===false&&result.pre_mutation_rejection===true&&result.service_action_state==="NOT_ATTEMPTED";
    const intent=state.macos_runner_bootstrap;
    state.macos_runner_bootstrap={...intent,...(provenRejected?{rejected_operation:operation,original_rejection_journal:journal?.original_rejection_journal||{...intent,result},rejections:[...(journal?.rejections||[]),{operation,attempt,claim_path:ownership.path,result,at:new Date().toISOString()}]}:{}),phase:result.status==="PASS"?(operation==="install"?"PLIST_INSTALLED":"STARTED"):provenRejected?"REJECTED":"ERROR",result,at:new Date().toISOString()};
    try{persist(state);}catch(error){return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-RESULT-PERSIST",recovery_status:"MANUAL_RECOVERY_REQUIRED",claim_path:ownership.path,mutations_performed:"UNKNOWN"};}
    if(result.status!=="PASS") return {...result,recovery_status:provenRejected?"NEW_EXACT_APPROVAL_REQUIRED_OR_INSPECT":"MANUAL_RECOVERY_REQUIRED"};
    if(operation==="install") return {status:"NEEDS_USER_ACTION",action_id:"macos_runner_start",approval_challenge:startChallenge,mutations_performed:true,message:"The exact LaunchAgent is installed. Starting this Runner requires a separate approval."};
  }
  const service=runtime("status",{state,home});
  if(service.status!=="PASS"||service.launchctl_state!=="loaded"||service.plist_verified!==true) return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-SERVICE",service,mutations_performed:false,recovery_status:"MANUAL_RECOVERY_REQUIRED"};
  if(service.listener_running!==true||!service.listener_identity)return {status:"WAITING",action_id:"macos_runner_local_listener",runner_state:service.runner_state||"loaded-idle",mutations_performed:false,message:"The approved job is loaded; a matching native supervised listener has not been verified. CHAT-REGISTER has not been published."};
  const online=inspect({state,home,requireOnline:true});
  if(online.status!=="PASS") return {...online,status:online.status==="NEEDS_USER_ACTION"?"WAITING":online.status,action_id:"macos_runner_online",mutations_performed:false,message:"Waiting for this exact registered macOS ARM64 Runner to be online; CHAT-REGISTER has not been published."};
  const finalService=runtime("status",{state,home});
  if(!online.local_listener_identity||JSON.stringify(online.local_listener_identity)!==JSON.stringify(service.listener_identity)||finalService.status!=="PASS"||finalService.plist_verified!==true||finalService.listener_running!==true||JSON.stringify(finalService.listener_identity)!==JSON.stringify(service.listener_identity))return {status:"ERROR",error_id:"MACOS-FIRST-BOOT-NATIVE-IDENTITY",mutations_performed:false,recovery_status:"INSPECT_ONLY_NO_AUTOMATIC_RETRY"};
  return {status:"READY",runner:online,mutations_performed:false};
}


function dryRun() {
  let state;
  try { state=loadState({create:false}); }
  catch (error) {
    if (process.platform !== "darwin") throw error;
    const existingInstanceRecovery=process.platform==="darwin"?macosRecoveryReport():null;
    return emit({status:"ERROR",error_id:"MACOS-EXISTING-INSTANCE-REVIEW",preferred_language:"en",message:"macOS installer state is unreadable; dry-run stopped before any external setup action.",dry_run:true,existing_instance_recovery:existingInstanceRecovery,mutations_performed:false,plan:[]},1);
  }
  const lang=ensureStateLanguage(state);
  const existingInstanceRecovery=process.platform==="darwin"?macosRecoveryReport(state):null;
  if(existingInstanceRecovery?.selection_mode&&existingInstanceRecovery.status!=="SELECTED_FRESH_INSTANCE_VERIFIED") return emit({status:existingInstanceRecovery.status==="CONFLICT"?"ERROR":"NEEDS_USER_ACTION",action_id:"macos_selected_fresh_instance_approval",error_id:"MACOS-SELECTED-FRESH-INSTANCE",dry_run:true,existing_instance_recovery:existingInstanceRecovery,approval_challenge:existingInstanceRecovery.approval_challenge,mutations_performed:false,plan:[]},1);
  const trustedRecoveryEvidence=process.platform==="darwin"?macosTrustedRecoveryEvidence(state,{requireReceipt:Boolean(state.sandbox_review_route)}):null;
  if(existingInstanceRecovery && existingInstanceRecovery.status!=="ABSENT" && !macosBootstrapMayAdvance(state, existingInstanceRecovery, trustedRecoveryEvidence) && (!macosStateBound(state, existingInstanceRecovery) || existingInstanceRecovery.status==="CONFLICT")) {
    return emit({status:existingInstanceRecovery.status==="CONFLICT"?"ERROR":"NEEDS_USER_ACTION",error_id:"MACOS-EXISTING-INSTANCE-REVIEW",preferred_language:lang,message:"macOS existing-instance recovery requires a separate reviewed action; dry-run stopped before any external command.",dry_run:true,mutations_performed:false,existing_instance_recovery:existingInstanceRecovery,plan:[]},1);
  }
  if(trustedRecoveryEvidence?.status==="CONFLICT") return emit({status:"ERROR",error_id:"MACOS-TRUSTED-RECOVERY-EVIDENCE",preferred_language:lang,message:"Trusted macOS recovery evidence is contradictory; dry-run stopped before prerequisite checks or any external setup action.",dry_run:true,existing_instance_recovery:existingInstanceRecovery,trusted_recovery_evidence:trustedRecoveryEvidence,mutations_performed:false,plan:[]},1);
  if(trustedRecoveryEvidence?.status==="NEEDS_HUMAN_LEGACY"&&!macosSelectedAwaitingFirstRoute(state,existingInstanceRecovery)) return emit({status:"NEEDS_HUMAN",error_id:"MACOS-TRUSTED-RECOVERY-EVIDENCE",preferred_language:lang,message:"Historical macOS artifacts require a separate human-approved recovery procedure; no adoption or mutation was performed.",dry_run:true,existing_instance_recovery:existingInstanceRecovery,trusted_recovery_evidence:trustedRecoveryEvidence,mutations_performed:false,plan:[]},1);
  const git=commandExists("git");
  const node=commandExists("node");
  const gh=commandExists("gh");
  const codex=commandExists("codex");
  const ghAuth=gh.ok?commandExists("gh",["auth","status"]):{ok:false};

  const mac=process.platform==="darwin"?macosPrerequisites():null;
  const plan=[
    {
      step:"prerequisites",
      automatic:true,
      current:{
        git:git.ok,
        node:node.ok,
        github_cli:gh.ok,
        codex:codex.ok,
        ...(mac?{node_22_or_newer:mac.node,session_auth:mac.session_auth,native_helper_preflight:mac.native_helper}: {})
      },
      action:"Install any supported missing prerequisites automatically."
    },
    {
      step:"github_cli_sign_in",
      automatic:false,
      required:!ghAuth.ok,
      action:"Ask the user to complete GitHub sign-in only if it is not already authenticated."
    },
    {
      step:"github_plugin_authorization",
      automatic:false,
      required:!state.github_plugin_authorized,
      action:"Ask the user to connect/authorize the GitHub Plugin in ChatGPT."
    },
    {
      step:"project_selection",
      automatic:false,
      required:!state.target_repository,
      current_repository:state.target_repository||null,
      action:"Ask for one GitHub repository in owner/repository form."
    },
    {
      step:"reviewer_chat",
      automatic:false,
      required:!state.reviewer_chat_url,
      action:"Ask for the reviewer ChatGPT conversation URL."
    },
    {
      step:"isolated_control_environment",
      automatic:true,
      action:"Create a private control repository, private sandbox repository, isolated local paths, isolated runner label and isolated browser profile."
    },
    ...(process.platform==="darwin"?[
      {step:"official_macos_runner_provisioning",automatic:false,action:"Separately approve official ARM64 runner acquisition/registration and exact immutable package/repository/runner identities. This adapter does not acquire or register a runner."},
      {step:"macos_runner_install",automatic:false,action:"Approve only installation of the canonical LaunchAgent after exact generated-repository authorization and live native PID capability."},
      {step:"macos_runner_start",automatic:false,action:"Approve start separately. Publish the first CHAT-REGISTER only after GitHub independently reports the exact matching macOS ARM64 runner online."}
    ]:[]),
    {
      step:"sandbox_end_to_end",
      automatic:"mixed",
      action:"Run implementation, wrapper validation and independent Code Review in the generated sandbox only. Require explicit approval before the sandbox-only merge."
    },
    {
      step:"real_project_activation",
      automatic:true,
      gated_by:"sandbox_complete",
      action:"Keep the real project disabled until the sandbox is complete, then create its checkpoint branch and activate orchestration."
    },
    {
      step:"project_folder_trust",
      automatic:false,
      action:"Ask the user to approve Codex trust for the real project only after sandbox verification."
    }
  ];

  emit({
    status:"PASS",
    preferred_language:lang,
    message:lang==="zh-CN"?"安装预演完成，没有修改任何 GitHub repository、runner 或项目。":"Installation dry-run complete. No GitHub repository, runner or project was modified.",
    dry_run:true,
    mutations_performed:false,
    existing_instance_recovery:existingInstanceRecovery,
    trusted_recovery_evidence:trustedRecoveryEvidence,
    migration_preflight:process.platform==="darwin"?migrationPreflight({state}):null,
    macos_native_helper:process.platform==="darwin"?macosNativeHelperPreflight({state,installationId:state.installation_id}):null,
    plan
  });
}

function answer() {
  const state = loadState();
  const lang = ensureStateLanguage(state);
  const actionId = valueOf("--action");
  const value = valueOf("--value");
  const controlRepository = valueOf("--control-repository");
  const sandboxRepository = valueOf("--sandbox-repository");
  const verificationRoute = valueOf("--verification-route");
  const currentChatUrl = valueOf("--chat-url") || verificationRoute;

  const bool = v => /^(true|yes|y|1|done|completed)$/i.test(String(v || ""));

  if(actionId === "macos_selected_fresh_instance_approval"){
    if(process.platform!=="darwin"||valueOf("--selected-fresh-instance")!==state.instance_id) return emit({status:"ERROR",error_id:"MACOS-SELECTED-FRESH-APPROVAL",message:"Select the exact prepared fresh instance ID for this separate approval.",mutations_performed:false},1);
    try{
      const selectedState={...state,selected_fresh_instance:true};
      const receipt=approveMacosSelectedFreshInstance({state:selectedState,approval:value,home:os.homedir(),githubApi:macosGithubApi()});
      state.selected_fresh_instance=true;
      Object.assign(state,{control_repository_id:receipt.provenance.control_repository_id,sandbox_repository_id:receipt.provenance.sandbox_repository_id});
      state.current_step="macos_selected_fresh_instance_verified";
    }catch(error){return emit({status:"ERROR",error_id:"MACOS-SELECTED-FRESH-APPROVAL",message:String(error.message||error),mutations_performed:"UNKNOWN"},1);}
  } else if(actionId === "macos_runner_package_approval"){
    if(process.platform!=="darwin") return emit({status:"ERROR",error_id:"MACOS-RUNNER-PLATFORM",mutations_performed:false},1);
    const report=macosRecoveryReport(state);
    if(report.status!=="ABSENT"&&!macosBootstrapMayAdvance(state,report,macosTrustedRecoveryEvidence(state,{requireReceipt:false}))) return emit({status:"ERROR",error_id:"MACOS-EXISTING-INSTANCE-REVIEW",mutations_performed:false,existing_instance_recovery:report},1);
    const approval=approveMacosRunnerBootstrap({state,approval:value,home:os.homedir()});
    if(approval.status!=="PASS") return emit(approval,1);
    state.current_step="macos_runner_install";
  } else if(actionId==="macos_personal_use_service_policy"){
    if(process.platform!=="darwin"||state.macos_setup_approved!==true||value!==macosPersonalUsePolicyChallenge(state))return emit({status:"ERROR",error_id:"MACOS-PERSONAL-USE-POLICY-APPROVAL",mutations_performed:false},1);
    const verified=inspectMacosRunnerBootstrap({state,home:os.homedir()});
    if(verified.status!=="PASS")return emit(verified,1);
    state.macos_service_policy={schema_version:1,policy:MACOS_PERSONAL_USE_POLICY,selected_through:"official-installer",installation_id:state.installation_id,github_login:state.github_login,control_repository:state.control_repository,control_repository_id:String(state.control_repository_id),approval:value,approved_at:new Date().toISOString()};
    state.current_step="macos_runner_install";
  } else if(["macos_runner_install","macos_runner_start"].includes(actionId)){
    if(process.platform!=="darwin") return emit({status:"ERROR",error_id:"MACOS-RUNNER-PLATFORM",mutations_performed:false},1);
    const runner=inspectMacosRunnerBootstrap({state,home:os.homedir()});
    const operation=actionId==="macos_runner_install"?"install":"start";
    const phase=state.macos_runner_bootstrap?.phase;
    const journal=state.macos_runner_bootstrap;
    const expectedPhase=(operation==="install"?phase===undefined:phase==="PLIST_INSTALLED")||phase==="REJECTED"&&journal.rejected_operation===operation;
    const attempt=1+(journal?.rejections||[]).filter(entry=>entry.operation===operation).length;
    if(runner.status!=="PASS"||!hasMacosPersonalUsePolicy(state)||!expectedPhase||attempt>8||value!==macosRunnerActionChallenge(operation,state,runner,attempt)) return emit({status:"ERROR",error_id:"MACOS-RUNNER-ACTION-APPROVAL",message:"Approval must match the current exact package, Runner, repositories, installation, and next service action.",mutations_performed:false},1);
    state.macos_runner_action_approval=value;
    if(operation==="start")state.macos_runner_activation={installation_id:state.installation_id,runner_id:runner.runner_id,approval_sha256:runner.approval_sha256,challenge:value,login_restart_approved:true,approved_at:new Date().toISOString()};
    state.current_step=actionId;
  } else if (actionId === "macos_setup_approval") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"MACOS-APPROVAL-001",recoverable:false,preferred_language:lang,message:"macOS setup approval was not confirmed."},1);
    state.macos_setup_approved=true;
    state.current_step="macos_native_activation";
  } else if (actionId === "github_plugin_authorization" || actionId === "github_authorization") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-001",recoverable:true,preferred_language:lang,message:t(lang,"answer.github.invalid")},1);
    state.github_plugin_authorized = true;
  } else if (actionId === "target_repository") {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || ""))) {
      return emit({status:"ERROR",error_id:"SETUP-005",recoverable:true,preferred_language:lang,message:t(lang,"answer.repository.invalid")},1);
    }
    state.target_repository = value;
  } else if (actionId === "reviewer_chat_url") {
    if (!/^https:\/\/chatgpt\.com\//i.test(String(value || ""))) {
      return emit({status:"ERROR",error_id:"SETUP-006",recoverable:true,preferred_language:lang,message:t(lang,"answer.chat.invalid")},1);
    }
    state.reviewer_chat_url = value;
  } else if (actionId === "generated_repo_authorization") {
    if (process.platform !== "darwin") {
      if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-005",recoverable:true,preferred_language:lang,message:t(lang,"answer.generated_repo.invalid")},1);
      state.generated_repo_authorized = true;
    } else {
      const exact = x => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(x || ""));
      const canonicalChat = /^https:\/\/chatgpt\.com\/(?:g\/[A-Za-z0-9_-]+\/)?c\/[A-Za-z0-9-]+\/?$/i;
      if (value || !exact(controlRepository) || !exact(sandboxRepository) || !canonicalChat.test(String(currentChatUrl || ""))) {
        return emit({status:"ERROR",error_id:"AUTH-005",recoverable:true,preferred_language:lang,message:"macOS generated-repository authorization requires exact Control and Sandbox repositories plus the canonical current Chat URL; a boolean or route name is not proof."},1);
      }
      if (!state.control_environment_ready || controlRepository !== state.control_repository || sandboxRepository !== state.sandbox_repository) {
        return emit({status:"ERROR",error_id:"AUTH-006",recoverable:true,preferred_language:lang,message:"Exact generated repositories do not match the prepared private Control/Sandbox pair."},1);
      }
      if (currentChatUrl !== state.reviewer_chat_url) {
        return emit({status:"ERROR",error_id:"AUTH-007",recoverable:true,preferred_language:lang,message:"Authorization provenance must match the saved originating Chat URL exactly."},1);
      }
      let identities;
      try{identities=verifyMacosGeneratedRepositories({state});}
      catch(error){return emit({status:"ERROR",error_id:"AUTH-008",message:"Generated repository immutable owner identities could not be verified independently.",details:String(error.message||error),mutations_performed:false},1);}
      Object.assign(state,identities);
      state.github_plugin_authorization_verified = true;
      state.github_plugin_authorization_control_repository = controlRepository;
      state.github_plugin_authorization_sandbox_repository = sandboxRepository;
      state.github_plugin_authorization_chat_url = currentChatUrl;
      state.github_plugin_authorization_installation_id = state.installation_id;
      state.generated_repo_authorized = true;
    }
  } else if (actionId === "codex_trust_sandbox") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-002",recoverable:true,preferred_language:lang,message:t(lang,"answer.codex.invalid")},1);
    state.codex_trust_sandbox = true;
  } else if (actionId === "codex_trust_project") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-002",recoverable:true,preferred_language:lang,message:t(lang,"answer.codex.invalid")},1);
    state.codex_trust_project = true;
  } else if (actionId === "reviewer_browser_login") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"SETUP-012",recoverable:true,preferred_language:lang,message:t(lang,"answer.browser.invalid")},1);
    state.reviewer_browser_ready = true;
  } else if (actionId === "chatgpt_project_instructions") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"SETUP-007",recoverable:true,preferred_language:lang,message:t(lang,"answer.instructions.invalid")},1);
    state.instructions_added = true;
  } else if (actionId === "sandbox_verification") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"SETUP-008",recoverable:true,preferred_language:lang,message:t(lang,"answer.sandbox.invalid")},1);
    state.sandbox_verified = true;
  } else {
    return emit({status:"ERROR",error_id:"SETUP-009",recoverable:false,preferred_language:lang,message:t(lang,"answer.action.unknown")},1);
  }

  saveState(state);
  emit({
    status:"PASS",
    preferred_language:lang,
    message:t(lang,"answer.saved"),
    action_id:actionId,
    resume_command:"node src/cli.mjs resume --json"
  });
}

function runSetup() {
  let state;
  try { state = loadState({create:process.platform!=="darwin"}); }
  catch(error) {
    if(process.platform!=="darwin") throw error;
    return emit({status:"ERROR",error_id:"MACOS-EXISTING-INSTANCE-REVIEW",recoverable:false,preferred_language:"en",message:"macOS installer state is unreadable; existing-instance review is required before setup can continue.",details:"Malformed or unreadable installer state",mutations_performed:false},1);
  }
  const lang = ensureStateLanguage(state);
  if(process.platform==="darwin") {
    const existingInstanceRecovery=macosRecoveryReport(state);
    if(existingInstanceRecovery.selection_mode&&existingInstanceRecovery.status!=="SELECTED_FRESH_INSTANCE_VERIFIED") return emit({status:existingInstanceRecovery.status==="CONFLICT"?"ERROR":"NEEDS_USER_ACTION",action_id:"macos_selected_fresh_instance_approval",error_id:"MACOS-SELECTED-FRESH-INSTANCE",preferred_language:lang,existing_instance_recovery:existingInstanceRecovery,approval_challenge:existingInstanceRecovery.approval_challenge,mutations_performed:false,message:"A separate exact approval of this independently verified fresh instance is required; historical instances confer no authority."},1);
    const earlyTrustedEvidence=macosTrustedRecoveryEvidence(state,{requireReceipt:false});
    const pendingFirstRegistration=earlyTrustedEvidence.status==="NEW_INSTALL_REGISTRATION_PENDING";
    if(existingInstanceRecovery.status!=="ABSENT" && !macosBootstrapMayAdvance(state, existingInstanceRecovery, earlyTrustedEvidence) && (!macosStateBound(state, existingInstanceRecovery) || existingInstanceRecovery.status==="CONFLICT")) return emit({status:existingInstanceRecovery.status==="CONFLICT"?"ERROR":"NEEDS_USER_ACTION",error_id:"MACOS-EXISTING-INSTANCE-REVIEW",recoverable:existingInstanceRecovery.status!=="CONFLICT",preferred_language:lang,message:"An existing macOS instance was found without authoritative binding evidence. Setup/resume stopped before installer state, migration intent, Control, Sandbox, runner, or helper changes.",existing_instance_recovery:existingInstanceRecovery,mutations_performed:false},1);
    if(earlyTrustedEvidence.status==="NEEDS_HUMAN_LEGACY"&&!macosSelectedAwaitingFirstRoute(state,existingInstanceRecovery)) return emit({status:"NEEDS_HUMAN",error_id:"MACOS-TRUSTED-RECOVERY-EVIDENCE",recoverable:false,preferred_language:lang,message:"Historical macOS artifacts require a separate human-approved recovery procedure; setup/resume stopped before any mutation.",existing_instance_recovery:existingInstanceRecovery,trusted_recovery_evidence:earlyTrustedEvidence,mutations_performed:false},1);
    const awaitingFirstRoute=earlyTrustedEvidence.status==="NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE";
    if(awaitingFirstRoute){
      const savedIssueValue=state.sandbox_chat_registration_issue;
      const pinnedIssue=String(savedIssueValue??"").trim();
      const firstIssueNotYetSaved=savedIssueValue===undefined||savedIssueValue===null||pinnedIssue==="";
      const pinnedMatch=pinnedIssue.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/i);
      const canonicalIssue=pinnedMatch && pinnedMatch[1]===state.control_repository && Number(pinnedMatch[2])>0 &&
        String(earlyTrustedEvidence.provenance?.control_repository_id||"")===String(state.control_repository_id||"") &&
        String(earlyTrustedEvidence.provenance?.sandbox_repository_id||"")===String(state.sandbox_repository_id||"");
      if(!firstIssueNotYetSaved&&!canonicalIssue) return emit({status:"ERROR",error_id:"MACOS-TRUSTED-RECOVERY-EVIDENCE",recoverable:false,preferred_language:lang,message:"The pinned first registration Issue is malformed or conflicts with the verified installation identity; setup stopped before any macOS side effect.",trusted_recovery_evidence:earlyTrustedEvidence,mutations_performed:false},1);
      if(!firstIssueNotYetSaved) return emit({status:"WAITING",action_id:"sandbox_chat_registration",recoverable:true,preferred_language:lang,message:"The first Sandbox registration Issue is pinned; queue the explicit originating-Chat route before resume.",registration_issue:pinnedIssue,trusted_recovery_evidence:earlyTrustedEvidence,mutations_performed:false});
    }
    if(pendingFirstRegistration){
      const delivered=findRegisteredChatRoute(state,{projectKey:state.sandbox_project_key,chatUrl:state.reviewer_chat_url});
      if(!delivered || delivered.registration_issue!==earlyTrustedEvidence.provenance.registration_issue_id) return emit({status:"WAITING",action_id:"sandbox_chat_registration",recoverable:true,preferred_language:lang,message:"The first Sandbox registration is queued; its real originating Chat delivery receipt is still required before resume.",registration_issue:state.sandbox_chat_registration_issue,trusted_recovery_evidence:earlyTrustedEvidence,mutations_performed:false});
    }
    const prerequisites=macosPrerequisites();
    const trustedEvidence=macosTrustedRecoveryEvidence(state,{requireReceipt:false});
    if((pendingFirstRegistration && trustedEvidence.status!=="NEW_INSTALL_REGISTRATION_PENDING") || (trustedEvidence.status!=="ABSENT" && trustedEvidence.status!=="NEW_INSTALL_PREPARED" && trustedEvidence.status!=="NEW_INSTALL_CONTROL_PREPARED_AWAITING_ROUTE" && trustedEvidence.status!=="NEW_INSTALL_REGISTRATION_PENDING" && trustedEvidence.status!=="NEEDS_HUMAN_LEGACY" && trustedEvidence.status!=="VERIFIED")) return emit({status:"ERROR",error_id:"MACOS-TRUSTED-RECOVERY-EVIDENCE",recoverable:false,preferred_language:lang,message:"Trusted recovery evidence is contradictory; setup stopped before any macOS side effect.",trusted_recovery_evidence:trustedEvidence,mutations_performed:false},1);
    const latestPending=trustedEvidence.status==="NEW_INSTALL_REGISTRATION_PENDING";
    const pinnedFirstIssue=String(state.sandbox_chat_registration_issue||"").trim();
    if(latestPending){
      const savedIssue=String(state.sandbox_chat_registration_issue||"");
      const savedIssueId=Number(savedIssue.match(/\/issues\/(\d+)(?:$|[?#])/i)?.[1]||savedIssue.match(/^\d+$/)?.[0]||0);
      const provenance=trustedEvidence.provenance||{};
      const identityProof=String(provenance.control_repository_id||"")===String(state.control_repository_id||"") && String(provenance.sandbox_repository_id||"")===String(state.sandbox_repository_id||"") && savedIssueId>0 && Number(provenance.registration_issue_id)===savedIssueId;
      const delivered=findRegisteredChatRoute(state,{projectKey:state.sandbox_project_key,chatUrl:state.reviewer_chat_url});
      let routeProof=false;
      try { routeProof=Boolean(delivered && String(delivered.installation_id)===String(state.installation_id) && Number(delivered.registration_issue)===savedIssueId && String(delivered.project)===String(state.sandbox_project_key) && normalizeChatUrl(delivered.chat_url)===normalizeChatUrl(state.reviewer_chat_url)); } catch {}
      if(!identityProof || !routeProof) return emit({status:"WAITING",action_id:"sandbox_chat_registration",recoverable:true,preferred_language:lang,message:"The first Sandbox registration Issue is pinned; exact originating Chat delivery proof is required before resume.",registration_issue:state.sandbox_chat_registration_issue||null,trusted_recovery_evidence:trustedEvidence,mutations_performed:false});
    }
    const migration=migrationPreflight({state});
    const ready=prerequisites.node&&prerequisites.git&&prerequisites.gh&&prerequisites.codex&&prerequisites.session_auth&&prerequisites.native_helper?.status==="PASS"&&migration.status==="READY";
    if(!ready) return emit({status:"ERROR",error_id:"MACOS-PREREQUISITE-OR-MIGRATION",recoverable:true,preferred_language:lang,mutations_performed:false,message:"macOS preflight found a prerequisite or migration conflict; no installation mutation was performed.",prerequisites,migration},1);
    if(!state.macos_setup_approved) return emit(action(state,"macos_setup_approval","setup.macos.approval",{mutations_performed:false,details:"Approval is required before native setup can write instance state or a LaunchAgent."}));
    if(!prerequisites.github_auth) return emit(action(state,"github_cli_authorization","setup.github_cli.connect",{helper_command:"node src/cli.mjs github-login --json",mutations_performed:false}));
    // The preliminary connector connection is necessarily collected before
    // bootstrap.  The exact private repository names do not exist until the
    // idempotent preparer creates/resumes them, so exact-repository proof is a
    // post-bootstrap gate below (never inferred from local gh state).
    if(!state.github_plugin_authorized) return emit(action(state,"github_plugin_authorization","setup.github_plugin.connect",{mutations_performed:false,verification_requirement:"Connect ChatGPT GitHub before bootstrap; exact generated Control and Sandbox repository confirmation is required after bootstrap."}));
    if(!state.target_repository) return emit(action(state,"target_repository","setup.repository.ask",{mutations_performed:false}));
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(state.target_repository)) return emit({status:"ERROR",error_id:"SETUP-005",recoverable:true,preferred_language:lang,message:"Target repository must be owner/repository; no installation mutation was performed.",mutations_performed:false},1);
    if(!state.reviewer_chat_url) return emit(action(state,"reviewer_chat_url","setup.chat.ask",{mutations_performed:false}));
    if(!/^https:\/\/chatgpt\.com\//i.test(state.reviewer_chat_url)) return emit({status:"ERROR",error_id:"SETUP-006",recoverable:true,preferred_language:lang,message:"Reviewer Chat URL is invalid; no installation mutation was performed.",mutations_performed:false},1);
    state.installation_id ||= crypto.randomUUID();
    try {
      state.github_login=authenticatedGithubLogin();
      const intent=prepareMigrationIntent({state,sourceRoot:process.cwd(),home:os.homedir()});
      state.migration_intent_path=intent.path;
      state.migration_intent_phase=intent.phase;
      state.macos_native_setup="PREPARING";
      saveState(state);
    } catch(error) {
      return emit({status:"ERROR",error_id:"MACOS-MIGRATION-INTENT",recoverable:true,preferred_language:lang,message:"Durable macOS migration intent could not be prepared; no Control/Sandbox mutation was performed.",details:String(error.message||error),mutations_performed:false},1);
    }
    if(!state.control_environment_ready){
      try { const control=prepareControlEnvironment({installationId:state.installation_id,targetRepository:state.target_repository,reviewerChatUrl:state.reviewer_chat_url,trustedGithubLogin:state.github_login,macosSetupApproved:state.macos_setup_approved===true,sourceRoot:process.cwd(),home:os.homedir()}); Object.assign(state,control,{control_environment_ready:true,routing_architecture:"explicit-route-v1",target_environment_ready:false,macos_rollback:{available:true,automatic:false,created_at:new Date().toISOString()}}); saveState(state); }
      catch(error){ state.last_error={error_id:"SETUP-011",message:String(error.message||error),at:new Date().toISOString()}; saveState(state); return emit({status:"ERROR",error_id:"SETUP-011",recoverable:true,preferred_language:lang,message:"Native macOS Control/Sandbox preparation failed; no runner or service was started.",details:String(error.message||error)},1); }
    }
    if(state.github_plugin_authorization_verified!==true || state.github_plugin_authorization_installation_id!==state.installation_id || state.github_plugin_authorization_control_repository!==state.control_repository || state.github_plugin_authorization_sandbox_repository!==state.sandbox_repository || state.github_plugin_authorization_chat_url!==state.reviewer_chat_url) return emit(action(state,"generated_repo_authorization","setup.generated_repo.connect",{repositories:[state.control_repository,state.sandbox_repository],chat_url:state.reviewer_chat_url,verification_requirement:"The controlling Chat must confirm access to these exact generated private repositories and record this exact current Chat URL; local gh status and boolean answers are not proof.",mutations_performed:true}));
    try{Object.assign(state,verifyMacosGeneratedRepositories({state}));saveState(state);}
    catch(error){return emit({status:"ERROR",error_id:"MACOS-GENERATED-IDENTITY",message:"Exact generated private repository identities changed or are unverified; Runner and target remain disabled.",details:String(error.message||error),mutations_performed:false},1);}
    if(state.macos_native_installation_id && state.macos_native_installation_id!==state.installation_id) return emit({status:"ERROR",error_id:"MACOS-NATIVE-INSTALLATION-MISMATCH",recoverable:false,preferred_language:lang,message:"Native helper capability belongs to a different installation; target and Runner remain disabled.",mutations_performed:false},1);
    let nativePrepared;
    try { nativePrepared=prepareMacosNativeHelper({state,home:os.homedir(),approved:true}); }
    catch(error) {
      return emit({status:"ERROR",error_id:"MACOS-NATIVE-PREPARE-IO",recoverable:true,preferred_language:lang,message:"macOS native helper preparation failed closed; pending evidence was preserved and the target remains disabled.",details:String(error.message||error),recovery_status:"MANUAL_RECOVERY_REQUIRED",partial_mutation:true,mutations_performed:"UNKNOWN"},1);
    }
    if(nativePrepared.status!=="PASS") return emit({status:nativePrepared.status==="NEEDS_USER_ACTION"?"NEEDS_USER_ACTION":"ERROR",error_id:nativePrepared.error_id||"MACOS-NATIVE-PREPARE",recoverable:nativePrepared.status!=="ERROR",preferred_language:lang,message:"macOS native helper capability is unavailable; no native identity was enabled and the target remains disabled.",details:nativePrepared.details||nativePrepared.reason||null,capability:nativePrepared,mutations_performed:nativePrepared.mutations_performed??"UNKNOWN"},1);
    state.macos_native_installation_id=state.installation_id;
    state.instance_root=nativePrepared.instance_path;
    state.macos_native_capability={status:"VERIFIED",instance_path:nativePrepared.instance_path,helper_path:nativePrepared.helper_path,receipt_path:nativePrepared.receipt_path,source_review_commit:nativePrepared.source_review_commit,source_sha256:nativePrepared.source_sha256,binary_sha256:nativePrepared.binary_sha256};
    saveState(state);
    if(!state.codex_trust_sandbox) return emit(action(state,"codex_trust_sandbox","setup.codex.trust_sandbox",{folder:state.sandbox_clone_path,helper_command:"node src/cli.mjs codex-open --scope sandbox"}));
    if(!state.reviewer_browser_ready) return emit(action(state,"reviewer_browser_login","setup.browser.login",{browser_profile:state.browser_profile,browser_port:state.browser_port,details:"Authenticate the isolated ChatGPT browser profile at the exact originating Chat. This installer does not open a browser or infer login from a profile directory."}));
    const runnerBootstrap=advanceMacosFirstBootRunner(state);
    if(runnerBootstrap.status!=="READY"){
      state.current_step=runnerBootstrap.action_id||"macos_runner_bootstrap";
      state.last_error=runnerBootstrap.status==="ERROR"?{error_id:runnerBootstrap.error_id,message:runnerBootstrap.message||runnerBootstrap.details||"Runner first boot is blocked",at:new Date().toISOString()}:state.last_error;
      saveState(state);
      return emit({...runnerBootstrap,preferred_language:lang,runner_bootstrap:state.macos_runner_bootstrap||null},runnerBootstrap.status==="ERROR"?1:0);
    }
    let registration;
    // A pending first Issue is already pinned by the early gate. If its local
    // delivery proof disappears, reconciliation cannot submit another Issue.
    try{
      if(latestPending || pinnedFirstIssue){
        registration=ensureInstallerChatRegistration(state,{projectKey:state.sandbox_project_key,commandRunner:()=>{throw new Error("First registration delivery proof changed; preserve the saved Issue and retry receipt reconciliation");}});
      }else{
        registration=ensureInstallerChatRegistration(state,{projectKey:state.sandbox_project_key});
      }
    }
    catch(error){
      if(error.code==="MACOS-STATE-CONFLICT") return emit({status:"ERROR",error_id:"MACOS-STATE-CONFLICT",recoverable:true,preferred_language:lang,message:"Installer state advanced in another macOS setup process; reload and resume to preserve the canonical registration.",details:String(error.message||error),mutations_performed:"UNKNOWN"},1);
      state.last_error={error_id:"MACOS-CHAT-REGISTRATION",message:String(error.message||error),at:new Date().toISOString()};
      state.current_step="sandbox_chat_registration";
      try{saveState(state);}catch(saveError){if(saveError.code==="MACOS-STATE-CONFLICT") return emit({status:"ERROR",error_id:"MACOS-STATE-CONFLICT",recoverable:true,preferred_language:lang,message:"Installer state advanced in another macOS setup process; reload and resume to preserve the canonical registration.",details:String(saveError.message||saveError),mutations_performed:"UNKNOWN"},1);throw saveError;}
      return emit({status:"ERROR",error_id:"MACOS-CHAT-REGISTRATION",recoverable:true,preferred_language:lang,message:"Exact Chat registration could not be established. Preserve the issue and callback evidence; no Sandbox run was requested.",details:String(error.message||error),mutations_performed:"UNKNOWN"},1);
    }
    if(registration.status!=="READY"){ state.sandbox_chat_registration_issue=registration.issue?.url||null; state.current_step="sandbox_chat_registration"; try{saveState(state);}catch(error){if(error.code==="MACOS-STATE-CONFLICT") return emit({status:"ERROR",error_id:"MACOS-STATE-CONFLICT",recoverable:true,preferred_language:lang,message:"Installer state advanced in another macOS setup process; reload and resume to preserve the canonical registration.",details:String(error.message||error),mutations_performed:"UNKNOWN"},1);throw error;} return emit({status:"WAITING",action_id:"sandbox_chat_registration",recoverable:true,preferred_language:lang,message:"Register the explicit Sandbox callback in the originating Chat before CODEX-RUN.",registration_issue:registration.issue?.url||null,mutations_performed:true}); }
    const registered=registration.record;
    const shortId=String(state.installation_id||"").replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"default";
    const expectedSandboxProject="sandbox-"+shortId;
    const optionalInstallationMatches=!Object.hasOwn(registered||{},"installation_id") || String(registered.installation_id)===String(state.installation_id);
    let registeredChatUrl=null;
    try { registeredChatUrl=normalizeChatUrl(registered?.chat_url); } catch {}
    let stateChatUrl=null;
    try { stateChatUrl=normalizeChatUrl(state.reviewer_chat_url); } catch {}
    if(!registered || registered.status!=="active" || String(registered.project)!==expectedSandboxProject || String(registered.project)!==String(state.sandbox_project_key) || registeredChatUrl!==stateChatUrl || (state.sandbox_review_route && state.sandbox_review_route!==String(registration.route)) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(String(registered.route||"")) || String(registered.route)!==String(registration.route) || !optionalInstallationMatches){
      state.last_error={error_id:"SANDBOX-IDENTITY-001",message:"Sandbox callback registration identity is incomplete or does not match this installation",at:new Date().toISOString()};
      saveState(state);
      return emit({status:"ERROR",error_id:"SANDBOX-IDENTITY-001",recoverable:false,preferred_language:lang,message:"Sandbox verification failed closed because the registered route is not bound to this exact installation, project, and originating Chat.",mutations_performed:true},1);
    }
    state.sandbox_review_route=registration.route;
    {
      try {
        const api=githubReadOnlyApi({run:args=>{const result=spawnSafeSync("gh",args,{encoding:"utf8"});return {ok:result.status===0,stdout:result.stdout||"",stderr:result.stderr||""};}});
        const issueReference=String(state.sandbox_chat_registration_issue||registration.record?.registration_issue||"");
        const issueNumber=Number(issueReference.match(/\/issues\/(\d+)(?:$|[?#])/)?.[1]||issueReference.match(/^\d+$/)?.[0]||0);
        const registrationIssue=issueNumber?api.getIssue(state.control_repository,issueNumber):null;
        if(!registrationIssue?.number || !registrationIssue?.user?.login) throw new Error("registration issue provenance is incomplete");
        issueTrustedRecoveryEvidence({state,home:os.homedir(),githubApi:api,issueId:registrationIssue.number});
        const fresh=macosTrustedRecoveryEvidence(state,{requireReceipt:true});
        if(fresh.status!=="VERIFIED") throw new Error("fresh trusted recovery evidence verification failed");
        state.trusted_recovery_evidence_status="VERIFIED";
        saveState(state);
      } catch(error) {
        state.last_error={error_id:"MACOS-TRUSTED-RECOVERY-EVIDENCE",message:"Trusted recovery evidence could not be issued independently; target remains disabled.",at:new Date().toISOString()};
        saveState(state);
        return emit({status:"ERROR",error_id:"MACOS-TRUSTED-RECOVERY-EVIDENCE",recoverable:true,preferred_language:lang,message:"The explicit route exists, but trusted recovery evidence could not be issued independently.",details:"Independent provenance unavailable or contradictory; manual review is required.",mutations_performed:true},1);
      }
    }
    let smoke;
    try { smoke=sandboxSmokeStatus(state,{strict:process.platform==="darwin"}); }
    catch(error){
      state.last_error={error_id:"SANDBOX-VERIFICATION-001",message:String(error.message||error),at:new Date().toISOString()};
      saveState(state);
      return emit({status:"ERROR",error_id:"SANDBOX-VERIFICATION-001",recoverable:true,preferred_language:lang,message:"Sandbox verification evidence could not be read; target remains disabled.",details:String(error.message||error),mutations_performed:true},1);
    }
    const sameInstanceComplete=smoke?.status==="PASS" && smoke?.stage==="COMPLETE" && smoke?.branch===`test/install-smoke-${shortId}`;
    if(sameInstanceComplete){
      state.sandbox_verified=true;
      state.macos_native_setup="SANDBOX_VERIFIED";
      if(!state.completed.includes("sandbox_verified")) state.completed.push("sandbox_verified");
      saveState(state);
      if(state.codex_trust_project===true){
        state.macos_native_setup="POST_SANDBOX_HANDOFF";
        state.current_step="native_post_sandbox_gate";
        if(state.last_error?.error_id!=="MACOS-POST-SANDBOX-UNSUPPORTED") state.last_error={error_id:"MACOS-POST-SANDBOX-UNSUPPORTED",message:"Native macOS post-Sandbox Code Review/merge and target activation are not supported by this setup path",at:new Date().toISOString()};
        saveState(state);
        return emit({status:"ERROR",error_id:"MACOS-POST-SANDBOX-UNSUPPORTED",recoverable:false,preferred_language:lang,message:"Sandbox is verified and project trust is recorded, but the native macOS post-Sandbox Code Review/merge and target-activation gate is unsupported. Target remains disabled; no action was emitted.",current_step:state.current_step,mutations_performed:true},1);
      }
      return emit(action(state,"codex_trust_project","setup.codex.trust_project",{folder:state.project_clone_path||null,smoke,mutations_performed:true,details:"Sandbox completion was independently verified for this installation. Confirm project-folder trust as the next human gate; target remains disabled."}));
    }
    if(smoke?.stage==="NOT_STARTED"){
      try {
        const started=startSandboxSmoke(state);
        state.sandbox_smoke_started=true;
        state.sandbox_smoke_issue=started.issue?.url||null;
        saveState(state);
        smoke=sandboxSmokeStatus(state,{strict:true});
      } catch(error) {
        state.last_error={error_id:"SANDBOX-SMOKE-START-001",message:String(error.message||error),at:new Date().toISOString()};
        saveState(state);
        return emit({status:"ERROR",error_id:"SANDBOX-SMOKE-START-001",recoverable:true,preferred_language:lang,message:"Sandbox smoke creation was refused because its exact authorized issue state could not be established; target remains disabled.",details:String(error.message||error),smoke,mutations_performed:true},1);
      }
    }
    state.macos_native_setup="SANDBOX_READY"; state.current_step="sandbox_verification"; saveState(state);
    return emit({status:"WAITING",action_id:"sandbox_verification",recoverable:true,preferred_language:lang,mutations_performed:true,message:"Native macOS Sandbox and Control are prepared with the independently verified approved Runner; Sandbox completion is still required. The target remains disabled.",smoke,control_repository:state.control_repository,sandbox_repository:state.sandbox_repository,runner_label:state.runner_label});
  }
  state.installation_id ||= crypto.randomUUID();
  state.completed ||= [];

  const git = commandExists("git");
  const node = commandExists("node");
  const gh = commandExists("gh");
  const codex = commandExists("codex");
  const ghAuth = gh.ok ? commandExists("gh",["auth","status"]) : {ok:false,output:""};
  state.environment = { platform:process.platform, release:os.release(), git:git.output||null, node:node.output||null, gh:gh.output||null, codex:codex.output||null };

  if (!git.ok || !node.ok || !gh.ok || !codex.ok) {
    saveState(state);
    return emit({
      status:"ERROR", error_id:"SETUP-004", recoverable:true, preferred_language:lang,
      message:t(lang,"setup.prerequisites.failed"),
      missing:{git:!git.ok,node:!node.ok,gh:!gh.ok,codex:!codex.ok}
    },1);
  }
  if (!state.completed.includes("environment_check")) state.completed.push("environment_check");

  if (!ghAuth.ok) {
    return emit(action(state,"github_cli_authorization","setup.github_cli.connect",{
      helper_command:"node src/cli.mjs github-login --json"
    }));
  }
  if (!state.completed.includes("github_cli_authorization")) state.completed.push("github_cli_authorization");

  if (!state.github_plugin_authorized) {
    return emit(action(state,"github_plugin_authorization","setup.github_plugin.connect"));
  }
  if (!state.completed.includes("github_plugin_authorization")) state.completed.push("github_plugin_authorization");

  if (!state.target_repository) return emit(action(state,"target_repository","setup.repository.ask"));
  if (!state.completed.includes("target_repository")) state.completed.push("target_repository");

  if (!state.reviewer_chat_url) return emit(action(state,"reviewer_chat_url","setup.chat.ask"));
  if (!state.completed.includes("reviewer_chat_url")) state.completed.push("reviewer_chat_url");

  if (!state.control_environment_ready) {
    try {
      const control=prepareControlEnvironment({
        installationId:state.installation_id,
        targetRepository:state.target_repository,
        reviewerChatUrl:state.reviewer_chat_url,
        sourceRoot:process.cwd(),
        home:os.homedir()
      });
      Object.assign(state,{
        github_login:control.github_login,
        project_key:control.project_key,
        default_branch:control.default_branch,
        validation_profile:control.validation_profile,
        control_repository:control.control_repository,
        control_clone_path:control.control_clone_path,
        project_clone_path:control.project_clone_path,
        sandbox_project_key:control.sandbox_project_key,
        sandbox_repository:control.sandbox_repository,
        sandbox_clone_path:control.sandbox_clone_path,
        sandbox_validation_profile:control.sandbox_validation_profile,
        runner_path:control.runner_path,
        runner_label:control.runner_label,
        instance_id:control.instance_id,
        instance_platform:control.instance_platform,
        instance_arch:control.instance_arch,
        instance_root:control.instance_root,
        config_path:control.config_path,
        browser_port:control.browser_port,
        browser_profile:control.browser_profile,
        chat_route_file:control.chat_route_file,
        routing_architecture:"explicit-route-v1"
      });

      // Installation isolation: before the sandbox passes, only the generated
      // sandbox may receive checkpoint branches or orchestration writes.
      const setupSandbox=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(control.control_clone_path,"scripts","setup-project-clone.ps1"),
        "-Project",control.sandbox_project_key
      ],{encoding:"utf8"});
      if(setupSandbox.status!==0) {
        throw new Error((setupSandbox.stderr||setupSandbox.stdout||("Sandbox clone/checkpoint setup failed for "+control.sandbox_project_key)).trim());
      }

      const runnerInstall=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(control.control_clone_path,"scripts","install-runner.ps1"),
        "-ControlRepository",control.control_repository,
        "-RunnerPath",control.runner_path,
        "-RunnerLabel",control.runner_label
      ],{encoding:"utf8"});
      if(runnerInstall.status!==0) throw new Error((runnerInstall.stderr||runnerInstall.stdout||"Runner installation failed").trim());

      state.control_environment_ready=true;
      if(!state.completed.includes("control_environment")) state.completed.push("control_environment");
      saveState(state);
    } catch(error) {
      state.last_error={error_id:"SETUP-011",message:String(error.message||error),at:new Date().toISOString()};
      saveState(state);
      return emit({status:"ERROR",error_id:"SETUP-011",recoverable:true,preferred_language:lang,message:t(lang,"setup.control.failed"),details:String(error.message||error)},1);
    }
  }

  if(state.control_environment_ready && state.routing_architecture!=="explicit-route-v1") {
    try{
      const upgrade=upgradeControlEnvironment({state,sourceRoot:process.cwd(),home:os.homedir()});
      state.instance_id=upgrade.instance_id;
      state.instance_root=upgrade.instance_root;
      state.chat_route_file=upgrade.chat_route_file;
      state.config_path=upgrade.config_path;
      state.routing_architecture="explicit-route-v1";
      state.routing_upgrade={
        changed:Boolean(upgrade.changed),
        stopped_retired_router_processes:upgrade.stopped_retired_router_processes,
        retired_legacy_pending:upgrade.retired_legacy_pending,
        retired_legacy_pending_destination:upgrade.retired_legacy_pending_destination,
        retired_scripts:upgrade.retired_scripts,
        upgraded_at:new Date().toISOString()
      };
      if(!state.completed.includes("explicit_route_upgrade")) state.completed.push("explicit_route_upgrade");
      saveState(state);

      const retirePending=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(state.control_clone_path,"scripts","retry-pending-callbacks.ps1")
      ],{encoding:"utf8"});
      state.routing_upgrade.pending_migration_output=(retirePending.stdout||retirePending.stderr||"").trim()||null;
      saveState(state);
    }catch(error){
      state.last_error={error_id:"SETUP-014",message:String(error.message||error),at:new Date().toISOString()};
      saveState(state);
      return emit({
        status:"ERROR",
        error_id:"SETUP-014",
        recoverable:true,
        preferred_language:lang,
        message:t(lang,"setup.routing_upgrade.failed"),
        details:String(error.message||error)
      },1);
    }
  }

  if(!state.generated_repo_authorized) {
    return emit(action(state,"generated_repo_authorization","setup.generated_repo.connect",{
      repositories:[state.control_repository,state.sandbox_repository],
      verification_requirement:"ChatGPT GitHub connection must be able to read both generated private repositories before continuing."
    }));
  }
  if(!state.completed.includes("generated_repo_authorization")) state.completed.push("generated_repo_authorization");

  const codexLogin=commandExists("codex",["login","status"]);
  if(!codexLogin.ok) {
    return emit(action(state,"codex_login","setup.codex.login",{
      helper_command:"node src/cli.mjs codex-login --json"
    }));
  }
  if(!state.completed.includes("codex_login")) state.completed.push("codex_login");

  if(!state.codex_trust_sandbox) {
    return emit(action(state,"codex_trust_sandbox","setup.codex.trust_sandbox",{
      folder:state.sandbox_clone_path,
      helper_command:"node src/cli.mjs codex-open --scope sandbox"
    }));
  }
  if(!state.completed.includes("codex_trust_sandbox")) state.completed.push("codex_trust_sandbox");

  if(!state.reviewer_browser_ready) {
    const browserScript=path.join(state.control_clone_path,"scripts","start-reviewer-browser.ps1");
    const openBrowser=spawnSafeSync("powershell.exe",[
      "-NoProfile","-ExecutionPolicy","Bypass","-File",browserScript,
      "-ChatUrl",state.reviewer_chat_url,
      "-Port",String(state.browser_port),
      "-ProfilePath",state.browser_profile
    ],{encoding:"utf8"});
    if(openBrowser.status!==0){
      state.last_error={error_id:"CALLBACK-001",message:(openBrowser.stderr||openBrowser.stdout||"Reviewer browser launch failed").trim(),at:new Date().toISOString()};
      saveState(state);
    }
    return emit(action(state,"reviewer_browser_login","setup.browser.login",{
      reviewer_chat_url:state.reviewer_chat_url
    }));
  }
  if(!state.completed.includes("reviewer_browser_login")) state.completed.push("reviewer_browser_login");

  const generated = path.resolve(".generated");
  fs.mkdirSync(generated,{recursive:true});
  const templateName = lang === "zh-CN" ? "chatgpt-project-instructions.zh-CN.md" : "chatgpt-project-instructions.md";
  const template = fs.readFileSync(path.resolve("templates",templateName),"utf8");
  const projectKey = state.project_key || state.target_repository.split("/").pop().toLowerCase().replace(/[^a-z0-9-]+/g,"-");
  const rendered = renderProjectInstructions(template,{
    projectKey,
    repository:state.target_repository,
    controlRepository:state.control_repository,
    sandboxProjectKey:state.sandbox_project_key
  });
  fs.writeFileSync(path.join(generated,"chatgpt-project-instructions.md"),rendered);
  state.project_key = projectKey;
  if (!state.completed.includes("instructions_generated")) state.completed.push("instructions_generated");

  if (!state.instructions_added) {
    saveState(state);
    return emit(action(state,"chatgpt_project_instructions","setup.instructions.add",{generated_file:".generated/chatgpt-project-instructions.md"}));
  }

  if (!state.sandbox_verified) {
    try {
      const sessionScript=path.join(state.control_clone_path,"scripts","start-orchestrator-session.ps1");
      const session=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",sessionScript,
        "-Project",state.sandbox_project_key
      ],{encoding:"utf8"});
      if(session.status!==0){
        throw new Error((session.stderr||session.stdout||"Sandbox session startup failed").trim());
      }

      const sandboxRegistration=ensureInstallerChatRegistration(state,{projectKey:state.sandbox_project_key});
      if(sandboxRegistration.status!=="READY"){
        state.current_step="sandbox_chat_registration_waiting";
        state.sandbox_chat_registration_issue=sandboxRegistration.issue?.url||null;
        saveState(state);
        return emit({
          status:"WAITING",
          preferred_language:lang,
          message:t(lang,"setup.chat_registration.waiting"),
          project_key:state.sandbox_project_key,
          registration_issue:sandboxRegistration.issue?.url||null,
          note:t(lang,"setup.chat_registration.no_fallback")
        });
      }
      state.sandbox_review_route=sandboxRegistration.route;
      if(!state.completed.includes("sandbox_chat_registered")) state.completed.push("sandbox_chat_registered");
      saveState(state);

      let smoke=sandboxSmokeStatus(state,{strict:process.platform==="darwin"});
      if(smoke.stage==="NOT_STARTED"){
        const started=startSandboxSmoke(state);
        state.sandbox_smoke_started=true;
        state.sandbox_smoke_issue=started.issue?.url||null;
        saveState(state);
        smoke=sandboxSmokeStatus(state,{strict:process.platform==="darwin"});
      }

      if(smoke.stage==="COMPLETE"){
        state.sandbox_verified=true;
        if(!state.completed.includes("sandbox_verified")) state.completed.push("sandbox_verified");
        saveState(state);
      } else if(smoke.stage==="MERGE_APPROVAL_REQUIRED"){
        saveState(state);
        return emit(action(state,"sandbox_merge_approval","setup.sandbox.merge_approval",{
          sandbox_repository:state.sandbox_repository,
          reviewed_commit:smoke.commit,
          branch:smoke.branch,
          approve_command:"node src/cli.mjs smoke-approve --commit "+smoke.commit+" --yes --json"
        }));
      } else if(smoke.stage==="IMPLEMENTATION_FAILED"){
        state.last_error={error_id:"SANDBOX-002",message:"Sandbox implementation/validation failed",details:smoke,at:new Date().toISOString()};
        saveState(state);
        return emit({status:"ERROR",error_id:"SANDBOX-002",recoverable:true,preferred_language:lang,message:t(lang,"setup.sandbox.failed"),smoke},1);
      } else {
        state.current_step="sandbox_smoke_waiting";
        saveState(state);
        return emit({
          status:"WAITING",
          preferred_language:lang,
          message:t(lang,"setup.sandbox.waiting"),
          smoke,
          note:t(lang,"setup.sandbox.chat_handles_review")
        });
      }
    } catch(error) {
      state.last_error={error_id:"SANDBOX-001",message:String(error.message||error),at:new Date().toISOString()};
      saveState(state);
      return emit({status:"ERROR",error_id:"SANDBOX-001",recoverable:true,preferred_language:lang,message:t(lang,"setup.sandbox.start_failed"),details:String(error.message||error)},1);
    }
  }

  if(!state.target_environment_ready) {
    try {
      if(!state.sandbox_verified) throw new Error("Target project cannot be activated before sandbox verification");

      const activation=activateTargetProject({
        controlClonePath:state.control_clone_path,
        projectKey:state.project_key,
        repository:state.target_repository
      });

      const setupTarget=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(state.control_clone_path,"scripts","setup-project-clone.ps1"),
        "-Project",state.project_key
      ],{encoding:"utf8"});
      if(setupTarget.status!==0) {
        throw new Error((setupTarget.stderr||setupTarget.stdout||("Target clone/checkpoint setup failed for "+state.project_key)).trim());
      }

      state.target_environment_ready=true;
      state.target_registry_activated=true;
      state.target_activation_changed=Boolean(activation.changed);
      if(!state.completed.includes("target_environment_ready")) state.completed.push("target_environment_ready");
      saveState(state);
    } catch(error) {
      state.last_error={error_id:"SETUP-013",message:String(error.message||error),at:new Date().toISOString()};
      saveState(state);
      return emit({
        status:"ERROR",
        error_id:"SETUP-013",
        recoverable:true,
        preferred_language:lang,
        message:t(lang,"setup.target.activate_failed"),
        details:String(error.message||error)
      },1);
    }
  }

  const targetRegistration=ensureInstallerChatRegistration(state,{projectKey:state.project_key});
  if(targetRegistration.status!=="READY"){
    state.current_step="target_chat_registration_waiting";
    state.target_chat_registration_issue=targetRegistration.issue?.url||null;
    saveState(state);
    return emit({
      status:"WAITING",
      preferred_language:lang,
      message:t(lang,"setup.chat_registration.waiting"),
      project_key:state.project_key,
      registration_issue:targetRegistration.issue?.url||null,
      note:t(lang,"setup.chat_registration.no_fallback")
    });
  }
  state.target_review_route=targetRegistration.route;
  if(!state.completed.includes("target_chat_registered")) state.completed.push("target_chat_registered");
  saveState(state);

  if(!state.codex_trust_project) {
    return emit(action(state,"codex_trust_project","setup.codex.trust_project",{
      folder:state.project_clone_path,
      helper_command:"node src/cli.mjs codex-open --scope project"
    }));
  }
  if(!state.completed.includes("codex_trust_project")) state.completed.push("codex_trust_project");

  state.current_step="ready";
  state.ready=true;
  if (!state.completed.includes("ready")) state.completed.push("ready");
  saveState(state);
  emit({status:"PASS",preferred_language:lang,message:t(lang,"setup.ready"),project_key:state.project_key,repository:state.target_repository});
}

function codexLogin() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const result=spawnSafeSync("codex",["login"],{stdio:"inherit"});
  const verify=commandExists("codex",["login","status"]);
  if(result.status!==0||!verify.ok){
    return emit({status:"ERROR",error_id:"AUTH-002",recoverable:true,preferred_language:lang,message:t(lang,"codex.login.failed")},1);
  }
  emit({status:"PASS",preferred_language:lang,message:t(lang,"codex.login.success"),resume_command:"node src/cli.mjs resume --json"});
}

function codexOpen() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const scope=valueOf("--scope");
  const folder=scope==="sandbox"?state.sandbox_clone_path:scope==="project"?state.project_clone_path:null;
  if(!folder||!fs.existsSync(folder)){
    return emit({status:"ERROR",error_id:"AUTH-004",recoverable:true,preferred_language:lang,message:t(lang,"codex.folder.missing")},1);
  }
  const result=spawnSafeSync("codex",[],{cwd:folder,stdio:"inherit"});
  emit({
    status:result.status===0?"PASS":"NEEDS_USER_ACTION",
    preferred_language:lang,
    message:t(lang,"codex.trust.after_open"),
    scope,
    folder,
    confirm_command:"node src/cli.mjs answer --action codex_trust_"+scope+" --value true --json"
  },result.status===0?0:0);
}

function smokeStatusCommand() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  try{
    const smoke=sandboxSmokeStatus(state,{strict:process.platform==="darwin"});
    emit({status:smoke.status,preferred_language:lang,message:t(lang,"sandbox.status"),smoke});
  }catch(error){
    emit({status:"ERROR",error_id:"SANDBOX-001",recoverable:true,preferred_language:lang,message:t(lang,"setup.sandbox.start_failed"),details:String(error.message||error)},1);
  }
}

function smokeReviewCommand() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const commit=String(valueOf("--commit")||"").toLowerCase();
  try{
    const result=createSandboxCodeReview(state,{commit});
    emit({status:"PASS",preferred_language:lang,message:t(lang,"sandbox.review.created"),...result});
  }catch(error){
    emit({status:"ERROR",error_id:"SANDBOX-003",recoverable:true,preferred_language:lang,message:t(lang,"sandbox.review.failed"),details:String(error.message||error)},1);
  }
}

function smokeApproveCommand() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const commit=String(valueOf("--commit")||"").toLowerCase();
  const yes=argv.includes("--yes");
  if(!yes){
    return emit({status:"ERROR",error_id:"SANDBOX-004",recoverable:false,preferred_language:lang,message:t(lang,"sandbox.approval.required")},1);
  }
  try{
    const status=sandboxSmokeStatus(state,{strict:process.platform==="darwin"});
    if(status.stage!=="MERGE_APPROVAL_REQUIRED"||status.commit!==commit){
      throw new Error("The requested commit is not the current independently reviewed sandbox commit");
    }
    const result=createSandboxMergeApproval(state,{commit});
    state.sandbox_merge_approved_commit=commit;
    saveState(state);
    emit({status:"PASS",preferred_language:lang,message:t(lang,"sandbox.approval.created"),...result,resume_command:"node src/cli.mjs resume --json"});
  }catch(error){
    emit({status:"ERROR",error_id:"SANDBOX-005",recoverable:true,preferred_language:lang,message:t(lang,"sandbox.approval.failed"),details:String(error.message||error)},1);
  }
}

function githubLogin() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const gh=commandExists("gh");
  if(!gh.ok) return emit({status:"ERROR",error_id:"SETUP-010",recoverable:true,preferred_language:lang,message:t(lang,"github_cli.missing")},1);

  const result=spawnSafeSync("gh",["auth","login","--hostname","github.com","--git-protocol","https","--web"],{
    stdio:"inherit",
  });
  if(result.status!==0){
    return emit({status:"ERROR",error_id:"AUTH-003",recoverable:true,preferred_language:lang,message:t(lang,"github_cli.login.failed")},1);
  }
  const verify=commandExists("gh",["auth","status"]);
  if(!verify.ok){
    return emit({status:"ERROR",error_id:"AUTH-003",recoverable:true,preferred_language:lang,message:t(lang,"github_cli.login.failed")},1);
  }
  emit({status:"PASS",preferred_language:lang,message:t(lang,"github_cli.login.success"),resume_command:"node src/cli.mjs resume --json"});
}

function runtimeChecks(state) {
  if(process.platform==="darwin") {
    const result=macosRuntimeAction("status",{state});
    const native=verifyMacosNativeCapability({state});
    return {control_repository:Boolean(state.control_repository),control_clone:Boolean(state.control_clone_path&&fs.existsSync(state.control_clone_path)),
      project_clone:Boolean(state.project_clone_path&&fs.existsSync(state.project_clone_path)),runner_configured:Boolean(state.runner_path),
      runner_loaded:Boolean(result.launchctl_state==="loaded"&&result.plist_verified===true),runner_running:Boolean(result.status==="PASS"&&result.listener_running===true&&result.listener_identity),runner_github_online:result.github_online===true,reviewer_browser:false,
      codex_authenticated:macosPrerequisites().session_auth,pending_callbacks:pendingCallbackCount(state),migration:result.status,
      macos_native_helper:native.status==="PASS",macos_native_helper_status:native.status};
  }
  const pendingCallbacks=pendingCallbackCount(state);

  let runnerRunning=false;
  if(process.platform==="win32" && state.runner_path){
    const escaped=String(state.runner_path).replaceAll("'","''");
    const ps=spawnSafeSync("powershell.exe",["-NoProfile","-Command",
      "$root='"+escaped.replaceAll("\\","\\")+"'.TrimEnd('\\')+'\\'; "+
      "$p=@(Get-CimInstance Win32_Process -Filter \"Name='Runner.Listener.exe'\" -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase)}); "+
      "if($p.Count -gt 0){exit 0}else{exit 1}"
    ],{encoding:"utf8"});
    runnerRunning=ps.status===0;
  }

  let browserReady=false;
  const port=Number(state.browser_port||0);
  if(process.platform==="win32" && Number.isInteger(port) && port>0){
    const ps=spawnSafeSync("powershell.exe",["-NoProfile","-Command",
      "try { Invoke-RestMethod -Uri 'http://127.0.0.1:"+port+"/json/version' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
    ],{encoding:"utf8"});
    browserReady=ps.status===0;
  }

  return {
    control_repository:Boolean(state.control_repository),
    control_clone:Boolean(state.control_clone_path&&fs.existsSync(state.control_clone_path)),
    project_clone:Boolean(state.project_clone_path&&fs.existsSync(state.project_clone_path)),
    runner_configured:Boolean(state.runner_path&&fs.existsSync(path.join(state.runner_path,".runner"))),
    runner_running:runnerRunning,
    reviewer_browser:browserReady,
    codex_authenticated:commandExists("codex",["login","status"]).ok,
    pending_callbacks:pendingCallbacks
  };
}

function doctor() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const checks={
    git:commandExists("git").ok,
    node:commandExists("node").ok,
    gh:commandExists("gh").ok,
    github_cli_authenticated:commandExists("gh",["auth","status"]).ok,
    codex:commandExists("codex").ok,
    install_state:fs.existsSync(path.join(stateRoot(),"install-state.json")),
    github_plugin_configured:Boolean(state.github_plugin_authorized),
    github_repository_configured:Boolean(state.target_repository),
    reviewer_chat_configured:Boolean(state.reviewer_chat_url),
    ...runtimeChecks(state)
  };
  if(process.platform==="darwin") { checks.migration_preflight=migrationPreflight({state}); checks.macos_native_helper=verifyMacosNativeCapability({state}); }

  let preflight=true;
  let preflightDetails=null;
  if(state.control_environment_ready&&state.control_clone_path&&state.project_key&&process.platform==="win32"){
    const script=path.join(state.control_clone_path,"scripts","preflight.ps1");
    const r=spawnSafeSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",script,"-Project",state.project_key],{encoding:"utf8"});
    preflight=r.status===0;
    preflightDetails=(r.stdout||r.stderr||"").trim()||null;
  }
  checks.runtime_preflight=preflight;

  const health=doctorHealth(checks);
  emit({status:health.status,error_id:health.error_id,recoverable:health.recoverable,preferred_language:lang,message:health.healthy?t(lang,"doctor.healthy"):t(lang,"doctor.attention"),checks,preflight_details:preflightDetails},health.healthy?0:1);
}

function status() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  emit({
    status:state.ready?"PASS":"NEEDS_USER_ACTION",
    preferred_language:lang,
    message:state.ready?t(lang,"status.ready"):t(lang,"status.not_ready"),
    current_step:state.current_step||"not_started",
    completed:state.completed||[],
    project_key:state.project_key||null,
    runtime:runtimeChecks(state)
  });
}

function repair() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  if(process.platform==="darwin") return emit({status:"NEEDS_USER_ACTION",preferred_language:lang,message:"macOS repair is approval-gated; no service or runner was changed.",migration:migrationPreflight({state}),mutations_performed:false});
  if(process.platform!=="win32"||!state.control_environment_ready||!state.control_clone_path||!state.project_key){
    return emit({status:"ERROR",error_id:"REPAIR-001",recoverable:true,preferred_language:lang,message:t(lang,"repair.not_ready"),runtime:runtimeChecks(state)},1);
  }

  const script=path.join(state.control_clone_path,"scripts","start-orchestrator-session.ps1");
  const r=spawnSafeSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",script,"-Project",state.project_key],{encoding:"utf8"});
  if(r.status!==0){
    state.last_error={error_id:"REPAIR-001",message:(r.stderr||r.stdout||"Repair failed").trim(),at:new Date().toISOString()};
    saveState(state);
    return emit({status:"ERROR",error_id:"REPAIR-001",recoverable:true,preferred_language:lang,message:t(lang,"repair.failed"),details:state.last_error.message,runtime:runtimeChecks(state)},1);
  }

  const runtime=runtimeChecks(state);
  const health=repairHealth(runtime,{preflightEstablished:true});
  if(health.status!=="PASS"){
    return emit({status:health.status,error_id:health.error_id,recoverable:health.recoverable,preferred_language:lang,message:t(lang,health.reason_key),repaired:health.repaired,runtime},1);
  }
  emit({status:"PASS",preferred_language:lang,message:t(lang,"repair.success"),repaired:health.repaired,runtime});
}

function refreshRuntime() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  try {
    const result=refreshControlRuntime({state,sourceRoot:process.cwd()});
    state.runtime_refreshed_at=new Date().toISOString();
    if(result.changed) state.control_commit=spawnSafeSync("git",["rev-parse","HEAD"],{cwd:state.control_clone_path,encoding:"utf8"}).stdout.trim();
    saveState(state);
    emit({status:"PASS",preferred_language:lang,message:t(lang,"runtime.refresh.success"),...result});
  } catch(error) {
    emit({status:"ERROR",error_id:"RUNTIME-REFRESH-001",recoverable:true,preferred_language:lang,message:t(lang,"runtime.refresh.failed"),details:String(error.message||error)},1);
  }
}

function recoveryPreflight() {
  if (process.platform !== "darwin") return emit({status:"PASS",preferred_language:"en",mutations_performed:false,existing_instance_recovery:{status:"UNSUPPORTED",platform:process.platform}});
  let state;
  let stateInvalid=false;
  try { state=loadState({create:false}); } catch { state={}; stateInvalid=true; }
  const report=macosRecoveryReport(state);
  const trustedEvidence=stateInvalid?{status:"CONFLICT",missing_verification_gates:["installer_state"]}:macosTrustedRecoveryEvidence(state,{requireReceipt:Boolean(state.sandbox_review_route)});
  const blocked=stateInvalid || (report.status!=="ABSENT" && !macosBootstrapMayAdvance(state, report, trustedEvidence) && (!macosStateBound(state, report) || report.status==="CONFLICT"));
  const evidenceBlocked=trustedEvidence.status==="CONFLICT"||(trustedEvidence.status==="NEEDS_HUMAN_LEGACY"&&!macosSelectedAwaitingFirstRoute(state,report));
  const finalBlocked=blocked||evidenceBlocked;
  emit({status:finalBlocked?(blocked?(report.status==="CONFLICT"?"ERROR":"NEEDS_USER_ACTION"):"NEEDS_USER_ACTION"):"PASS",error_id:finalBlocked?(blocked?"MACOS-EXISTING-INSTANCE-REVIEW":"MACOS-TRUSTED-RECOVERY-EVIDENCE"):undefined,preferred_language:"en",message:finalBlocked?"Existing macOS evidence requires separate human review; no activation or adoption was performed.":"macOS existing-instance recovery preflight completed without mutation.",existing_instance_recovery:report,trusted_recovery_evidence:trustedEvidence,mutations_performed:false},finalBlocked?1:0);
}

function reportProblem() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const report=sanitizeObject({generated_at:new Date().toISOString(),version:productConfig.version||"unknown",release_channel:productConfig.release_channel||null,platform:process.platform,os_release:os.release(),current_step:state.current_step||null,preferred_language:lang,last_error:state.last_error||null,environment:state.environment||null});
  const dir=path.join(stateRoot(),"diagnostics");
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,`diagnostic-${Date.now()}.json`);
  fs.writeFileSync(file,JSON.stringify(report,null,2));
  emit({status:"PASS",preferred_language:lang,message:t(lang,"report.prepared"),report_file:file,preview:report,uploaded:false,consent_required_before_upload:true});
}

function submitReport() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const file=valueOf("--file");
  const consent=/^(true|yes|y|1)$/i.test(String(valueOf("--consent")||""));
  const feedbackRepository=process.env.ORCHESTRATOR_FEEDBACK_REPOSITORY||productConfig.feedback_repository||"";
  if(!consent){
    return emit({status:"ERROR",error_id:"REPORT-001",recoverable:false,preferred_language:lang,message:t(lang,"report.consent.required"),uploaded:false},1);
  }
  if(!file||!fs.existsSync(file)){
    return emit({status:"ERROR",error_id:"REPORT-002",recoverable:true,preferred_language:lang,message:t(lang,"report.file.missing"),uploaded:false},1);
  }
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(feedbackRepository)){
    return emit({status:"ERROR",error_id:"REPORT-003",recoverable:true,preferred_language:lang,message:t(lang,"report.destination.missing"),uploaded:false},1);
  }
  try{
    const result=submitDiagnosticReport({file,repository:feedbackRepository});
    emit({status:"PASS",preferred_language:lang,message:t(lang,"report.submitted"),uploaded:true,url:result.url||null});
  }catch(error){
    emit({status:"ERROR",error_id:"REPORT-004",recoverable:true,preferred_language:lang,message:t(lang,"report.submit.failed"),details:String(error.message||error),uploaded:false},1);
  }
}

if (command==="dry-run") dryRun();
else if (command==="setup"||command==="resume") runSetup();
else if (command==="github-login") githubLogin();
else if (command==="codex-login") codexLogin();
else if (command==="codex-open") codexOpen();
else if (command==="smoke-status") smokeStatusCommand();
else if (command==="smoke-review") smokeReviewCommand();
else if (command==="smoke-approve") smokeApproveCommand();
else if (command==="doctor") doctor();
else if (command==="status") status();
else if (command==="repair") repair();
else if (command==="refresh-runtime") refreshRuntime();
else if (command==="report-problem") reportProblem();
else if (command==="migration-preflight") {
  const state=loadState({create:false}); const lang=ensureStateLanguage(state);
  emit({status:"PASS",preferred_language:lang,mutations_performed:false,migration:migrationPreflight({state})});
}
else if (command==="recovery-preflight") recoveryPreflight();
else if (command==="submit-report") submitReport();
else if (command==="answer") answer();
else if (command==="errors") emit({status:"PASS",errors:ERROR_CATALOG});
else emit({status:"PASS",message:"Commands: dry-run, setup, resume, recovery-preflight, refresh-runtime, answer, github-login, codex-login, codex-open, smoke-status, smoke-review, smoke-approve, doctor, status, repair, report-problem, submit-report, errors"});
