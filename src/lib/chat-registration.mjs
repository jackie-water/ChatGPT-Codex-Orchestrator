import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSafeSync} from "./spawn-safe.mjs";

function runGh(args,{allowFailure=false}={}){
  const r=spawnSafeSync("gh",args,{encoding:"utf8",...(process.platform==="darwin"?{env:{...process.env,GH_HOST:"github.com"}}:{})});
  if(r.status!==0&&!allowFailure) throw new Error((r.stderr||r.stdout||"gh failed").trim());
  return {ok:r.status===0,stdout:(r.stdout||"").trim(),stderr:(r.stderr||"").trim()};
}

export function normalizeChatUrl(value){
  try{
    const u=new URL(value);
    if(u.origin!=="https://chatgpt.com") throw new Error("invalid origin");
    if(!/^\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]+\/?$/.test(u.pathname)) throw new Error("invalid conversation");
    return u.origin+u.pathname.replace(/\/$/,"");
  }catch{
    throw new Error("Invalid ChatGPT conversation URL");
  }
}

export function routeFileForState(state){
  if(state?.chat_route_file) return state.chat_route_file;
  const instance=path.basename(String(state?.runner_path||"default"))||"default";
  return path.join(os.homedir(),".chatgpt-codex-orchestrator","routes",instance,"chat-routes.json");
}

function privateInstanceAncestors(base){
  if(!path.isAbsolute(base)||path.resolve(base)!==base||path.basename(path.dirname(base))!=="instances"||path.basename(path.dirname(path.dirname(base)))!==".chatgpt-codex-orchestrator") return false;
  const home=path.dirname(path.dirname(path.dirname(base))),uid=process.getuid();
  let current=path.parse(base).root;
  for(const part of base.slice(current.length).split(path.sep)){
    current=path.join(current,part);const stat=fs.lstatSync(current);
    if(stat.isSymbolicLink()||!stat.isDirectory()) return false;
    if(current===home){if(stat.uid!==uid||(stat.mode&0o022)) return false;}
    else if(current.startsWith(home+path.sep)){if(stat.uid!==uid||(stat.mode&0o777)!==0o700) return false;}
    else if((stat.uid!==0&&stat.uid!==uid)||((stat.mode&0o022)&&!(stat.uid===0&&(stat.mode&0o1000)))) return false;
  }
  return true;
}

export function findRegisteredChatRoute(state,{projectKey,chatUrl}){
  const file=routeFileForState(state);
  if(!fs.existsSync(file)) return null;
  let registry;
  try{registry=JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));}
  catch{return null;}
  const normalized=normalizeChatUrl(chatUrl);
  if(!Array.isArray(registry?.routes)) return null;
  const matches=registry.routes.filter(x=>
    String(x?.project||"").toLowerCase()===String(projectKey||"").toLowerCase() &&
    String(x?.chat_url||"")===normalized &&
    String(x?.status||"")==="active"
  );
  const match=matches[0];
  if(!match||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(String(match.route||""))) return null;
  if(state?.instance_platform==="darwin"){
    // A route is queued before delivery. It is not installer authority until
    // the one registration delivery owner has observed a real user-role turn.
    const callbackId=`chat-register-${String(projectKey).toLowerCase()}-${match.registration_issue}`;
    const base=state.instance_root;
    if(matches.length!==1||!Number.isSafeInteger(match.registration_issue)||match.registration_issue<=0||match.route!==`chat-${match.registration_issue}`||!base||file!==path.join(base,"chat-routes.json")||path.basename(base)!==state.instance_id||match.installation_id!==state.installation_id) return null;
    const outbox=path.join(base,"pending-wakes",`${callbackId}.json`);
    const journal=path.join(base,"registration-delivery",`${callbackId}.json`);
    try{
      if(!privateInstanceAncestors(base)) return null;
      for(const name of [base,file,path.dirname(outbox),path.dirname(journal),outbox,journal]){
        const stat=fs.lstatSync(name);
        if(stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==(stat.isDirectory()?0o700:0o600)||(!stat.isDirectory()&&(!stat.isFile()||stat.nlink!==1))) return null;
      }
      const receipt=JSON.parse(fs.readFileSync(outbox,"utf8")),proof=JSON.parse(fs.readFileSync(journal,"utf8"));
      if(receipt.delivery_state!=="DELIVERED"||receipt.delivery_owner!=="register-chat.mjs"||receipt.callback_id!==callbackId||receipt.chat_url!==normalized||
        !["committed-user-turn","existing-user-message"].includes(receipt.verified_by)||proof.schema_version!==1||proof.status!=="DELIVERED"||proof.verified_role!=="user"||proof.verified_by!==receipt.verified_by||proof.callback_id!==callbackId||proof.chat_url!==normalized||
        proof.callback_state_sha256!==crypto.createHash("sha256").update(fs.readFileSync(outbox)).digest("hex")) return null;
    }catch{return null;}
  }
  return match;
}

