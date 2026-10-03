const target=process.argv[2];
if(!target||!target.startsWith("https://chatgpt.com/")){
  console.error("NAVIGATE_CHAT_FAILED: invalid ChatGPT URL");
  process.exit(2);
}
const port=process.env.ORCHESTRATOR_BROWSER_DEBUG_PORT||"9333";

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

async function main(){
  const pages=await fetch("http://127.0.0.1:"+port+"/json/list").then(r=>{
    if(!r.ok) throw new Error("Browser debug endpoint returned "+r.status);
    return r.json();
  });
  const page=pages.find(p=>p.type==="page"&&p.webSocketDebuggerUrl);
  if(!page) throw new Error("No browser page available");
  const {ws,send}=await connect(page.webSocketDebuggerUrl);
  try{
    await send("Page.bringToFront");
    await send("Page.navigate",{url:target});
    console.log("REVIEWER_CHAT_NAVIGATED");
  }finally{ws.close();}
}
main().catch(e=>{console.error("NAVIGATE_CHAT_FAILED: "+e.message);process.exit(1);});
