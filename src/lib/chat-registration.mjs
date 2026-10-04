import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSafeSync} from "./spawn-safe.mjs";

function runGh(args,{allowFailure=false}={}){
  const r=spawnSafeSync("gh",args,{encoding:"utf8"});
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

export function findRegisteredChatRoute(state,{projectKey,chatUrl}){
  const file=routeFileForState(state);
  if(!fs.existsSync(file)) return null;
  let registry;
  try{registry=JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));}
  catch{return null;}
  const normalized=normalizeChatUrl(chatUrl);
  const match=(registry?.routes||[]).find(x=>
    String(x?.project||"").toLowerCase()===String(projectKey||"").toLowerCase() &&
    String(x?.chat_url||"")===normalized &&
    String(x?.status||"")==="active"
  );
  if(!match||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(String(match.route||""))) return null;
  return match;
}

function registrationMarker(state,projectKey){
  const short=String(state?.installation_id||"").replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"default";
  return "INSTALL-CHAT-"+short+"-"+String(projectKey).toLowerCase();
}

function listRegistrationIssues(state,projectKey){
  const marker=registrationMarker(state,projectKey);
  const r=runGh([
    "issue","list","--repo",state.control_repository,
    "--state","all","--limit","100",
    "--search",marker+" in:title",
    "--json","number,title,state,url,body"
  ],{allowFailure:true});
  if(!r.ok||!r.stdout) return [];
  try{return JSON.parse(r.stdout);}catch{return [];}
}

export function ensureInstallerChatRegistration(state,{projectKey}){
  if(!state?.control_repository) throw new Error("Control repository is not configured");
  if(!projectKey) throw new Error("projectKey is required");
  const chatUrl=normalizeChatUrl(state?.reviewer_chat_url);

  const registered=findRegisteredChatRoute(state,{projectKey,chatUrl});
  if(registered){
    return {status:"READY",route:String(registered.route),record:registered};
  }

  const marker=registrationMarker(state,projectKey);
  let issue=listRegistrationIssues(state,projectKey).find(x=>String(x.title||"").includes(marker));
  if(!issue){
    const title="[CHAT-REGISTER] "+marker;
    const body=JSON.stringify({
      project:projectKey,
      chat_url:chatUrl,
      installation_id:state.installation_id
    },null,2);
    const r=runGh(["issue","create","--repo",state.control_repository,"--title",title,"--body",body]);
    const url=r.stdout.split(/\s+/).find(x=>/^https:\/\/github\.com\//.test(x))||r.stdout;
    issue={title,url};
  }

  return {status:"WAITING",route:null,issue};
}
