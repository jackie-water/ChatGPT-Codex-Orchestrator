import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {canInsertCallbackDraft, selectSafeSendButton, deliverCallback} from "../runtime/scripts/callback-delivery.mjs";
import {registerChat} from "../runtime/scripts/register-chat.mjs";
import {findRegisteredChatRoute, ensureInstallerChatRegistration} from "../src/lib/chat-registration.mjs";
const script=path.resolve("runtime/scripts/register-chat.mjs");
const TEST_BROWSER_DEBUG_PORT="0";
const fixtures=new Set();
test.afterEach(()=>{for(const f of fixtures){fs.rmSync(f.root,{recursive:true,force:true});fixtures.delete(f);}});
function fixture(){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"macos-register-chat-")),home=path.join(root,"home"),control=path.join(root,"control");fs.mkdirSync(control,{recursive:true});fs.mkdirSync(home);fs.writeFileSync(path.join(control,"instance.json"),JSON.stringify({instance_id:"test-instance",platform:"win32"}));fs.writeFileSync(path.join(control,"projects.json"),JSON.stringify({projects:{alpha:{},beta:{}}}));const f={root,home,control,event(project="alpha",number=165,url="https://chatgpt.com/c/chat-165",author="trusted"){const file=path.join(root,`${number}-${project}.json`);fs.writeFileSync(file,JSON.stringify({issue:{number,user:{login:author},body:JSON.stringify({project,chat_url:url})}}));return file;}};fixtures.add(f);return f;}
function run(f,e,extra=[]){return execFileSync(process.execPath,[script,...(e?["--event-path",e]:[]),"--control-root",f.control,"--trusted-github-username","trusted",...extra],{env:{...process.env,HOME:f.home,USERPROFILE:f.home,RUNNER_OS:"Windows",ORCHESTRATOR_BROWSER_DEBUG_PORT:TEST_BROWSER_DEBUG_PORT},encoding:"utf8"});}
function state(f,p="alpha",n=165){return JSON.parse(fs.readFileSync(path.join(f.home,".chatgpt-codex-orchestrator","instances","test-instance","pending-wakes",`chat-register-${p}-${n}.json`)));}
test("trusted author, normalized URL, replay, and project isolation",()=>{const f=fixture(),e=f.event();assert.match(run(f,e),/route=chat-165/);assert.equal(state(f).chat_url,"https://chatgpt.com/c/chat-165");assert.equal(run(f,e),run(f,e));run(f,f.event("beta",166,"https://chatgpt.com/g/team/c/chat-166"));const r=JSON.parse(fs.readFileSync(path.join(f.home,".chatgpt-codex-orchestrator/instances/test-instance/chat-routes.json")));assert.equal(r.routes.length,2);});
test("invalid author, project, URL, and event are rejected",()=>{for(const make of [f=>f.event("alpha",165,"https://chatgpt.com/c/x","intruder"),f=>f.event("missing"),f=>f.event("alpha",165,"https://example.com/c/x"),f=>path.join(f.root,"bad.json")]){const f=fixture(),e=make(f);if(e.endsWith("bad.json"))fs.writeFileSync(e,"not-json");assert.throws(()=>run(f,e));}});
test("route collision, outbox conflict, symlink, and lock fail closed",()=>{const f=fixture();run(f,f.event());const b=path.join(f.home,".chatgpt-codex-orchestrator/instances/test-instance");fs.writeFileSync(path.join(b,"chat-routes.json"),JSON.stringify({version:1,routes:[{route:"chat-165",project:"beta",chat_url:"https://chatgpt.com/c/other",status:"active"}]}));assert.throws(()=>run(f,f.event()));const g=fixture();run(g,g.event());const o=path.join(g.home,".chatgpt-codex-orchestrator/instances/test-instance/pending-wakes/chat-register-alpha-165.json");fs.writeFileSync(o,JSON.stringify({...state(g),message:"tampered"}));assert.throws(()=>run(g,g.event()));const h=fixture();fs.symlinkSync(path.join(h.root,"elsewhere"),path.join(h.home,".chatgpt-codex-orchestrator"));assert.throws(()=>run(h,h.event()));const i=fixture(),bi=path.join(i.home,".chatgpt-codex-orchestrator/instances/test-instance");fs.mkdirSync(bi,{recursive:true});fs.writeFileSync(path.join(bi,"chat-routes.json.lock"),"lock");assert.throws(()=>run(i,i.event()),/lock is occupied/);});
test("delivery parent cleanup cushion exceeds the child wake budget",()=>{const f=fixture();assert.notEqual(TEST_BROWSER_DEBUG_PORT,process.env.ORCHESTRATOR_BROWSER_DEBUG_PORT);assert.equal(TEST_BROWSER_DEBUG_PORT,"0");run(f,f.event());assert.equal(state(f).delivery_state,"PENDING");const s=fs.readFileSync(script,"utf8");const child=s.match(/const DELIVERY_TIMEOUT_MS = (\d+);/)?.[1];const cushion=s.match(/const DELIVERY_CLEANUP_CUSHION_MS = (\d+);/)?.[1];const parent=s.match(/const DELIVERY_SPAWN_TIMEOUT_MS = DELIVERY_TIMEOUT_MS \+ DELIVERY_CLEANUP_CUSHION_MS;/);assert.equal(Number(cushion)>=10000,true);assert.ok(parent);assert.match(s,/timeout:DELIVERY_SPAWN_TIMEOUT_MS/);assert.match(s,/CODEX_WAKE_DEADLINE_MS:String\(DELIVERY_TIMEOUT_MS\)/);assert.equal(Number(child)+Number(cushion),140000);});
test("isolated wake fixture waits busy->idle, inserts only owned draft, and clicks only identified Send",async()=>{const expected="https://chatgpt.com/c/chat-303",message="[CODEX-AUTO callback_id=fixture] payload";const stop=[{aria:"Stop generating",disabled:false}], send=[{aria:"Send",disabled:false}], unsafe=[{text:"Submit",type:"submit",disabled:false}];assert.deepEqual(canInsertCallbackDraft({destination:expected,expectedDestination:expected,draft:"",message,busy:true}),{ok:false,reason:"chat-busy-generating"});assert.equal(selectSafeSendButton({destination:expected,expectedDestination:expected,draft:message,message,busy:true,buttons:stop}),-1);assert.equal(canInsertCallbackDraft({destination:expected,expectedDestination:expected,draft:"",message,busy:false}).ok,true);assert.equal(selectSafeSendButton({destination:expected,expectedDestination:expected,draft:message,message,busy:false,buttons:send}),0);for(const controls of [unsafe,[{aria:"Send",disabled:true}]]) assert.equal(selectSafeSendButton({destination:expected,expectedDestination:expected,draft:message,message,busy:false,buttons:controls}),-1);assert.equal(selectSafeSendButton({destination:"https://chatgpt.com/c/other",expectedDestination:expected,draft:message,message,busy:false,buttons:send}),-1);assert.equal(selectSafeSendButton({destination:expected,expectedDestination:expected,draft:"unrelated",message,busy:false,buttons:send}),-1);let state="PENDING",clicks=0;const ambiguous=Object.assign(new Error("CDP lost after click"),{code:"SUBMISSION_AMBIGUOUS",submissionAttempted:true});await assert.rejects(()=>deliverCallback({read:()=>({delivery_state:state}),hasReceipt:async()=>false,update:next=>{state=next;},beforeSend:async()=>{},send:async()=>{clicks++;throw ambiguous;}}));assert.equal(state,"SUBMISSION_ATTEMPTED");assert.equal((await deliverCallback({read:()=>({delivery_state:state}),hasReceipt:async()=>false,update:()=>{},send:async()=>{clicks++;}})).action,"reconcile");assert.equal(clicks,1);});
test("durable trusted terminal proof replays without browser",()=>{const f=fixture(),e=f.event();run(f,e);const file=path.join(f.home,".chatgpt-codex-orchestrator/instances/test-instance/pending-wakes/chat-register-alpha-165.json");const before=state(f);fs.writeFileSync(file,JSON.stringify({...before,delivery_state:"DELIVERED",verified_by:"committed-user-turn"}));assert.match(run(f,e,["--deliver"]),/CHAT_ROUTE_ALREADY_DELIVERED/);assert.deepEqual(state(f),JSON.parse(fs.readFileSync(file,"utf8")));});
test("unproven terminal proof fails closed without browser mutation",()=>{const f=fixture(),e=f.event();run(f,e);const file=path.join(f.home,".chatgpt-codex-orchestrator/instances/test-instance/pending-wakes/chat-register-alpha-165.json");const before={...state(f),delivery_state:"DELIVERED",verified_by:"submission-confirmed"};fs.writeFileSync(file,JSON.stringify(before));assert.throws(()=>run(f,e,["--deliver"]));assert.deepEqual(state(f),before);});
test("pending failed delivery remains queued",()=>{const f=fixture(),e=f.event();run(f,e);assert.equal(state(f).delivery_state,"PENDING");assert.throws(()=>run(f,e,["--deliver"]));const after=state(f);assert.equal(after.delivery_state,"PENDING");assert.equal(after.submission_attempted,undefined);});
test("recover repairs a crash fixture idempotently without delivery",()=>{const f=fixture(),e=f.event();run(f,e);const base=path.join(f.home,".chatgpt-codex-orchestrator/instances/test-instance"),routes=path.join(base,"chat-routes.json"),out=path.join(base,"pending-wakes/chat-register-alpha-165.json"),journal=path.join(base,"registration-intents");const original=JSON.parse(fs.readFileSync(routes));fs.rmSync(out);fs.rmSync(routes);fs.mkdirSync(journal,{recursive:true});const queued={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"chat-register-alpha-165",chat_url:"https://chatgpt.com/c/chat-165",message:"recovery"};fs.writeFileSync(path.join(journal,"chat-register-alpha-165.json"),JSON.stringify({version:1,project:"alpha",route:"chat-165",chat_url:queued.chat_url,callback_id:queued.callback_id,message:queued.message,route_record:original.routes[0],outbox:queued}));const output=run(f,null,["--recover"]);assert.match(output,/delivery_state=PENDING/);assert.deepEqual(JSON.parse(fs.readFileSync(out)),queued);assert.equal(fs.readdirSync(journal).length,0);assert.match(run(f,null,["--recover"]),/^$/m);});