function registrationMarker(state,projectKey,chatUrl){
  const short=String(state?.installation_id||"").replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"default";
  if(state?.instance_platform!=="darwin") return "INSTALL-CHAT-"+short+"-"+String(projectKey).toLowerCase();
  const chat=crypto.createHash("sha256").update(chatUrl).digest("hex").slice(0,16);
  return "INSTALL-CHAT-"+short+"-"+String(projectKey).toLowerCase()+"-"+chat;
}

function listRegistrationIssues(state,projectKey,chatUrl,commandRunner=runGh){
  const marker=registrationMarker(state,projectKey,chatUrl);
  const r=commandRunner([
    "issue","list","--repo",state.control_repository,
    "--state",state?.instance_platform==="darwin"?"open":"all","--limit","100",
    "--search",marker+" in:title",
    "--json","number,title,state,url,body"
  ],{allowFailure:true});
  if(state?.instance_platform==="darwin"){
    if(!r.ok||!r.stdout) throw new Error("Registration issue lookup failed; refusing a duplicate submission");
    let issues;try{issues=JSON.parse(r.stdout);}catch{throw new Error("Registration issue lookup returned malformed JSON; refusing a duplicate submission");}
    if(!Array.isArray(issues)) throw new Error("Registration issue lookup is not an array; refusing a duplicate submission");
    if(issues.length>=100) throw new Error("Registration issue lookup is incomplete at the 100-issue limit; refusing a duplicate submission");
    return issues;
  }
  if(!r.ok||!r.stdout) return [];
  try{return JSON.parse(r.stdout);}catch{return [];}
}

