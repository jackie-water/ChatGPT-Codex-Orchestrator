import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSafeSync } from "./spawn-safe.mjs";
import { canonicalInstallationId } from "./control-render.mjs";
import { macosNativeHelperPreflight, verifyMacosNativeCapability } from "./macos-native-helper-install.mjs";
import { inspectMacosRunnerBootstrap, MACOS_RUNNER_RUNTIME_PATH } from "./macos-runner-bootstrap.mjs";

const HOME = () => process.env.HOME || os.homedir();
const cmd = (name,args=[],options={}) => { const r=spawnSafeSync(name,args,{encoding:"utf8",shell:false,timeout:15000,maxBuffer:1024*1024,...options}); return {ok:r.status===0, output:(r.stdout||r.stderr||"").trim()}; };
const owner = () => typeof process.getuid === "function" ? process.getuid() : null;
const homeContained = value => {
  if(!value) return false;
  const home=path.resolve(HOME());
  const target=path.resolve(value);
  return target===home || target.startsWith(home+path.sep);
};
const privatePath = value => {
  if(!homeContained(value)) return false;
  let current=path.resolve(value);
  while(true) {
    try { const st=fs.lstatSync(current); if(st.isSymbolicLink() || st.uid!==process.getuid?.() || (st.mode&0o022)!==0) return false; } catch { return false; }
    if(current===path.resolve(HOME())) break;
    current=path.dirname(current);
  }
  return true;
};
function safeLaunchAgentPath(plist,{create=false}={}) {
  if(create) prepareLaunchAgentDirectory();
  const home=path.resolve(HOME()), dir=path.dirname(plist), uid=owner();
  if(path.resolve(dir)!==path.join(home,"Library","LaunchAgents")) throw new Error("LaunchAgent path is not private");
  for(const p of [home,path.join(home,"Library"),dir]) { const st=fs.lstatSync(p); if(!st.isDirectory()||st.isSymbolicLink()||(uid!==null&&st.uid!==uid)||(st.mode&0o022)) throw new Error("LaunchAgent ancestor is unsafe"); }
  try { const st=fs.lstatSync(plist); if(!st.isFile()||st.isSymbolicLink()||(uid!==null&&st.uid!==uid)||st.nlink!==1||(st.mode&0o077))throw new Error("LaunchAgent leaf is unsafe"); } catch(error) { if(error.code!=="ENOENT") throw error; }
}
function prepareLaunchAgentDirectory() {
  const home=path.resolve(HOME()), uid=owner();
  const homeStat=fs.lstatSync(home);
  if(!homeStat.isDirectory()||homeStat.isSymbolicLink()||(uid!==null&&homeStat.uid!==uid)||(homeStat.mode&0o022))throw new Error("HOME is unsafe");
  for(const dir of [path.join(home,"Library"),path.join(home,"Library","LaunchAgents")]) {
    try { const st=fs.lstatSync(dir); if(!st.isDirectory()||st.isSymbolicLink()||(uid!==null&&st.uid!==uid)||(st.mode&0o022))throw new Error("LaunchAgent ancestor is unsafe"); }
    catch(error) { if(error.code!=="ENOENT") throw error; fs.mkdirSync(dir,{mode:0o700}); const st=fs.lstatSync(dir); if(st.isSymbolicLink()||(uid!==null&&st.uid!==uid)||(st.mode&0o022))throw new Error("LaunchAgent ancestor is unsafe"); }
  }
}

export function parseNodeMajor(version) { return Number((String(version||"").match(/v(\d+)/)||[])[1]||0); }
export function macosPrerequisites() {
  const node=cmd("node",["--version"]), git=cmd("git",["--version"]), gh=cmd("gh",["--version"]), codex=cmd("codex",["--version"]);
  const major=parseNodeMajor(node.output);
  return {node:node.ok&&major>=22,node_version:node.output,git:git.ok,gh:gh.ok,codex:codex.ok,
    session_auth:codex.ok&&cmd("codex",["login","status"]).ok,github_auth:gh.ok&&cmd("gh",["auth","status"]).ok,
    native_helper:macosNativeHelperPreflight({platform:process.platform})};
}

