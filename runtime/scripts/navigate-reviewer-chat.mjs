const target=process.argv[2];
if(!target||!target.startsWith("https://chatgpt.com/")){
  console.error("NAVIGATE_CHAT_FAILED: invalid ChatGPT URL");
  process.exit(2);
}
const port=process.env.ORCHESTRATOR_BROWSER_DEBUG_PORT||"9333";

function normalize(value){
  try{
    const u=new URL(value);
    return u.origin+u.pathname.replace(/\/$/,"");
  }catch{return "";}
}

async function connect(wsUrl){
  if(typeof WebSocket==="undefined") throw new Error("Node.js 22+ is required");
  const ws=new WebSocket(wsUrl);
  let id=1;
  const pending=new Map();
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("CDP timeout")),5000);
    ws.onopen=()=>{clearTimeout(timer);resolve();};
    ws.onerror=()=>reject(new Error("CDP websocket error"));
  });
  ws.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(!msg.id||!pending.has(msg.id)) return;
    const p=pending.get(msg.id);pending.delete(msg.id);
    msg.error?p.reject(new Error(msg.error.message||"CDP error")):p.resolve(msg.result);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const callId=id++;pending.set(callId,{resolve,reject});
    ws.send(JSON.stringify({id:callId,method,params}));
  });
  return {ws,send};
}

async function listPages(){
  return fetch("http://127.0.0.1:"+port+"/json/list").then(r=>{
    if(!r.ok) throw new Error("Browser debug endpoint returned "+r.status);
    return r.json();
  });
}

async function main(){
  const wanted=normalize(target);
  let pages=await listPages();
  let page=pages.find(p=>p.type==="page"&&p.webSocketDebuggerUrl&&normalize(p.url||"")===wanted);

  if(!page){
    const response=await fetch(
      "http://127.0.0.1:"+port+"/json/new?"+encodeURIComponent(target),
      {method:"PUT"}
    );
    if(!response.ok) throw new Error("Could not create target Chat tab: "+response.status);
    const created=await response.json();
    await new Promise(r=>setTimeout(r,800));
    pages=await listPages();
    page=pages.find(p=>p.type==="page"&&p.webSocketDebuggerUrl&&normalize(p.url||"")===wanted)||
      (created?.webSocketDebuggerUrl?created:null);
  }

  if(!page?.webSocketDebuggerUrl) throw new Error("Could not prepare exact target Chat tab");

  const {ws,send}=await connect(page.webSocketDebuggerUrl);
  try{
    await send("Page.bringToFront");
    const href=await send("Runtime.evaluate",{
      expression:"location.href",
      returnByValue:true
    });
    const actual=href?.result?.value||"";
    if(normalize(actual)!==wanted) throw new Error("Prepared tab does not match target Chat");
    console.log("REVIEWER_CHAT_READY");
  }finally{ws.close();}
}

main().catch(e=>{console.error("NAVIGATE_CHAT_FAILED: "+e.message);process.exit(1);});
