import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = process.env.ORCHESTRATOR_BROWSER_DEBUG_PORT || "9333";
const routeFile = process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE ||
  path.join(os.homedir(), ".chatgpt-codex-orchestrator", "issue-routes.json");

const conversationUrl = /^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]+(?:[/?#].*)?$/;

function normalizeChatUrl(value) {
  try {
    const u = new URL(value);
    if (u.origin !== "https://chatgpt.com") return null;
    if (!conversationUrl.test(u.href)) return null;
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

async function connect(wsUrl) {
  if (typeof WebSocket === "undefined") throw new Error("Node.js 22+ is required");
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("CDP timeout")),5000);
    ws.onopen=()=>{clearTimeout(timer);resolve();};
    ws.onerror=()=>reject(new Error("CDP websocket error"));
  });
  ws.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(!msg.id||!pending.has(msg.id)) return;
    const p=pending.get(msg.id); pending.delete(msg.id);
    msg.error?p.reject(new Error(msg.error.message||"CDP error")):p.resolve(msg.result);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const callId=id++; pending.set(callId,{resolve,reject});
    ws.send(JSON.stringify({id:callId,method,params}));
  });
  return {ws,send};
}

async function assistantEvidence(wsUrl){
  const {ws,send}=await connect(wsUrl);
  try{
    const result=await send("Runtime.evaluate",{
      expression:`(() => [...document.querySelectorAll('[data-message-author-role="assistant"]')]
        .map(n => (n.innerText || n.textContent || '').trim())
        .join('\\n'))()`,
      returnByValue:true,
      awaitPromise:true
    });
    return result?.result?.value||"";
  }finally{ws.close();}
}

function readRegistry(){
  try{
    const raw=fs.readFileSync(routeFile,"utf8").replace(/^\uFEFF/,"");
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=="object") throw new Error("invalid registry");
    if(!parsed.issues||typeof parsed.issues!=="object") parsed.issues={};
    parsed.version=1;
    return parsed;
  }catch{
    return {version:1,issues:{}};
  }
}

function writeRegistry(registry){
  fs.mkdirSync(path.dirname(routeFile),{recursive:true});
  const temp=routeFile+"."+process.pid+".tmp";
  fs.writeFileSync(temp,JSON.stringify(registry,null,2)+"\n","utf8");
  fs.renameSync(temp,routeFile);
}

async function main(){
  const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>{
    if(!r.ok) throw new Error(`Edge debug endpoint returned ${r.status}`);
    return r.json();
  });
  const registry=readRegistry();
  const now=new Date().toISOString();
  let discovered=0,refreshed=0;
  const conflicts=[];

  for(const page of pages){
    if(page.type!=="page"||!page.webSocketDebuggerUrl) continue;
    const chatUrl=normalizeChatUrl(page.url||"");
    if(!chatUrl) continue;

    let assistantText="";
    try{assistantText=await assistantEvidence(page.webSocketDebuggerUrl);}
    catch(err){console.warn("ORIGIN_SCAN_PAGE_FAILED:",chatUrl,err.message);continue;}

    const candidates=new Map();
    const re=/\[ORCHESTRATOR-ORIGIN\s+issue=(\d+)\s+project=([a-z0-9._-]+)\]/gi;
    for(const match of assistantText.matchAll(re)) candidates.set(match[1],match[2].toLowerCase());

    for(const [issue,project] of candidates){
      const existing=registry.issues[issue];
      if(existing?.chat_url&&normalizeChatUrl(existing.chat_url)!==chatUrl){
        conflicts.push({issue,existing:existing.chat_url,observed:chatUrl});
        continue;
      }
      if(!existing){
        registry.issues[issue]={project,chat_url:chatUrl,captured_at_utc:now,last_seen_utc:now};
        discovered++;
      }else{
        existing.project=existing.project||project;
        existing.chat_url=chatUrl;
        existing.last_seen_utc=now;
        refreshed++;
      }
    }
  }

  writeRegistry(registry);
  for(const conflict of conflicts) console.warn("ORIGIN_ROUTE_CONFLICT:",JSON.stringify(conflict));
  console.log("ORIGIN_ROUTE_SCAN:",JSON.stringify({
    route_file:routeFile,discovered,refreshed,conflicts:conflicts.length,total:Object.keys(registry.issues).length
  }));
  if(conflicts.length) process.exitCode=3;
}

main().catch(err=>{
  console.error("ORIGIN_ROUTE_SCAN_FAILED:",err.message);
  process.exit(1);
});