function redactStatus(status) {
  return status.split("\n").map(line=>line.replace(/[^\s]+(token|secret|oauth|credential|password)[^\s]*/ig,"[REDACTED]")).join("\n");
}
function xmlEscape(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function gitInventory(root) {
  if(!root || !fs.existsSync(root) || !fs.existsSync(path.join(root,".git"))) return {present:false,reason:"missing-or-not-a-git-worktree"};
  const head=cmd("git",["-C",root,"rev-parse","HEAD"]), status=cmd("git",["-C",root,"status","--porcelain=v1","--untracked-files=all"]);
  const evidence=redactStatus(status.output||"");
  const entries=evidence?evidence.split("\n").filter(Boolean):[];
  return {present:true,root:path.resolve(root),head:head.output||null,dirty:Boolean(entries.length),dirty_count:entries.length,status:evidence};
}

function atomicPrivateJson(file,value){
  const dir=path.dirname(file); const home=path.resolve(HOME()); const absolute=path.resolve(dir);
  if(absolute!==home&&!absolute.startsWith(home+path.sep)) throw new Error("Migration journal path escapes HOME");
  const missing=[]; let cursor=absolute;
  while(cursor!==home){ if(fs.existsSync(cursor)){const st=fs.lstatSync(cursor);if(st.isSymbolicLink()||(owner()!==null&&st.uid!==owner())||(st.mode&0o077))throw new Error("Migration journal ancestor is unsafe");} else missing.push(cursor); cursor=path.dirname(cursor); }
  for(const entry of missing.reverse()) fs.mkdirSync(entry,{mode:0o700});
  const ds=fs.lstatSync(dir); if(ds.isSymbolicLink()||(owner()!==null&&ds.uid!==owner())||(ds.mode&0o077)) throw new Error("Migration journal directory is unsafe");
  if(fs.existsSync(file)){const st=fs.lstatSync(file);if(st.isSymbolicLink()||(owner()!==null&&st.uid!==owner())||(st.mode&0o077))throw new Error("Migration journal collision or unsafe ownership");}
  const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`; const fd=fs.openSync(temp,"wx",0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);} fs.renameSync(temp,file); const dfd=fs.openSync(dir,"r"); try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);} const st=fs.lstatSync(file); if(st.isSymbolicLink()||(owner()!==null&&st.uid!==owner())||(st.mode&0o077))throw new Error("Migration journal replacement is unsafe"); fs.chmodSync(file,0o600);
}
export function migrationIntentPath({home=HOME(),installationId}={}){
  if(!installationId) throw new Error("installation_id is required for an instance-scoped migration intent");
  return path.join(home,".chatgpt-codex-orchestrator","instances",canonicalInstallationId(installationId),"migration-intent.json");
}
export function prepareMigrationIntent({state={},sourceRoot=process.cwd(),home=HOME()}={}){
  const id=String(state.installation_id||""); if(!id) throw new Error("installation_id is required; refusing timestamp fallback");
  const login=String(state.github_login||"");
  if(!/^[A-Za-z0-9-]+$/.test(login)) throw new Error("Verified GitHub login is required; refusing to prepare migration intent");
  const short=canonicalInstallationId(id);
  const instanceRoot=path.join(home,".chatgpt-codex-orchestrator","instances",short), source=gitInventory(sourceRoot), destination=gitInventory(instanceRoot);
  const callbackStates=Object.fromEntries(Object.entries(state)
    .filter(([key,value])=>/(callback|wake|route)/i.test(key)&&value!==undefined&&value!==null)
    .map(([key,value])=>[key,typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : JSON.parse(JSON.stringify(value))]));
  const registry={control_repository:state.control_repository||null,sandbox_repository:state.sandbox_repository||null,target_repository:state.target_repository||null,
    target_environment_ready:state.target_environment_ready===true,sandbox_only:state.sandbox_only!==false};
  const codexHome=process.env.CODEX_HOME||path.join(home,".codex");
  const sessionsDir=path.join(codexHome,"sessions");
  const sessions=fs.existsSync(sessionsDir)&&fs.statSync(sessionsDir).isDirectory()?fs.readdirSync(sessionsDir).filter(name=>!name.startsWith(".")):[];
  const intent={schema_version:1,phase:"PREPARED",installation_id:id,generated_repositories:{control:`${login}/chatgpt-codex-orchestrator-control-${short}`,sandbox:`${login}/chatgpt-codex-orchestrator-sandbox-${short}`},source:{path:path.resolve(sourceRoot),git:source},destination:{path:instanceRoot,git:destination},exact_refs:{source_head:source.head,destination_head:destination.head||null},preservation:{source_status:source.status||"",destination_status:destination.status||"",registry,callback_states:callbackStates,codex_sessions:{home:codexHome,entries:sessions}},chat:{review_route:state.review_route||state.sandbox_review_route||null,callback_ids:[state.callback_id,state.sandbox_callback_id].filter(Boolean)},rollback:{available:true,automatic:false,no_reset_clean_delete:true,created_at:new Date().toISOString()},created_at:new Date().toISOString()};
  const file=migrationIntentPath({home,installationId:id});
  if(fs.existsSync(file)){const st=fs.lstatSync(file); if(st.isSymbolicLink()||(owner()!==null&&st.uid!==owner())||(st.mode&0o077)) throw new Error("Existing migration intent is unsafe or has unexpected ownership"); const prior=JSON.parse(fs.readFileSync(file,"utf8"));
    const same=(prior.installation_id===id&&prior.phase==="PREPARED"&&prior.generated_repositories?.control===intent.generated_repositories.control&&prior.generated_repositories?.sandbox===intent.generated_repositories.sandbox&&prior.preservation?.registry?.target_repository===intent.preservation.registry.target_repository&&prior.source?.path===intent.source.path&&prior.destination?.path===intent.destination.path&&prior.exact_refs?.source_head===intent.exact_refs.source_head&&prior.exact_refs?.destination_head===intent.exact_refs.destination_head&&prior.source?.git?.dirty_count===intent.source.git.dirty_count&&prior.destination?.git?.dirty_count===intent.destination.git.dirty_count);
    if(!same) throw new Error("Existing migration intent identity or binding conflicts with this installation"); return {...prior,path:file};
  }
  atomicPrivateJson(file,intent); return {...intent,path:file};
}

export function migrationInventory({state={}, home=HOME()}={}) {
  const codexHome=process.env.CODEX_HOME||path.join(home,".codex");
  const stateDir=process.env.CHATGPT_CODEX_ORCHESTRATOR_HOME||path.join(home,".chatgpt-codex-orchestrator-dev");
  const launchDir=path.join(home,"Library","LaunchAgents");
  const profile=state.browser_profile||path.join(stateDir,"browser-profile");
  return {platform:process.platform, state_root:stateDir, state_file:path.join(stateDir,"install-state.json"),
    git:gitInventory(state.project_clone_path), codex:{home:codexHome,exists:fs.existsSync(codexHome),sessions:fs.existsSync(path.join(codexHome,"sessions"))},
    chat_routes:state.chat_route_file?{path:state.chat_route_file,exists:fs.existsSync(state.chat_route_file)}:{path:null,exists:false},
    pending_wake_outbox:state.pending_wake_outbox||null, browser:{profile,exists:fs.existsSync(profile),port:state.browser_port||null},
    runner:{path:state.runner_path||null,exists:Boolean(state.runner_path&&fs.existsSync(state.runner_path)),concurrent:false,ownership:state.runner_ownership||"UNKNOWN"},
    launch_agents:{directory:launchDir,exists:fs.existsSync(launchDir)}};
}

export function detectConcurrentRunner({state={},commandRunner=cmd}={}) {
  const r=commandRunner("launchctl",["list"]);
  const label=state.launch_agent_label||"", legacyLabel=state.runner_label||"";
  const labels=r.ok?String(r.output||"").split("\n").map(line=>line.trim().split(/\s+/).at(-1)).filter(Boolean):[];
  const relevant=labels.filter(value=>value.startsWith("com.chatgpt.codex.")||value.startsWith("actions.runner.")||value===legacyLabel);
  const found=relevant.some(value=>value!==label),ownLoaded=Boolean(label&&labels.includes(label));
  const known=Boolean(state.runner_label||state.runner_path||state.instance_id);
  return {checked:r.ok,found,own_loaded:ownLoaded,unknown:!r.ok||(!label&&known),fail_closed:!r.ok||(!label&&known),output:r.output};
}

export function migrationPreflight({state={},home=HOME(),commandRunner=cmd}={}) {
  const inventory=migrationInventory({state,home});
  const concurrent=detectConcurrentRunner({state,commandRunner});
  inventory.runner.concurrent=concurrent.found;
  inventory.runner.ownership=concurrent.unknown?"UNKNOWN":(concurrent.found?"OTHER_OR_CURRENT":concurrent.own_loaded?"OWN_VERIFIED_LABEL":"NONE_DETECTED");
  const conflicts=[];
  if(concurrent.found||concurrent.fail_closed) conflicts.push({kind:concurrent.found?"concurrent_runner":"runner_ownership_unknown",action:"stop_and_resolve_manually"});
  if(inventory.git.dirty) conflicts.push({kind:"dirty_repository",action:"preserve_and_resolve_manually"});
  return {status:conflicts.length?"CONFLICT":"READY",inventory,conflicts,mutations_performed:false,rollback:{available:true,automatic:false}};
}

export function renderLaunchAgent({label,runnerPath,instanceRoot,workingDirectory=instanceRoot,programArguments=[],nativeHelperPath=null,nativeProcessIdentity=false}={}) {
  if(!/^com\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(label)) throw new Error("LaunchAgent label must be reverse-DNS");
  if(!runnerPath||!instanceRoot||![runnerPath,instanceRoot].every(privatePath)) throw new Error("LaunchAgent paths must be private HOME-scoped paths");
  const executable=fs.lstatSync(runnerPath),root=fs.lstatSync(instanceRoot);
  if(!executable.isFile()||executable.isSymbolicLink()||executable.nlink!==1||executable.uid!==owner()||(executable.mode&0o077)!==0||(executable.mode&0o100)===0) throw new Error("LaunchAgent executable must be a private, owned, singly linked executable file; a runner directory is not executable authority");
  if(!root.isDirectory()||root.isSymbolicLink()||root.uid!==owner()||(root.mode&0o077)!==0||!path.resolve(runnerPath).startsWith(path.resolve(instanceRoot)+path.sep)) throw new Error("LaunchAgent executable must belong to the private selected instance");
  if(!privatePath(workingDirectory)||!fs.lstatSync(workingDirectory).isDirectory()||(path.resolve(workingDirectory)!==path.resolve(instanceRoot)&&!path.resolve(workingDirectory).startsWith(path.resolve(instanceRoot)+path.sep))) throw new Error("LaunchAgent working directory must belong to the private selected instance");
  const environment = `<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xmlEscape(MACOS_RUNNER_RUNTIME_PATH)}</string>${nativeHelperPath && nativeProcessIdentity ? `<key>ORCHESTRATOR_MACOS_NATIVE_HELPER</key><string>${xmlEscape(nativeHelperPath)}</string><key>ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY</key><string>1</string>` : ""}</dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xmlEscape(label)}</string><key>ProgramArguments</key><array>${[runnerPath,...programArguments].map(x=>`<string>${xmlEscape(x)}</string>`).join("")}</array><key>WorkingDirectory</key><string>${xmlEscape(workingDirectory)}</string>${environment}<key>RunAtLoad</key><false/></dict></plist>`;
}

export function macosRuntimeAction(action,{state={},commandRunner=cmd,home=HOME(),platform=process.platform,arch=process.arch,capabilityVerifier=verifyMacosNativeCapability,runnerInspector=inspectMacosRunnerBootstrap}={}) {
  if(!["status","doctor","install","start","stop","repair"].includes(action)) return {status:"ERROR",mutations_performed:false,action};
  const readonly=action==="status"||action==="doctor";
  const preflight=migrationPreflight({state,home,commandRunner});
  if(preflight.status!=="READY") {
    const unknown=preflight.conflicts.some(x=>x.kind==="runner_ownership_unknown");
    return {status:unknown?"NEEDS_USER_ACTION":"ERROR",action_id:unknown?"resolve_runner_ownership":undefined,error_id:"MACOS-RUNNER-OWNERSHIP",launchctl_state:"unknown",mutations_performed:false,preflight,action:"Resolve runner ownership manually; no existing runner was stopped."};
  }
  let runner;
  try { runner=runnerInspector({state,home,platform,arch,commandRunner,requireOnline:false}); }
  catch(error) { return {status:"ERROR",error_id:"MACOS-RUNNER-VERIFY",mutations_performed:false,details:String(error.message||error)}; }
  if(runner?.status!=="PASS") return {...runner,status:runner?.status||"ERROR",mutations_performed:false,preflight,plist_verified:false};
  const label=state.launch_agent_label, plist=path.join(home,"Library","LaunchAgents",`${label}.plist`);
  const listed=commandRunner("launchctl",["list"]);
  if(!listed.ok) return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-001",mutations_performed:false,launchctl_state:"unknown",details:listed.output,preflight};
  const active=String(listed.output||"").split("\n").some(line=>line.trim().split(/\s+/).at(-1)===label);
  const proof=active?commandRunner("launchctl",["print",`gui/${owner()||0}/${label}`]):{ok:false,output:"not-listed"};
  if(active&&!proof.ok) return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-002",mutations_performed:false,launchctl_state:"unknown",details:proof.output,preflight};
  if(runner.local_listener_pid&&!active) return {status:"ERROR",error_id:"MACOS-RUNNER-UNMANAGED",mutations_performed:false,action,details:"The approved listener is already running outside its verified LaunchAgent; no second listener will be started."};
  if(active&&runner.local_listener_pid&&!new RegExp(`(?:^|\\n)\\s*pid = ${runner.local_listener_pid}(?:\\s|$)`).test(String(proof.output||""))) return {status:"ERROR",error_id:"MACOS-RUNNER-PID-MISMATCH",mutations_performed:false,action,launchctl_state:"unknown"};
  let capability;
  try { capability=capabilityVerifier({state,home,platform,parentPid:state.parent_pid}); }
  catch(error) { return {status:"ERROR",error_id:"MACOS-NATIVE-CAPABILITY-VERIFY",mutations_performed:false,action,details:String(error.message||error)}; }
  const root=state.instance_root;
  const validCapability=capability?.status==="PASS"&&capability.installation_id===state.installation_id&&capability.instance_path===root&&capability.helper_path===path.join(root,"runtime","native","macos","process-identity")&&capability.receipt_path===path.join(root,"macos-native-helper-capability.json");
  if(!validCapability) return {status:"ERROR",error_id:capability?.error_id||"MACOS-NATIVE-CAPABILITY-INVALID",mutations_performed:false,action,capability:{status:capability?.status||"ERROR",error_id:capability?.error_id||"MACOS-NATIVE-CAPABILITY-INVALID"}};
  let expectedPlist;
  try { expectedPlist=renderLaunchAgent({label,runnerPath:runner.runner_executable,programArguments:runner.program_arguments,instanceRoot:root,workingDirectory:state.runner_path,nativeHelperPath:capability.helper_path,nativeProcessIdentity:true}); }
  catch(error) { return {status:"ERROR",error_id:"MACOS-RUNNER-EXECUTABLE",mutations_performed:false,action,details:String(error.message||error)}; }
  let plistVerified=false;
  if(fs.existsSync(plist)) {
    try { safeLaunchAgentPath(plist); plistVerified=fs.readFileSync(plist,"utf8")===expectedPlist; }
    catch(error) { return {status:"ERROR",error_id:"MACOS-PLIST-UNSAFE",mutations_performed:false,action,details:String(error.message||error),plist_verified:false}; }
    if(!plistVerified) return {status:"ERROR",error_id:"MACOS-PLIST-NATIVE-PATH-MISMATCH",mutations_performed:false,action,details:"Persisted LaunchAgent is not the exact canonical approved executable and native capability rendering.",plist_verified:false};
  }
  if(active&&!plistVerified) return {status:"ERROR",error_id:"MACOS-PLIST-MISSING",mutations_performed:false,launchctl_state:"unknown",plist_verified:false};
  if(readonly) return {status:"PASS",mutations_performed:false,launchctl_checked:true,launchctl_state:active?"loaded":"not-loaded",plist_exists:fs.existsSync(plist),plist_verified:plistVerified,runner,preflight};
  if(state.macos_setup_approved!==true||state.macos_action_approval!==action) return {status:"NEEDS_USER_ACTION",error_id:"MACOS-ACTION-APPROVAL",mutations_performed:false,action:"Approve this exact macOS action: "+action};
  if(active&&(action==="install"||action==="repair"||action==="start")) return {status:"ERROR",error_id:"MACOS-RUNNER-ACTIVE",mutations_performed:false,action,launchctl_state:"loaded",plist_verified:plistVerified,preflight};
  if(action==="install"||action==="repair") {
    if(fs.existsSync(plist)) return {status:"ERROR",error_id:"MACOS-PLIST-COLLISION",mutations_performed:false,action,details:"Existing LaunchAgent is preserved. Inspect status; do not reinstall or overwrite it automatically."};
    const temp=path.join(path.dirname(plist),`.${label}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let fd,committed=false;
    try {
      safeLaunchAgentPath(plist,{create:true});
      fd=fs.openSync(temp,"wx",0o600); fs.writeFileSync(fd,expectedPlist); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
      safeLaunchAgentPath(plist); fs.linkSync(temp,plist); committed=true; fs.unlinkSync(temp);
      const dfd=fs.openSync(path.dirname(plist),"r"); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
      safeLaunchAgentPath(plist);
      if(fs.readFileSync(plist,"utf8")!==expectedPlist) throw new Error("Persisted LaunchAgent changed during installation");
      return {status:"PASS",mutations_performed:true,action,plist,plist_verified:true,runner};
    } catch(error) {
      if(fd!==undefined) try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(temp); } catch {}
      return {status:"ERROR",error_id:"MACOS-PLIST-COMMIT",mutations_performed:committed,action,details:String(error.message||error),recovery_status:"PRESERVE_AND_INSPECT_INSTALLED_PLIST"};
    }
  }
  if(!plistVerified) return {status:"ERROR",error_id:"MACOS-PLIST-MISSING",mutations_performed:false,action,plist_verified:false};
  const result=commandRunner("launchctl",[action==="start"?"bootstrap":"bootout",`gui/${owner()||0}`,plist]);
  if(!result.ok) return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-ACTION",mutations_performed:"UNKNOWN",action,launchctl_state:"unknown",details:result.output,recovery_status:"INSPECT_ONLY_NO_AUTOMATIC_RETRY"};
  if(action==="start") {
    const started=commandRunner("launchctl",["kickstart",`gui/${owner()||0}/${label}`]);
    if(!started.ok) return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-START",mutations_performed:"UNKNOWN",action,launchctl_state:"unknown",details:started.output,recovery_status:"INSPECT_ONLY_NO_AUTOMATIC_RETRY"};
  }
  const after=commandRunner("launchctl",["print",`gui/${owner()||0}/${label}`]),expected=action==="start";
  if(after.ok!==expected) return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-VERIFY",mutations_performed:true,action,launchctl_state:"unknown",details:after.output,recovery_status:"INSPECT_ONLY_NO_AUTOMATIC_RETRY"};
  return {status:"PASS",mutations_performed:true,action,launchctl_state:expected?"loaded":"not-loaded",plist_verified:true,runner,details:after.output};
}
