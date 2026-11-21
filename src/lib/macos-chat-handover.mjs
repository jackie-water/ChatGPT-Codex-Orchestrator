import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalInstallationId } from './control-render.mjs';
import { inspectMacosCommittedSource } from './macos-receipt-continuity.mjs';

// A terminal Chat is not a callback route. This approval changes no route,
// Runner, repository or installation until a distinct one-shot resume consent.
export const MACOS_CHAT_HANDOVER_ACTION = 'macos_chat_handover_approval';
export const MACOS_CHAT_HANDOVER_RESUME_ACTION = 'macos_chat_handover_resume_approval';
export const MACOS_CHAT_HANDOVER_SCOPE = 'g3-chat-successor-identity-only-v1';
export const MACOS_CHAT_HANDOVER_RESUME_SCOPE = 'g3-chat-successor-once-private-control-sandbox-v1';
const OLD_CONTINUITY_SCOPE = 'g3-failed-setup-retry-private-control-sandbox-only-v1';
const ROOT = '.chatgpt-codex-orchestrator';
// This phase is authorized only for the one interrupted installation; never
// infer authority over another Chat, project, owner or G3 source lineage.
const PINNED_INSTALLATION = '192e9295';
const PINNED_OWNER = 'jackie-water';
const PINNED_TARGET = 'jackie-water/ChatGPT-Codex-Orchestrator-E2E-Target';
const PINNED_PREDECESSOR_SOURCE = '422e20b12e851fc373daeac3c0a602223b628011';
const PINNED_PREDECESSOR_TREE = 'cc0a0e2a53912be928789124237687cd2735ee8d';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const sha256 = input => crypto.createHash('sha256').update(input).digest('hex');
const hashJson = obj => sha256(Buffer.from(JSON.stringify(obj)));

export function canonicalMacosHandoverChatUrl(value) {
  if (typeof value !== 'string' || value.length < 28 || value.length > 1024 || value.trim() !== value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'chatgpt.com' || parsed.port ||
        parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const match = /^\/(?:g\/([A-Za-z0-9_-]+)\/)?c\/([0-9a-f-]{8,80})\/?$/i.exec(parsed.pathname);
    if (!match) return null;
    return {url:`https://chatgpt.com${parsed.pathname.replace(/\/$/,'')}`,group:match[1]||null,chat:match[2].toLowerCase()};
  } catch {return null;}
}

function readPrivateIntentDigest(state, home, fsImpl) {
  const short = canonicalInstallationId(state.installation_id);
  if (short === '1832f0bb' || !/^[a-z0-9]{8}$/.test(short)) throw Error('INVALID_INSTALLATION_ID');
  const expected = path.join(home, ROOT, 'instances', short, 'migration-intent.json');
  if (state.migration_intent_path !== expected || state.migration_intent_phase !== 'PREPARED')
    throw Error('INTENT_PATH_CHANGED');
  const parent = path.dirname(expected);
  for(const dir of [path.join(home,ROOT),path.join(home,ROOT,'instances'),parent]){
    const stat=fsImpl.lstatSync(dir);
    if(!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode&0o7777)!==0o700 ||
       (typeof process.getuid==='function' && stat.uid!==process.getuid()) || fsImpl.realpathSync(dir)!==dir)
      throw Error('UNSAFE_INTENT_PARENT');
  }
  const before=fsImpl.lstatSync(expected);
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size<1 || before.size>262144 ||
     (before.mode&0o7777)!==0o600 || (typeof process.getuid==='function'&&before.uid!==process.getuid()))
    throw Error('UNSAFE_INTENT');
  if(!fs.constants.O_NOFOLLOW)throw Error('NOFOLLOW_UNAVAILABLE');
  const fd=fsImpl.openSync(expected,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const opened=fsImpl.fstatSync(fd);
    if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||
       opened.nlink!==1||(opened.mode&0o7777)!==0o600)throw Error('INTENT_CHANGED');
    const data=Buffer.alloc(opened.size);let off=0;
    while(off<data.length){const n=fsImpl.readSync(fd,data,off,data.length-off,off);if(n<=0)throw Error('INTENT_SHORT_READ');off+=n;}
    const after=fsImpl.lstatSync(expected),closeStat=fsImpl.fstatSync(fd);
    for(const key of ['dev','ino','size','mtimeMs','ctimeMs']){
      if(after[key]!==before[key]||closeStat[key]!==before[key])throw Error('INTENT_CHANGED');
    }
    return sha256(data);
  } finally {fsImpl.closeSync(fd);}
}