function privateJson(file, value) { fs.writeFileSync(file, JSON.stringify(value), {mode:0o600}); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function macFixture() {
  const f = fixture(); fs.chmodSync(f.home, 0o700);
  f.base = path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "test-instance");
  fs.mkdirSync(f.base, {recursive:true, mode:0o700});
  f.metadata = {instance_id:"test-instance", installation_id:"test-install", platform:"darwin", arch:"arm64", instance_root:f.base,
    chat_route_file:path.join(f.base,"chat-routes.json"), pending_wake_outbox:path.join(f.base,"pending-wakes"), control_repository:"owner/control-new",
    control_repository_id:"9001", runner_label:"codex-test-instance", trusted_github_username:"trusted", browser_profile:path.join(f.base,"browser-profile"), browser_port:19333};
  fs.mkdirSync(f.metadata.browser_profile,{mode:0o700});
  fs.rmSync(path.join(f.control,"instance.json")); privateJson(path.join(f.control,"instance.json"), f.metadata);
  privateJson(path.join(f.control,"projects.json"), {projects:{alpha:{},beta:{},"orchestrator-dev":{}}});
  f.event = (project="alpha", number=165, url="https://chatgpt.com/c/chat-165", patch={}) => {
    const file=path.join(f.root, `mac-${number}-${project}.json`);
    privateJson(file, {action:"opened", repository:{full_name:f.metadata.control_repository,id:9001}, issue:{number,state:"open",title:"[CHAT-REGISTER] INSTALL-CHAT-test",user:{login:"trusted"},body:JSON.stringify({project,chat_url:url,installation_id:f.metadata.installation_id})},...patch});
    return file;
  };
  f.outbox = n => path.join(f.base,"pending-wakes",`chat-register-alpha-${n || 165}.json`);
  f.journal = n => path.join(f.base,"registration-delivery",`chat-register-alpha-${n || 165}.json`);
  f.call = (event, spawn, deliver=true, env={}) => registerChat({argv:["--event-path",event,"--control-root",f.control,"--trusted-github-username","trusted",...(deliver?["--deliver"]:[])], home:f.home,
    env:{RUNNER_OS:"macOS",RUNNER_ARCH:"ARM64",RUNNER_NAME:f.metadata.runner_label,ORCHESTRATOR_CHAT_URL:"https://chatgpt.com/c/foreign",ORCHESTRATOR_BROWSER_DEBUG_PORT:"9999",...env}, spawn, log:()=>{}});
  return f;
}
function userReceipt(_executable, _argv, options) {
  const file=options.env.CODEX_CALLBACK_STATE_FILE, before=readJson(file);
  privateJson(file, {...before,delivery_state:"DELIVERED",verified_by:"existing-user-message"});
  return {status:0,stdout:`CHAT_WAKE_ALREADY_DELIVERED: ${before.callback_id}`};
}
test("Mac registration has one pinned delivery owner and a durable user receipt before READY",()=>{
  const f=macFixture(), event=f.event();let calls=0;
  const state={instance_platform:"darwin",instance_root:f.base,instance_id:"test-instance",installation_id:"test-install",chat_route_file:f.metadata.chat_route_file};
  const send=(exe,argv,options)=>{calls++;assert.equal(options.env.ORCHESTRATOR_CHAT_URL,"https://chatgpt.com/c/chat-165");assert.equal(options.env.ORCHESTRATOR_BROWSER_DEBUG_PORT,"19333");assert.equal(options.env.CODEX_RECONCILE_ONLY,undefined);assert.equal(options.timeout,140000);assert.equal(options.killSignal,"SIGKILL");assert.equal(findRegisteredChatRoute(state,{projectKey:"alpha",chatUrl:"https://chatgpt.com/c/chat-165"}),null);return userReceipt(exe,argv,options);};
  assert.throws(()=>f.call(event,()=>assert.fail("queueing must not deliver"),false),/canonical --deliver/);assert.equal(fs.existsSync(f.outbox()),false);
  assert.equal(findRegisteredChatRoute(state,{projectKey:"alpha",chatUrl:"https://chatgpt.com/c/chat-165"}),null);
  f.call(event,send);f.call(event,(exe,argv,o)=>{assert.equal(o.env.CODEX_RECONCILE_ONLY,"1");return userReceipt(exe,argv,o);});assert.equal(calls,1);
  assert.equal(readJson(f.journal()).verified_role,"user");assert.equal(readJson(f.outbox()).delivery_owner,"register-chat.mjs");
  assert.equal(findRegisteredChatRoute(state,{projectKey:"alpha",chatUrl:"https://chatgpt.com/c/chat-165"}).route,"chat-165");
  const workflow=fs.readFileSync("templates/control-repo/orchestrator.macos.yml.template","utf8");assert.match(workflow,/register-chat\.mjs[^\n]+ --deliver/);assert.match(workflow,/timeout-minutes: 5/);
  assert.doesNotMatch(fs.readFileSync("templates/control-repo/orchestrator.yml.template","utf8"),/register-chat\.mjs| --deliver/);
});
test("bogus saved receipt, draft and ambiguous send never authorize a new submit or READY",()=>{
  for(const delivery_state of ["DELIVERED","DRAFT_INSERTED","SUBMISSION_ATTEMPTED"]){
    const f=macFixture(),event=f.event();assert.throws(()=>f.call(event,()=>({status:3})),/real user-role/);fs.rmSync(f.journal());
    privateJson(f.outbox(),{...readJson(f.outbox()),delivery_state,verified_by:"committed-user-turn"});let calls=0;
    assert.throws(()=>f.call(event,(_exe,_argv,o)=>{calls++;assert.equal(o.env.CODEX_RECONCILE_ONLY,"1");return {status:3,stdout:"CHAT_RECONCILE_PENDING"};}),/real user-role/);
    assert.equal(calls,1);assert.equal(readJson(f.journal()).status,"ERROR");assert.equal(readJson(f.outbox()).delivery_state,delivery_state);
    assert.throws(()=>f.call(event,(_exe,_argv,o)=>{assert.equal(o.env.CODEX_RECONCILE_ONLY,"1");return {status:0,stdout:"draft inserted"};}),/real user-role/);
  }
});
test("stuck registration is bounded, reports a durable error and retries by reconciliation only",()=>{
  const f=macFixture(),event=f.event();let sends=0;
  assert.throws(()=>f.call(event,(_exe,_argv,o)=>{sends++;assert.equal(o.timeout,140000);assert.equal(o.killSignal,"SIGKILL");return {status:null,error:Object.assign(new Error("stuck"),{code:"ETIMEDOUT"})};}),/timed out/);
  const journal=readJson(f.journal());assert.equal(journal.status,"ERROR");assert.equal(journal.reconcile_only,true);assert.match(journal.error,/timed out/);
  f.call(event,(exe,argv,o)=>{assert.equal(o.env.CODEX_RECONCILE_ONLY,"1");return userReceipt(exe,argv,o);});assert.equal(sends,1);
});
test("simultaneous duplicate delivery is refused while the canonical owner holds its lock",()=>{
  const f=macFixture(),event=f.event();let sends=0;
  f.call(event,(exe,argv,o)=>{sends++;assert.throws(()=>f.call(event,()=>assert.fail("second owner must not run")),/lock is occupied/);return userReceipt(exe,argv,o);});assert.equal(sends,1);
});
test("Mac registration rejects missing or wrong immutable identities and wrong Runner OS",()=>{
  for(const mutate of [e=>delete e.repository.id,e=>e.repository.id=9002,e=>e.repository.full_name="owner/foreign",e=>e.issue.body=JSON.stringify({project:"alpha",chat_url:"https://chatgpt.com/c/chat-165"}),e=>e.issue.state="closed"]){
    const f=macFixture(),file=f.event(),event=readJson(file);mutate(event);privateJson(file,event);assert.throws(()=>f.call(file,()=>assert.fail("unauthorized delivery")),/identity/);assert.equal(fs.existsSync(f.outbox()),false);
  }
  for(const env of [{RUNNER_OS:"Windows"},{RUNNER_ARCH:"X64"},{RUNNER_NAME:"other-project-runner"}]){const f=macFixture();assert.throws(()=>f.call(f.event(),()=>assert.fail("wrong Runner"),true,env),/macOS ARM64/);}
});
test("obsolete closed manual #409 cannot replay and a brand-new Chat registers separately",()=>{
  const f=macFixture(),file=f.event("orchestrator-dev",409,"https://chatgpt.com/c/manual-408"),event=readJson(file);event.issue.state="closed";event.issue.body=JSON.stringify({project:"orchestrator-dev",chat_url:"https://chatgpt.com/c/manual-408"});privateJson(file,event);
  assert.throws(()=>f.call(file,()=>assert.fail("manual #409 must never deliver")),/Obsolete manual registration #409/);
  f.call(f.event(),userReceipt);f.call(f.event("alpha",166,"https://chatgpt.com/c/new-chat"),userReceipt);
  const routes=readJson(f.metadata.chat_route_file).routes;assert.deepEqual(routes.map(x=>x.route),["chat-165","chat-166"]);assert.equal(routes[1].chat_url,"https://chatgpt.com/c/new-chat");
});
test("selected Mac callback writes leave historical instance bytes unchanged and reject aliases",()=>{
  const f=macFixture(),old=path.join(path.dirname(f.base),"1832f0bb");fs.mkdirSync(old,{mode:0o755});const legacy=path.join(old,"unsafe-legacy.json");fs.writeFileSync(legacy,"historical bytes",{mode:0o666});const before=fs.readFileSync(legacy);const mode=fs.statSync(legacy).mode;
  f.call(f.event(),userReceipt);assert.deepEqual(fs.readFileSync(legacy),before);assert.equal(fs.statSync(legacy).mode,mode);
  fs.rmSync(f.outbox());fs.linkSync(legacy,f.outbox());assert.throws(()=>f.call(f.event(),()=>assert.fail("hardlink must not be delivered")),/Untrusted registration path/);assert.deepEqual(fs.readFileSync(legacy),before);
});
test("installer lookup failures and ambiguous issues cannot trigger duplicate registration submissions",()=>{
  const f=macFixture(),state={...f.metadata,instance_platform:"darwin",reviewer_chat_url:"https://chatgpt.com/c/chat-165"};
  for(const result of [{ok:false,stdout:"",stderr:"offline"},{ok:true,stdout:"bad-json"},{ok:true,stdout:"{}"},{ok:true,stdout:""}]){
    let creates=0;assert.throws(()=>ensureInstallerChatRegistration(state,{projectKey:"alpha",commandRunner:args=>{if(args[1]==="create")creates++;return result;}}),/lookup/);assert.equal(creates,0);
  }
  let creates=0;
  assert.throws(()=>ensureInstallerChatRegistration(state,{projectKey:"alpha",commandRunner:args=>{
    if(args[1]==="create"){creates++;return {ok:true,stdout:"https://github.com/owner/control-new/issues/1"};}
    const marker=args[args.indexOf("--search")+1].replace(/ in:title$/,"");
    return {ok:true,stdout:JSON.stringify([1,2].map(number=>({number,title:`[CHAT-REGISTER] ${marker}`,state:"OPEN",body:JSON.stringify({project:"alpha",chat_url:state.reviewer_chat_url,installation_id:state.installation_id})})))};
  }}),/Multiple registration issues/);assert.equal(creates,0);
});
test("installer does not reuse closed #409 or an issue belonging to a different Chat",()=>{
  const f=macFixture(),state={...f.metadata,instance_platform:"darwin",reviewer_chat_url:"https://chatgpt.com/c/chat-165"};const created=[];
  const commandRunner=args=>{
    const title=args[args.indexOf("--title")+1];
    if(args[1]==="create"){created.push(title);return {ok:true,stdout:`https://github.com/owner/control-new/issues/${500+created.length}`};}
    const marker=args[args.indexOf("--search")+1].replace(/ in:title$/,"");
    return {ok:true,stdout:JSON.stringify([{number:409,title:`[CHAT-REGISTER] ${marker}`,state:"CLOSED",body:JSON.stringify({project:"alpha",chat_url:state.reviewer_chat_url,installation_id:state.installation_id})},{number:410,title:`[CHAT-REGISTER] ${marker}`,state:"OPEN",body:JSON.stringify({project:"alpha",chat_url:"https://chatgpt.com/c/old-chat",installation_id:state.installation_id})}])};
  };
  assert.equal(ensureInstallerChatRegistration(state,{projectKey:"alpha",commandRunner}).status,"WAITING");
  assert.equal(ensureInstallerChatRegistration({...state,reviewer_chat_url:"https://chatgpt.com/c/new-chat"},{projectKey:"alpha",commandRunner}).status,"WAITING");
  assert.equal(created.length,2);assert.notEqual(created[0],created[1]);
});
test("installer READY rejects duplicate route bindings, wrong issue pairs and unsafe private ancestors",()=>{
  const f=macFixture(),event=f.event();f.call(event,userReceipt);
  const state={...f.metadata,instance_platform:"darwin"},options={projectKey:"alpha",chatUrl:"https://chatgpt.com/c/chat-165"};const registry=readJson(f.metadata.chat_route_file);
  privateJson(f.metadata.chat_route_file,{version:1,routes:[...registry.routes,...registry.routes]});assert.equal(findRegisteredChatRoute(state,options),null);
  privateJson(f.metadata.chat_route_file,{version:1,routes:[{...registry.routes[0],registration_issue:166}]});assert.equal(findRegisteredChatRoute(state,options),null);
  privateJson(f.metadata.chat_route_file,registry);fs.chmodSync(path.dirname(f.base),0o755);assert.equal(findRegisteredChatRoute(state,options),null);
});
