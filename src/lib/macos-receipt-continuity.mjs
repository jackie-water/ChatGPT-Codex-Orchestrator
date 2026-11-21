import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { canonicalInstallationId, defaultLocalPaths } from './control-render.mjs';

// This is a NEW approval domain. Historic fresh-preparation receipts are
// immutable evidence, never authorization for a different code version.
export const MACOS_RECEIPT_CONTINUITY_ACTION = 'macos_receipt_continuity_approval';
export const MACOS_RECEIPT_CONTINUITY_SCOPE = 'g3-failed-setup-retry-private-control-sandbox-only-v1';
const OLD_ACTION = 'macos_official_fresh_preparation';
const OLD_SCOPE = 'fresh-private-control-sandbox-only-v1';
const SHA = /^[0-9a-f]{40}$/;
const SOURCE_PATHS = ['install.sh','src/cli.mjs','src/lib/macos-existing-instance-recovery.mjs','AI_INSTALL.md'];
const MAX_INTENT = 262144;
const MAX_SOURCE_FILES = 1024;
const MAX_FILE = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const ROOT = '.chatgpt-codex-orchestrator';
const exactKeys = (value,keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const isNonempty = x => typeof x==='string' && x.length>0 && x.length<=2048;
const validRepo = x => typeof x==='string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(x);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blobSha = bytes => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
function mode(st){ return st.mode & 0o7777; }
function owned(st){ return typeof process.getuid!=='function' || st.uid===process.getuid(); }
function canonicalDir(fsImpl,location,{privateDir=true}={}){
  if(!path.isAbsolute(location)||path.resolve(location)!==location)throw new Error('NONCANONICAL_PATH');
  const real=fsImpl.realpathSync(location);
  if(real!==location)throw new Error('PATH_ALIAS');
  const st=fsImpl.lstatSync(location);
  if(!st.isDirectory()||st.isSymbolicLink()||!owned(st)||
     (privateDir ? mode(st)!==0o700 : (mode(st)&0o022)!==0))throw new Error('UNSAFE_DIRECTORY');
  return st;
}
function readOwnedFile(fsImpl,file,max=MAX_INTENT,{privateFile=false}={}){
  // Resolve no ancestor symlink or externally writable source path.
  const absolute=path.resolve(file),parts=absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean);
  let current=path.parse(absolute).root;
  for(const part of parts.slice(0,-1)){
    current=path.join(current,part);
    const ancestor=fsImpl.lstatSync(current);
    if(!ancestor.isDirectory()||ancestor.isSymbolicLink()||
      ((ancestor.mode&0o022)!==0 && !(ancestor.uid===0&&(ancestor.mode&0o1000)!==0)) ||
      (typeof process.getuid==='function'&&ancestor.uid!==process.getuid()&&ancestor.uid!==0))
      throw new Error('UNSAFE_SOURCE_ANCESTOR');
  }
  const prior=fsImpl.lstatSync(file);
  if(!prior.isFile()||prior.isSymbolicLink()||prior.nlink!==1||!owned(prior)||prior.size<1||prior.size>max||
    (privateFile?mode(prior)!==0o600:(mode(prior)&0o022)!==0))throw new Error('UNSAFE_FILE');
  if(!fs.constants.O_NOFOLLOW)throw new Error('NOFOLLOW_UNAVAILABLE');
  const fd=fsImpl.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const opened=fsImpl.fstatSync(fd);
    if(!opened.isFile()||!owned(opened)||opened.ino!==prior.ino||opened.dev!==prior.dev||opened.size!==prior.size||mode(opened)!==mode(prior))throw new Error('FILE_CHANGED');
    const bytes=Buffer.alloc(opened.size);
    let pos=0;
    while(pos<bytes.length){const n=fsImpl.readSync(fd,bytes,pos,bytes.length-pos,pos);if(n<=0)throw new Error('SHORT_READ');pos+=n;}
    const fin=fsImpl.fstatSync(fd),last=fsImpl.lstatSync(file);
    if(!last.isFile()||last.isSymbolicLink()||!owned(fin)||!owned(last)||fin.nlink!==1||last.nlink!==1||
       mode(fin)!==mode(prior)||mode(last)!==mode(prior)||fin.ino!==prior.ino||last.ino!==prior.ino||last.dev!==prior.dev||
       fin.size!==prior.size||last.size!==prior.size||fin.mtimeMs!==prior.mtimeMs||last.mtimeMs!==prior.mtimeMs||
       fin.ctimeMs!==prior.ctimeMs||last.ctimeMs!==prior.ctimeMs)throw new Error('FILE_CHANGED');
    return bytes;
  }finally{fsImpl.closeSync(fd);}
}
function rejectDuplicateJsonKeys(text){
  let cursor=0,depth=0;
  const ws=()=>{while(cursor<text.length&&/\s/.test(text[cursor]))cursor++;};
  const string=()=>{
    const start=cursor++;
    while(cursor<text.length){
      if(text[cursor]==='\\'){cursor+=2;continue;}
      if(text[cursor++]==='"')return JSON.parse(text.slice(start,cursor));
    }
    throw new Error('INVALID_JSON');
  };
  const value=()=>{
    ws();if(++depth>64)throw new Error('UNBOUNDED_JSON_DEPTH');
    if(text[cursor]==='"'){string();}
    else if(text[cursor]==='{'){
      cursor++;ws();const keys=new Set();
      if(text[cursor]==='}')cursor++;
      else while(true){
        ws();if(text[cursor]!=='"')throw new Error('INVALID_JSON');
        const key=string();if(keys.has(key))throw new Error('DUPLICATE_JSON_KEY');keys.add(key);
        ws();if(text[cursor++]!==':')throw new Error('INVALID_JSON');value();ws();
        const sep=text[cursor++];if(sep==='}')break;if(sep!==',')throw new Error('INVALID_JSON');
      }
    }else if(text[cursor]==='['){
      cursor++;ws();if(text[cursor]===']')cursor++;
      else while(true){value();ws();const sep=text[cursor++];if(sep===']')break;if(sep!==',')throw new Error('INVALID_JSON');}
    }else{
      const atom=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(cursor));
      if(!atom)throw new Error('INVALID_JSON');cursor+=atom[0].length;
    }
    depth--;
  };
  value();ws();if(cursor!==text.length)throw new Error('INVALID_JSON');
}
function readJson(fsImpl,file){
  const bytes=readOwnedFile(fsImpl,file,MAX_INTENT,{privateFile:true});
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  rejectDuplicateJsonKeys(text);
  const obj=JSON.parse(text);
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('INVALID_JSON');
  return {obj,digest:sha256(bytes)};
}
// git rev-parse / ls-tree / ls-files cannot invoke clean filters. Git process
// and configuration are isolated; worktree content is hashed by Node, not Git.
export function inspectMacosCommittedSource(sourceRoot,{fsImpl=fs,gitRun}={}){
  canonicalDir(fsImpl,sourceRoot,{privateDir:false});
  const gitDir=path.join(sourceRoot,'.git');
  const gd=fsImpl.lstatSync(gitDir);
  if(!gd.isDirectory()||gd.isSymbolicLink()||!owned(gd)||(mode(gd)&0o022)!==0)throw new Error('UNTRUSTED_SOURCE_GIT_DIR');
  const runner=gitRun||((args)=>{
    const env={PATH:'/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin',HOME:os.homedir(),LC_ALL:'C',
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',
      GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_ATTR_NOSYSTEM:'1',
      GIT_CONFIG_COUNT:'5',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false',
      GIT_CONFIG_KEY_1:'core.untrackedCache',GIT_CONFIG_VALUE_1:'false',
      GIT_CONFIG_KEY_2:'maintenance.auto',GIT_CONFIG_VALUE_2:'false',
      GIT_CONFIG_KEY_3:'core.hooksPath',GIT_CONFIG_VALUE_3:'/dev/null',
      GIT_CONFIG_KEY_4:'filter.lfs.required',GIT_CONFIG_VALUE_4:'false'};
    const out=spawnSync('git',['--no-optional-locks',...args],{cwd:sourceRoot,env,encoding:'buffer',timeout:12000,maxBuffer:3_000_000});
    if(out.error||out.status!==0||out.signal)throw new Error('SOURCE_GIT_READ_FAILED');
    return out.stdout;
  });
  const run=args=>{const output=runner(args);if(!Buffer.isBuffer(output)||output.length>3_000_000)throw new Error('GIT_OUTPUT_NOT_BINARY');return output;};
  const head=run(['rev-parse','--verify','HEAD']).toString('ascii').trim();
  const tree=run(['rev-parse','--verify','HEAD^{tree}']).toString('ascii').trim();
  if(!SHA.test(head)||!SHA.test(tree))throw new Error('SOURCE_GIT_SHA_INVALID');
  const rows=(bytes,kind)=>{
    if(!bytes.length||bytes.at(-1)!==0)throw new Error('INVALID_GIT_RECORDS');
    const parts=bytes.subarray(0,-1).toString('utf8').split('\0');
    if(parts.length<1||parts.length>MAX_SOURCE_FILES)throw new Error('SOURCE_FILE_COUNT');
    const out=[];const seen=new Set();
    for(const item of parts){
      const sep=item.indexOf('\t');if(sep<0)throw new Error('INVALID_GIT_ENTRY');
      const meta=item.slice(0,sep),relative=item.slice(sep+1);
      const m=(kind==='tree'?/^(100644|100755) blob ([0-9a-f]{40})$/:/^(100644|100755) ([0-9a-f]{40}) 0$/).exec(meta);
      if(!m||!relative||relative.includes('\\')||relative.startsWith('/')||relative.split('/').some(x=>!x||x==='.'||x==='..'||x==='.git')||seen.has(relative))throw new Error('UNSUPPORTED_SOURCE_ENTRY');
      seen.add(relative);out.push({relative,mode:m[1],blob:m[2]});
    }
    return out.sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
  };
  const committed=rows(run(['ls-tree','-r','-z','HEAD']),'tree');
  const indexed=rows(run(['ls-files','--stage','-z']),'index');
  if(JSON.stringify(committed)!==JSON.stringify(indexed))throw new Error('STAGED_OR_MISSING_SOURCE');
  const others=run(['ls-files','--others','--exclude-standard','-z']);
  if(others.length)throw new Error('UNTRACKED_SOURCE');
  let total=0;const sourceFiles=[];
  for(const entry of committed){
    const p=path.join(sourceRoot,...entry.relative.split('/'));
    const st=fsImpl.lstatSync(p);
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||!owned(st)||st.size>MAX_FILE||st.size<0||
       Boolean(mode(st)&0o111)!==(entry.mode==='100755'))throw new Error('UNSAFE_SOURCE_LEAF');
    total+=st.size;if(total>MAX_SOURCE_BYTES)throw new Error('SOURCE_TOO_LARGE');
    const bytes=readOwnedFile(fsImpl,p,MAX_FILE);
    if(blobSha(bytes)!==entry.blob)throw new Error('DIRTY_SOURCE');
    if(SOURCE_PATHS.includes(entry.relative))sourceFiles.push([entry.relative,sha256(bytes)]);
  }
  if(sourceFiles.length!==SOURCE_PATHS.length)throw new Error('SOURCE_CONTRACT_MISSING');
  return {source_root:sourceRoot,source_commit:head,source_tree:tree,source_file_sha256:sourceFiles.sort((a,b)=>a[0].localeCompare(b[0]))};
}
function receiptShape(receipt){
  return exactKeys(receipt,['schema_version','action_id','scope','challenge','approved_at'])&&
    receipt.schema_version===1&&receipt.action_id===OLD_ACTION&&receipt.scope===OLD_SCOPE&&
    typeof receipt.challenge==='string'&&/^macos-official-fresh-preparation-v1:[a-f0-9]{64}$/.test(receipt.challenge)&&
    typeof receipt.approved_at==='string'&&Number.isFinite(Date.parse(receipt.approved_at));
}
function baselineConditions(state){
  return Boolean(state?.macos_setup_approved===true&&state?.fresh_first_install_bootstrap===true&&
    state?.fresh_first_install_legacy_instance_id==='1832f0bb'&&
    state?.last_error?.error_id==='SETUP-011'&&state?.installation_id&&
    state?.control_environment_ready!==true&&state?.target_environment_ready!==true&&
    state?.ready!==true&&!state?.review_route&&!state?.sandbox_review_route&&
    !state?.control_repository&&!state?.sandbox_repository&&
    !state?.control_clone_path&&!state?.sandbox_clone_path&&
    !state?.sandbox_chat_registration_issue&&!state?.runner_path&&
    !state?.instance_id&&
    state?.macos_receipt_continuity_attempt===undefined&&
    !state?.macos_runner_bootstrap&&!state?.macos_runner_activation);
}
function checkExistingIntent({state,home,fsImpl=fs}){
  const short=canonicalInstallationId(state.installation_id);
  if(short==='1832f0bb'||!/^[-a-z0-9]{8}$/.test(short))throw new Error('INVALID_INSTALLATION_ID');
  const instance=path.join(home,ROOT,'instances',short);
  const intended=path.join(instance,'migration-intent.json');
  if(state.migration_intent_path!==intended||state.migration_intent_phase!=='PREPARED')throw new Error('INTENT_PATH_OR_PHASE_DRIFT');
  canonicalDir(fsImpl,instance);
  const {obj,digest}=readJson(fsImpl,intended);
  const oldSource=obj?.source?.path, oldSha=obj?.exact_refs?.source_head;
  if(obj.schema_version!==1||obj.phase!=='PREPARED'||obj.installation_id!==state.installation_id||
     !SHA.test(oldSha||'')||!isNonempty(oldSource)||!path.isAbsolute(oldSource)||
     path.resolve(oldSource)!==oldSource||!oldSource.startsWith(path.join(home,ROOT,'official-source')+path.sep)||
     path.basename(oldSource)!==oldSha||obj.source?.git?.head!==oldSha||
     obj.destination?.path!==instance||obj.exact_refs?.destination_head!==null||
     obj.preservation?.registry?.target_repository!==state.target_repository||
     obj.generated_repositories?.control!==`${state.github_login}/chatgpt-codex-orchestrator-control-${short}`||
     obj.generated_repositories?.sandbox!==`${state.github_login}/chatgpt-codex-orchestrator-sandbox-${short}`||
     obj.preservation?.registry?.target_environment_ready===true)throw new Error('INTENT_IDENTITY_DRIFT');
  canonicalDir(fsImpl,oldSource,{privateDir:false});
  const originalGit=inspectMacosCommittedSource(oldSource,{fsImpl});
  if(originalGit.source_commit!==oldSha||obj.source?.git?.dirty_count!==0)
    throw new Error('ORIGINAL_SOURCE_GIT_DRIFT');
  const oldFingerprints=[];
  for(const name of SOURCE_PATHS){
    const bytes=readOwnedFile(fsImpl,path.join(oldSource,name),MAX_FILE);
    oldFingerprints.push([name,sha256(bytes)]);
  }
  return {short,intent_sha256:digest,original_source_head:oldSha,original_source_root:oldSource,original_source_files:oldFingerprints};
}
function checkLegacyRoot(home,fsImpl=fs){
  const identity=st=>[String(st.dev),String(st.ino),String(st.uid),String(mode(st)),
    String(st.mtimeMs),String(st.ctimeMs)];
  const root=path.join(home,ROOT,'instances','1832f0bb');
  const roots=[['root',identity(canonicalDir(fsImpl,root))],
    ['short-turn-evidence',identity(canonicalDir(fsImpl,path.join(root,'short-turn-evidence')))]];
  for(const name of ['manual-codex-evidence','review-evidence']){
    const p=path.join(root,name);
    try{roots.push([name,identity(canonicalDir(fsImpl,p))]);}catch(e){if(e?.code!=='ENOENT')throw e;}
  }
  return roots;
}
function challengeFor(binding){
  return 'macos-receipt-continuity-v1:'+sha256(Buffer.from(JSON.stringify(binding)));
}
export function inspectMacosReceiptContinuity({state={},home=os.homedir(),sourceRoot=process.cwd(),fsImpl=fs,gitRun,localPreflight,remotePreflight}={}){
  const fail=(error_id,status='BLOCKED')=>({status,error_id,mutations_performed:false,source_only:true,
    original_receipt_validity:'HISTORICAL_NOT_RECONSTRUCTIBLE',authorization_for_new_sha:false});
  if(!baselineConditions(state))return fail('G3-CONTINUITY-STATE-NOT-ELIGIBLE');
  if(!receiptShape(state.macos_official_fresh_preparation_approval))return fail('G3-CONTINUITY-HISTORICAL-RECEIPT-INVALID');
  try{
    canonicalDir(fsImpl,home,{privateDir:false});
    const legacyIdentity=checkLegacyRoot(home,fsImpl);
    const history=checkExistingIntent({state,home,fsImpl});
    const source=inspectMacosCommittedSource(path.resolve(sourceRoot),{fsImpl,gitRun});
    if(history.original_source_head===source.source_commit) return fail('G3-CONTINUITY-SAME-SOURCE-NOT-RECOVERY');
    if(!validRepo(state.target_repository)||!isNonempty(state.github_login)||
       !/^[A-Za-z0-9-]+$/.test(state.github_login)||!/^https:\/\/chatgpt\.com\/(?:g\/[A-Za-z0-9_-]+\/)?c\/[0-9a-f-]+\/?$/i.test(state.reviewer_chat_url||''))return fail('G3-CONTINUITY-MISSING_BINDINGS');
    // External inventory and all three checkout gates are required for a
    // usable challenge. Uncertainty is NOT proof that repositories are absent.
    const local=localPreflight?.({state,home,source,history});
    if(!local||local.status!=='PASS'||local.mutations_performed!==false)return fail('G3-CONTINUITY-LOCAL_EFFECTS_UNVERIFIED');
    const remote=remotePreflight?.({state,home,source,history});
    if(!remote||remote.status!=='PASS'||remote.owner_login!==state.github_login||
       remote.control!=='VERIFIED_ABSENT'||remote.sandbox!=='VERIFIED_ABSENT'||
       !Number.isSafeInteger(remote.owner_id)||remote.owner_id<=0)return fail('G3-CONTINUITY-REMOTE_EFFECTS_UNVERIFIED');
    const binding={schema_version:1,scope:MACOS_RECEIPT_CONTINUITY_SCOPE,
      installation_id:state.installation_id,instance_id:history.short,
      target_repository:state.target_repository,reviewer_chat_url:state.reviewer_chat_url,github_login:state.github_login,
      github_owner_id:remote.owner_id,source,history,
      original_receipt_sha256:sha256(Buffer.from(JSON.stringify(state.macos_official_fresh_preparation_approval))),
      legacy_root_identity:legacyIdentity};
    const challenge=challengeFor(binding),receipt=state.macos_receipt_continuity_approval;
    if(receipt!==undefined){
      const accepted=exactKeys(receipt,['schema_version','action_id','scope','challenge','approved_at','source_commit','source_tree','binding_sha256'])&&
        receipt.schema_version===1&&receipt.action_id===MACOS_RECEIPT_CONTINUITY_ACTION&&
        receipt.scope===MACOS_RECEIPT_CONTINUITY_SCOPE&&receipt.challenge===challenge&&
        receipt.source_commit===source.source_commit&&receipt.source_tree===source.source_tree&&
        receipt.binding_sha256===sha256(Buffer.from(JSON.stringify(binding)))&&
        typeof receipt.approved_at==='string'&&Number.isFinite(Date.parse(receipt.approved_at));
      return accepted ? {status:'PASS',authorized:true,source_commit:source.source_commit,source_tree:source.source_tree,
        binding_sha256:sha256(Buffer.from(JSON.stringify(binding))),mutations_performed:false,
        original_receipt_validity:'HISTORICAL_NOT_RECONSTRUCTIBLE',old_receipt_preserved:true,
        historical_intent_preserved:true,source_only:false} : fail('G3-CONTINUITY-APPROVAL-CONFLICT');
    }
    return {status:'NEEDS_USER_ACTION',action_id:MACOS_RECEIPT_CONTINUITY_ACTION,
      approval_challenge:challenge,source_commit:source.source_commit,source_tree:source.source_tree,
      binding_sha256:sha256(Buffer.from(JSON.stringify(binding))),mutations_performed:false,
      authorization_for_new_sha:false,original_receipt_validity:'HISTORICAL_NOT_RECONSTRUCTIBLE',old_receipt_preserved:true,
      historical_intent_preserved:true};
  }catch(e){return fail(`G3-CONTINUITY-${e.message&&/^[A-Z0-9_-]{1,80}$/.test(e.message)?e.message:'INSPECTION_FAILED'}`);}
}
export function makeMacosReceiptContinuityReceipt({state={},value,inspection}={}){
  if(state.macos_receipt_continuity_approval!==undefined||
     inspection?.status!=='NEEDS_USER_ACTION'||inspection.action_id!==MACOS_RECEIPT_CONTINUITY_ACTION||
     typeof value!=='string'||inspection.approval_challenge!==value)return null;
  return {schema_version:1,action_id:MACOS_RECEIPT_CONTINUITY_ACTION,
    scope:MACOS_RECEIPT_CONTINUITY_SCOPE,challenge:value,
    source_commit:inspection.source_commit,source_tree:inspection.source_tree,
    binding_sha256:inspection.binding_sha256,approved_at:new Date().toISOString()};
}