function baselineConditions(state) {
  return Boolean(state?.macos_setup_approved===true && state?.fresh_first_install_bootstrap===true &&
    state?.fresh_first_install_legacy_instance_id==='1832f0bb' && state?.last_error?.error_id==='SETUP-011' &&
    state?.installation_id && canonicalInstallationId(state.installation_id)===PINNED_INSTALLATION &&
    state?.target_repository===PINNED_TARGET && state?.github_login===PINNED_OWNER &&
    state?.control_environment_ready!==true && state?.target_environment_ready!==true && state?.ready!==true &&
    !state?.instance_id && !state?.control_repository && !state?.sandbox_repository &&
    !state?.control_repository_id && !state?.sandbox_repository_id && !state?.sandbox_project_key &&
    !state?.control_clone_path && !state?.sandbox_clone_path && !state?.sandbox_chat_registration_issue &&
    !state?.review_route && !state?.sandbox_review_route && !state?.chat_route_file && !state?.runner_path &&
    !state?.macos_runner_bootstrap && !state?.macos_runner_activation && !state?.macos_chat_handover_applied &&
    state?.macos_receipt_continuity_attempt===undefined &&
    !state?.generated_repo_authorized && state?.github_plugin_authorization_verified!==true);
}

const handoverFields = ['schema_version','action_id','scope','challenge','binding_sha256','source_commit',
  'source_tree','predecessor_chat_url','successor_chat_url','original_continuity_sha256','approved_at'];
const resumeFields = ['schema_version','action_id','scope','challenge','binding_sha256','source_commit',
  'source_tree','handover_challenge','approved_at'];

function approvedHandover(receipt, binding, digest, source) {
  return Boolean(exactKeys(receipt,handoverFields) && receipt.schema_version===1 &&
    receipt.action_id===MACOS_CHAT_HANDOVER_ACTION && receipt.scope===MACOS_CHAT_HANDOVER_SCOPE &&
    receipt.challenge===`macos-chat-handover-v1:${digest}` && receipt.binding_sha256===digest &&
    receipt.source_commit===source.source_commit && receipt.source_tree===source.source_tree &&
    receipt.predecessor_chat_url===binding.predecessor_chat_url &&
    receipt.successor_chat_url===binding.successor_chat_url &&
    receipt.original_continuity_sha256===binding.original_continuity_sha256 &&
    typeof receipt.approved_at==='string' && Number.isFinite(Date.parse(receipt.approved_at)));
}

