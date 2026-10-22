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
    return issues;
  }
  if(!r.ok||!r.stdout) return [];
  try{return JSON.parse(r.stdout);}catch{return [];}
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
  const candidates=listRegistrationIssues(state,projectKey,chatUrl,commandRunner).filter(x=>{
    if(state?.instance_platform!=="darwin") return String(x.title||"").includes(marker);
    if(String(x.state||"").toUpperCase()!=="OPEN"||String(x.title||"")!=="[CHAT-REGISTER] "+marker) return false;
    try{const body=JSON.parse(x.body);return body.project===projectKey&&normalizeChatUrl(body.chat_url)===chatUrl&&body.installation_id===state.installation_id;}catch{return false;}
  });
  if(state?.instance_platform==="darwin"&&candidates.length>1) throw new Error("Multiple registration issues match this exact Chat; refusing ambiguous submission");
  let issue=candidates[0];
  if(!issue){
    const title="[CHAT-REGISTER] "+marker;
    const body=JSON.stringify({
      project:projectKey,
      chat_url:chatUrl,
      installation_id:state.installation_id
    },null,2);
    const r=commandRunner(["issue","create","--repo",state.control_repository,"--title",title,"--body",body]);
    const url=r.stdout.split(/\s+/).find(x=>/^https:\/\/github\.com\//.test(x))||r.stdout;
    issue={title,url};
  }

  return {status:"WAITING",route:null,issue};
}