function atomicPrivateJson(file,value){
  const tmp=`${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  const fd=fs.openSync(tmp,"wx",0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);
  const directory=fs.openSync(path.dirname(file),"r");
  try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
function macProcessStart(pid){
  try{
    const r=spawnSafeSync("ps",["-p",String(pid),"-o","lstart="],{encoding:"utf8"});
    if(r.status!==0) return null;
    const value=String(r.stdout||"").trim();
    return value||null;
  }catch{return null;}
}
function macOwnerIdentity(owner){
  if(!owner||!Number.isSafeInteger(owner.pid)||owner.pid<=0||typeof owner.start!=="string"||!owner.start) return "indeterminate";
  try{process.kill(owner.pid,0);}catch(error){return error?.code==="ESRCH"?"dead":"indeterminate";}
  const start=macProcessStart(owner.pid);
  if(start===owner.start) return "live";
  return start===null?"indeterminate":"dead";
}
function macRegistrationGuard(state,projectKey,chatUrl){
  if(state?.instance_platform!=="darwin") return null;
  const base=state.instance_root;
  if(!base||!privateInstanceAncestors(base)||path.basename(base)!==String(state.instance_id)) throw new Error("Unsafe macOS registration identity");
  const identityKey=crypto.createHash("sha256").update(`${String(projectKey)}\n${chatUrl}`).digest("hex").slice(0,24);
  const intent=path.join(base,`registration-intent-${identityKey}`),lock=path.join(base,`registration-intent-${identityKey}.lock`); let saved=null;
  // The claim is deliberately per project/Chat.  Different legitimate Chats
  // must not serialize through, or overwrite, one installation-wide record.
  let occupied=false, ownerNonce=null, ownerStart=null;
  let ownerWritten=false;
  try{fs.mkdirSync(lock,{mode:0o700});ownerNonce=crypto.randomUUID();const start=macProcessStart(process.pid);if(!start) throw new Error("Unable to establish macOS registration owner identity");ownerStart=start;atomicPrivateJson(path.join(lock,"owner"),{schema_version:1,nonce:ownerNonce,pid:process.pid,start});ownerWritten=true;}
  catch(e){if(e.code==="EEXIST") occupied=true;else {if(!ownerWritten)try{const st=fs.lstatSync(lock);if(st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700&&!fs.readdirSync(lock).length)fs.rmdirSync(lock);}catch{}throw e;}}
  let occupiedOwner=null;
  if(occupied){try{occupiedOwner=JSON.parse(fs.readFileSync(path.join(lock,"owner"),"utf8"));}catch{}}
  const ownsClaim=()=>!occupied&&ownerNonce&&(()=>{try{return JSON.parse(fs.readFileSync(path.join(lock,"owner"),"utf8")).nonce===ownerNonce;}catch{return false;}})();
  const releaseClaim=()=>{if(!ownsClaim())return;const quarantine=`${lock}.releasing-${process.pid}-${crypto.randomUUID()}`;let moved=false;try{const before=fs.lstatSync(lock);if(!before.isDirectory()||before.uid!==process.getuid()||(before.mode&0o777)!==0o700)return;fs.renameSync(lock,quarantine);moved=true;const ownerStat=fs.lstatSync(path.join(quarantine,"owner"));if(ownerStat.isSymbolicLink()||!ownerStat.isFile()||ownerStat.nlink!==1||ownerStat.uid!==process.getuid()||(ownerStat.mode&0o777)!==0o600)throw new Error("macOS registration claim owner is not private");const owner=JSON.parse(fs.readFileSync(path.join(quarantine,"owner"),"utf8"));if(owner.schema_version!==1||owner.nonce!==ownerNonce||owner.pid!==process.pid||owner.start!==ownerStart)throw new Error("macOS registration claim ownership changed");fs.unlinkSync(path.join(quarantine,"owner"));fs.rmdirSync(quarantine);}catch{if(moved){try{fs.lstatSync(lock);return;}catch(error){if(error.code!=="ENOENT")return;}try{fs.renameSync(quarantine,lock);}catch{}}}};
  if(fs.existsSync(intent)){
    try{
      const stat=fs.lstatSync(intent);
      if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o600) throw new Error("Unsafe macOS registration claim");
      saved=JSON.parse(fs.readFileSync(intent,"utf8"));
    }catch(e){releaseClaim();if(e.message?.startsWith("Unsafe")) throw e;throw new Error("Malformed macOS registration intent; refusing a duplicate submission");}
  }
  const identity={installation_id:String(state.installation_id),instance_id:String(state.instance_id),instance_root:path.resolve(base),control_repository:String(state.control_repository),project:String(projectKey),chat_url:chatUrl};
  if(saved) for(const k of Object.keys(identity)) if(String(saved[k])!==identity[k]) {releaseClaim();throw new Error("Conflicting macOS registration identity");}
  if(occupied){
    const ownerStatus=macOwnerIdentity(occupiedOwner);
    if(saved?.status==="INTENT"&&ownerStatus==="dead"){
      const quarantine=`${lock}.reclaiming-${process.pid}-${crypto.randomUUID()}`;
      let moved=false;
      try{
        const lockStat=fs.lstatSync(lock);
        const ownerFile=path.join(lock,"owner"),ownerStat=fs.lstatSync(ownerFile);
        if(lockStat.isSymbolicLink()||!lockStat.isDirectory()||lockStat.uid!==process.getuid()||(lockStat.mode&0o777)!==0o700||
          ownerStat.isSymbolicLink()||!ownerStat.isFile()||ownerStat.nlink!==1||ownerStat.uid!==process.getuid()||(ownerStat.mode&0o777)!==0o600||
          ownerStat.ino===undefined||lockStat.ino===undefined) throw new Error("Unsafe macOS registration claim");
        const owner=JSON.parse(fs.readFileSync(ownerFile,"utf8"));
        if(owner.schema_version!==1||owner.nonce!==occupiedOwner?.nonce||owner.pid!==occupiedOwner?.pid||owner.start!==occupiedOwner?.start||
          macOwnerIdentity(owner)!=="dead") throw new Error("macOS registration claim owner is not proven dead");
        fs.renameSync(lock,quarantine);moved=true;
        const movedLock=fs.lstatSync(quarantine),movedOwner=fs.lstatSync(path.join(quarantine,"owner"));
        if(movedLock.dev!==lockStat.dev||movedLock.ino!==lockStat.ino||movedOwner.dev!==ownerStat.dev||movedOwner.ino!==ownerStat.ino) throw new Error("macOS registration claim changed during reclaim");
        const movedOwnerValue=JSON.parse(fs.readFileSync(path.join(quarantine,"owner"),"utf8"));
        if(movedOwnerValue.schema_version!==1||movedOwnerValue.nonce!==owner.nonce||movedOwnerValue.pid!==owner.pid||movedOwnerValue.start!==owner.start||macOwnerIdentity(movedOwnerValue)!=="dead") throw new Error("macOS registration claim changed during reclaim");
        fs.unlinkSync(path.join(quarantine,"owner"));fs.rmdirSync(quarantine);
        return macRegistrationGuard(state,projectKey,chatUrl);
      }catch(e){
        if(moved){try{fs.lstatSync(lock);return {saved,occupied:true,ownerStatus:"indeterminate"};}catch(error){if(error.code!=="ENOENT")return {saved,occupied:true,ownerStatus:"indeterminate"};}try{fs.renameSync(quarantine,lock);}catch{}}
        if(e.message?.startsWith("Unsafe")) throw e;
        return {saved,occupied:true,ownerStatus:"indeterminate"};
      }
    }else return {saved,occupied,ownerStatus};
  }
  try{if(!saved){saved={schema_version:1,status:"INTENT",...identity};if(!occupied) atomicPrivateJson(intent,saved);}
    return {saved,occupied,commit(issue){if(!ownsClaim()) throw new Error("macOS registration claim is not owned");atomicPrivateJson(intent,{...saved,status:"COMMITTED",issue:{number:issue.number||null,url:issue.url||issue.html_url||null,title:issue.title||null}});},markAttempted(){if(!ownsClaim()) throw new Error("macOS registration claim is not owned");saved={...saved,status:"CREATE_ATTEMPTED",attempt:{generation:ownerNonce,creator_pid:process.pid,creator_start:ownerStart,marker:registrationMarker(state,projectKey,chatUrl),installation_id:identity.installation_id,control_repository:identity.control_repository,project:identity.project,chat_url:identity.chat_url}};atomicPrivateJson(intent,saved);},markUnknown(){if(!ownsClaim()) throw new Error("macOS registration claim is not owned");saved={...saved,status:"OUTCOME_UNKNOWN",attempt:{...(saved.attempt||{}),generation:ownerNonce,creator_pid:process.pid,creator_start:ownerStart,marker:registrationMarker(state,projectKey,chatUrl),installation_id:identity.installation_id,control_repository:identity.control_repository,project:identity.project,chat_url:identity.chat_url}};atomicPrivateJson(intent,saved);},release:releaseClaim,retain(){}};
  }catch(e){releaseClaim();throw e;}
}
function exactMacIssues(state,projectKey,chatUrl,issues){return issues.filter(x=>String(x.state||"").toUpperCase()==="OPEN"&&String(x.title||"")==="[CHAT-REGISTER] "+registrationMarker(state,projectKey,chatUrl)&&(()=>{try{const b=JSON.parse(x.body);return b.project===projectKey&&normalizeChatUrl(b.chat_url)===chatUrl&&String(b.installation_id)===String(state.installation_id);}catch{return false;}})());}
function hasPendingMacReceipt(state,projectKey,chatUrl){
  const base=state?.instance_root;if(!base)return false;
  for(const dir of ["pending-wakes","registration-delivery"]){
    const folder=path.join(base,dir);let names;try{names=fs.readdirSync(folder);}catch{continue;}
    for(const name of names){if(!name.endsWith(".json"))continue;try{const value=JSON.parse(fs.readFileSync(path.join(folder,name),"utf8"));if(String(value.chat_url||"")===chatUrl&&String(value.callback_id||"").startsWith(`chat-register-${String(projectKey).toLowerCase()}-`))return true;}catch{}}
  } return false;
}
function readDurableMacAttempt(state,projectKey,chatUrl){
  try{
    const key=crypto.createHash("sha256").update(`${String(projectKey)}\n${chatUrl}`).digest("hex").slice(0,24);
    const value=JSON.parse(fs.readFileSync(path.join(state.instance_root,`registration-intent-${key}`),"utf8"));
    if(!["CREATE_ATTEMPTED","OUTCOME_UNKNOWN"].includes(value.status)||String(value.installation_id)!==String(state.installation_id)||String(value.control_repository)!==String(state.control_repository)||String(value.project)!==String(projectKey)||String(value.chat_url)!==chatUrl) return null;
    const attempt=value.attempt||null;
    if(!attempt||typeof attempt.generation!=="string") return {status:value.status,attempt:null,ownerStatus:"indeterminate"};
    const lock=path.join(state.instance_root,`registration-intent-${key}.lock`);
    const owner=JSON.parse(fs.readFileSync(path.join(lock,"owner"),"utf8"));
    if(owner.schema_version!==1||owner.nonce!==attempt.generation||!Number.isSafeInteger(owner.pid)||owner.pid<=0||typeof owner.start!=="string"||!owner.start) return {status:value.status,attempt:null,ownerStatus:"indeterminate"};
    return {status:value.status,attempt,ownerStatus:macOwnerIdentity(owner)};
  }catch{return null;}
}

export function ensureInstallerChatRegistration(state,{projectKey,commandRunner=runGh}){
  if(!state?.control_repository) throw new Error("Control repository is not configured");
  if(!projectKey) throw new Error("projectKey is required");
  const chatUrl=normalizeChatUrl(state?.reviewer_chat_url);

  const registered=findRegisteredChatRoute(state,{projectKey,chatUrl});
  if(registered){
    return {status:"READY",route:String(registered.route),record:registered};
  }

  const marker=registrationMarker(state,projectKey,chatUrl);
  // A verified canonical Issue is a read-only answer: do not create an intent
  // or lock merely to observe it.
  if(state?.instance_platform==="darwin"){
    let initial;
    try{initial=listRegistrationIssues(state,projectKey,chatUrl,commandRunner);}
    catch(e){const durable=readDurableMacAttempt(state,projectKey,chatUrl);if(durable){return {status:durable.status==="OUTCOME_UNKNOWN"||durable.ownerStatus==="dead"?"NEEDS_HUMAN":"WAITING",route:null,issue:null,attempt:durable.attempt};}throw e;}
    const initialCandidates=exactMacIssues(state,projectKey,chatUrl,initial);
    if(initialCandidates.length>1) throw new Error("Multiple registration issues match this exact Chat; refusing ambiguous submission");
    if(initialCandidates.length===1) return {status:"WAITING",route:null,issue:initialCandidates[0]};
    if(hasPendingMacReceipt(state,projectKey,chatUrl)) return {status:"WAITING",route:null,issue:null};
  }
  const guard=macRegistrationGuard(state,projectKey,chatUrl);
  if(guard?.occupied){
    if(guard.saved?.status==="OUTCOME_UNKNOWN") return {status:"NEEDS_HUMAN",route:null,issue:null,attempt:guard.saved.attempt||null};
    return {status:guard.ownerStatus!=="dead"&&["INTENT","CREATE_ATTEMPTED"].includes(guard.saved?.status)?"WAITING":"NEEDS_HUMAN",route:null,issue:null,attempt:guard.saved?.attempt||null};
  }
  let createAttempted=false;
  try{
  const listed=listRegistrationIssues(state,projectKey,chatUrl,commandRunner);
  const candidates=listed.filter(x=>{
    if(state?.instance_platform!=="darwin") return String(x.title||"").includes(marker);
    if(String(x.state||"").toUpperCase()!=="OPEN"||String(x.title||"")!=="[CHAT-REGISTER] "+marker) return false;
    try{const body=JSON.parse(x.body);return body.project===projectKey&&normalizeChatUrl(body.chat_url)===chatUrl&&body.installation_id===state.installation_id;}catch{return false;}
  });
  const macCandidates=state?.instance_platform==="darwin"?exactMacIssues(state,projectKey,chatUrl,listed):candidates;
  const selected=state?.instance_platform==="darwin"?macCandidates:candidates;
  if(state?.instance_platform==="darwin"&&selected.length>1) throw new Error("Multiple registration issues match this exact Chat; refusing ambiguous submission");
  let issue=selected[0];
  if(!issue&&guard?.saved?.status&&guard.saved.status!=="INTENT"){
    throw new Error("Registration outcome is uncertain; refusing an unverified duplicate submission");
  }
  if(!issue){
    const title="[CHAT-REGISTER] "+marker;
    const body=JSON.stringify({
      project:projectKey,
      chat_url:chatUrl,
      installation_id:state.installation_id
    },null,2);
    let r;
    guard?.markAttempted();createAttempted=true;
    try{r=commandRunner(["issue","create","--repo",state.control_repository,"--title",title,"--body",body]);}
    catch(e){
      try{guard?.markUnknown();}
      catch(markError){try{e.cause=markError;}catch{}}
      throw e;
    }
    const output=String(r?.stdout||"");
    const url=output.split(/\s+/).find(x=>/^https:\/\/github\.com\//.test(x));
    if(!url){guard?.markUnknown();throw new Error("Registration issue creation returned an ambiguous response; refusing a duplicate submission");}
    issue={title,url};
  }

  guard?.commit(issue);guard?.release();return {status:"WAITING",route:null,issue};
  }catch(e){if(createAttempted) guard?.retain(); else guard?.release();throw e;}
}