// Injectors exist solely to test the same fail-closed contract with isolated
// temporary Git repos. The official CLI binds them to its existing read-only
// local and complete authenticated remote inventory, never to caller data.
export function inspectMacosChatHandover({state={},home=os.homedir(),sourceRoot=process.cwd(),
    successorChatUrl,fsImpl=fs,inspectPriorContinuity,inspectNewSource=inspectMacosCommittedSource}={}) {
  const blocked=reason=>({status:'BLOCKED',error_id:`G3-HANDOVER-${reason}`,
    mutations_performed:false,authorization_for_new_chat:false,setup_executed:false,target_disabled:true});
  try{if(!baselineConditions(state))return blocked('STATE_NOT_ELIGIBLE');}
  catch{return blocked('STATE_IDENTITY_INVALID');}
  const oldReceipt=state.macos_receipt_continuity_approval;
  if(!exactKeys(oldReceipt,['schema_version','action_id','scope','challenge','approved_at','source_commit','source_tree','binding_sha256']) ||
     oldReceipt.schema_version!==1||oldReceipt.action_id!=='macos_receipt_continuity_approval'||
     oldReceipt.scope!==OLD_CONTINUITY_SCOPE||oldReceipt.source_commit!==PINNED_PREDECESSOR_SOURCE||
     oldReceipt.source_tree!==PINNED_PREDECESSOR_TREE||!SHA.test(oldReceipt.source_commit)||
     !SHA.test(oldReceipt.source_tree)||!DIGEST.test(oldReceipt.binding_sha256)||
     !/^macos-receipt-continuity-v1:[0-9a-f]{64}$/.test(oldReceipt.challenge))return blocked('ORIGINAL_APPROVAL_INVALID');
  const original=canonicalMacosHandoverChatUrl(state.reviewer_chat_url);
  if(!original)return blocked('ORIGINAL_CHAT_INVALID');
  const handover=state.macos_chat_handover_approval;
  const next=successorChatUrl ?? handover?.successor_chat_url;
  if(handover!==undefined && successorChatUrl!==undefined &&
     canonicalMacosHandoverChatUrl(successorChatUrl)?.url!==handover?.successor_chat_url)
    return blocked('SUCCESSOR_CONFLICT');
  const successor=next===undefined?null:canonicalMacosHandoverChatUrl(next);
  if(next!==undefined&&(!successor||original.chat===successor.chat ||
     original.group!==successor.group))return blocked('SUCCESSOR_CHAT_INVALID');
  try {
    if(typeof inspectPriorContinuity!=='function')throw Error('ORIGINAL_CONTINUITY_UNVERIFIED');
    const sourceRootReal=fsImpl.realpathSync(sourceRoot);
    const source=inspectNewSource(sourceRoot,{fsImpl});
    if(sourceRootReal!==sourceRoot||source.source_root!==sourceRoot||!SHA.test(source.source_commit)||
       !SHA.test(source.source_tree)||!Array.isArray(source.source_file_sha256))
      throw Error('NEW_SOURCE_UNVERIFIED');
    const newOfficial=path.join(home,ROOT,'official-source',source.source_commit);
    if(sourceRoot!==newOfficial || source.source_commit===oldReceipt.source_commit)throw Error('NEW_SOURCE_PATH_INVALID');
    const previous=path.join(home,ROOT,'official-source',oldReceipt.source_commit);
    const old=inspectPriorContinuity(previous);
    if(old?.status!=='PASS'||old.authorized!==true||old.source_commit!==oldReceipt.source_commit||
       old.source_tree!==oldReceipt.source_tree||old.binding_sha256!==oldReceipt.binding_sha256||
       old.old_receipt_preserved!==true||old.historical_intent_preserved!==true||old.mutations_performed!==false)
      throw Error('ORIGINAL_CONTINUITY_UNVERIFIED');
    const intentDigest=readPrivateIntentDigest(state,home,fsImpl);
    const instanceRoot=path.dirname(state.migration_intent_path);
    for(const role of ['chat-routes.json','registration-delivery','pending-wakes','runner']){
      try{fsImpl.lstatSync(path.join(instanceRoot,role));throw Error('LOCAL_ROUTE_OR_RUNNER_RESIDUE');}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const launchAgent=path.join(home,'Library','LaunchAgents',`com.chatgpt.codex.${canonicalInstallationId(state.installation_id)}.plist`);
    try{fsImpl.lstatSync(launchAgent);throw Error('LOCAL_RUNNER_LAUNCHAGENT_RESIDUE');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(next===undefined){
      return {status:'NEEDS_USER_ACTION',action_id:'macos_chat_successor_url',
        mutations_performed:false,authorization_for_new_chat:false,setup_executed:false,target_disabled:true};
    }
    const binding={schema_version:1,scope:MACOS_CHAT_HANDOVER_SCOPE,
      installation_id:state.installation_id,instance_id:canonicalInstallationId(state.installation_id),
      github_login:state.github_login,target_repository:state.target_repository,
      predecessor_chat_url:state.reviewer_chat_url,successor_chat_url:successor.url,
      original_source_commit:old.source_commit,original_source_tree:old.source_tree,
      original_continuity_binding_sha256:old.binding_sha256,
      original_continuity_sha256:hashJson(oldReceipt),original_intent_sha256:intentDigest,
      successor_source:source};
    const bindingDigest=hashJson(binding);
    if(handover===undefined){
      if(state.macos_chat_handover_resume_approval!==undefined)return blocked('UNEXPECTED_RESUME_APPROVAL');
      return {status:'NEEDS_USER_ACTION',action_id:MACOS_CHAT_HANDOVER_ACTION,
        approval_challenge:`macos-chat-handover-v1:${bindingDigest}`,
        binding_sha256:bindingDigest,source_commit:source.source_commit,source_tree:source.source_tree,
        mutations_performed:false,authorization_for_new_chat:false,setup_executed:false,target_disabled:true};
    }
    if(!approvedHandover(handover,binding,bindingDigest,source))return blocked('HANDOVER_APPROVAL_CONFLICT');
    const resumeBinding={schema_version:1,scope:MACOS_CHAT_HANDOVER_RESUME_SCOPE,
      handover_binding_sha256:bindingDigest,handover_receipt_sha256:hashJson(handover),
      source_commit:source.source_commit,source_tree:source.source_tree,
      original_intent_sha256:intentDigest};
    const resumeDigest=hashJson(resumeBinding);
    const resumeChallenge=`macos-chat-handover-resume-v1:${resumeDigest}`;
    const resume=state.macos_chat_handover_resume_approval;
    if(resume===undefined){
      return {status:'NEEDS_USER_ACTION',action_id:MACOS_CHAT_HANDOVER_RESUME_ACTION,
        approval_challenge:resumeChallenge,binding_sha256:resumeDigest,
        source_commit:source.source_commit,source_tree:source.source_tree,
        mutations_performed:false,authorization_for_new_chat:true,installation_authorized:false,
        setup_executed:false,target_disabled:true};
    }
    if(!exactKeys(resume,resumeFields)||resume.schema_version!==1||
       resume.action_id!==MACOS_CHAT_HANDOVER_RESUME_ACTION||resume.scope!==MACOS_CHAT_HANDOVER_RESUME_SCOPE||
       resume.challenge!==resumeChallenge||resume.binding_sha256!==resumeDigest||
       resume.source_commit!==source.source_commit||resume.source_tree!==source.source_tree||
       resume.handover_challenge!==handover.challenge||typeof resume.approved_at!=='string'||
       !Number.isFinite(Date.parse(resume.approved_at)))return blocked('RESUME_APPROVAL_CONFLICT');
    return {status:'PASS',authorized:true,source_commit:source.source_commit,source_tree:source.source_tree,
      binding_sha256:resumeDigest,successor_chat_url:successor.url,predecessor_chat_url:original.url,
      handover_challenge:handover.challenge,
      mutations_performed:false,setup_executed:false,target_disabled:true,
      old_receipt_preserved:true,historical_intent_preserved:true};
  }catch(e){return blocked(e.message && /^[A-Z0-9_-]{1,90}$/.test(e.message)?e.message:'INSPECTION_FAILED');}
}

export function makeMacosChatHandoverReceipt({state={},value,inspection,successorChatUrl}={}){
  if(state.macos_chat_handover_approval!==undefined||state.macos_chat_handover_resume_approval!==undefined||
     inspection?.status!=='NEEDS_USER_ACTION'||inspection.action_id!==MACOS_CHAT_HANDOVER_ACTION||
     typeof value!=='string'||value!==inspection.approval_challenge||
     !DIGEST.test(inspection.binding_sha256||'')||!SHA.test(inspection.source_commit||'')||
     !SHA.test(inspection.source_tree||''))return null;
  const predecessor=canonicalMacosHandoverChatUrl(state.reviewer_chat_url);
  const successor=canonicalMacosHandoverChatUrl(successorChatUrl);
  if(!predecessor||!successor||predecessor.chat===successor.chat||
     predecessor.group!==successor.group)return null;
  return {schema_version:1,action_id:MACOS_CHAT_HANDOVER_ACTION,scope:MACOS_CHAT_HANDOVER_SCOPE,
    challenge:value,binding_sha256:inspection.binding_sha256,
    source_commit:inspection.source_commit,source_tree:inspection.source_tree,
    predecessor_chat_url:state.reviewer_chat_url,successor_chat_url:successor.url,
    original_continuity_sha256:hashJson(state.macos_receipt_continuity_approval),
    approved_at:new Date().toISOString()};
}

export function makeMacosChatHandoverResumeReceipt({state={},value,inspection}={}){
  if(state.macos_chat_handover_resume_approval!==undefined||
     !state.macos_chat_handover_approval||inspection?.status!=='NEEDS_USER_ACTION'||
     inspection.action_id!==MACOS_CHAT_HANDOVER_RESUME_ACTION||typeof value!=='string'||
     value!==inspection.approval_challenge||!DIGEST.test(inspection.binding_sha256||'')||
     !SHA.test(inspection.source_commit||'')||!SHA.test(inspection.source_tree||''))return null;
  return {schema_version:1,action_id:MACOS_CHAT_HANDOVER_RESUME_ACTION,
    scope:MACOS_CHAT_HANDOVER_RESUME_SCOPE,challenge:value,binding_sha256:inspection.binding_sha256,
    source_commit:inspection.source_commit,source_tree:inspection.source_tree,
    handover_challenge:state.macos_chat_handover_approval.challenge,approved_at:new Date().toISOString()};
}
