import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSafeSync } from "./spawn-safe.mjs";
import { canonicalInstallationId } from "./control-render.mjs";
import { macosNativeHelperPreflight, verifyMacosNativeCapability } from "./macos-native-helper-install.mjs";
import { inspectMacosRunnerBootstrap, rebindMacosRunnerConfiguration, MACOS_RUNNER_RUNTIME_PATH } from "./macos-runner-bootstrap.mjs";

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
const plistIdentityKeys=["dev","ino","uid","gid","mode","nlink","size","mtimeMs","ctimeMs"];
const samePlistIdentity=(a,b)=>plistIdentityKeys.every(key=>a[key]===b[key]);
function readApprovedLaunchAgent(plist,expected,binding=null) {
  // Keep a nofollow descriptor while callback inspections complete, then bind
  // the final inode and bytes. This does not authorize pathname-based import.
  safeLaunchAgentPath(plist);
  if(!fs.constants.O_NOFOLLOW) throw new Error("No-follow LaunchAgent inspection is unavailable");
  const before=fs.lstatSync(plist);
  if(!Number.isSafeInteger(before.size)||before.size<0||before.size>65536) throw new Error("LaunchAgent exceeds its inspection bound");
  let fd=binding?.fd;
  try {
    if(fd===undefined)fd=fs.openSync(plist,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.nlink!==1||!samePlistIdentity(before,opened)||(binding&&!samePlistIdentity(binding.identity,opened)))throw new Error("LaunchAgent inode or ownership changed");
    const bytes=Buffer.alloc(opened.size);let cursor=0;
    while(cursor<bytes.length){const count=fs.readSync(fd,bytes,cursor,bytes.length-cursor,cursor);if(!count)throw new Error("LaunchAgent changed during inspection");cursor+=count;}
    if(fs.readSync(fd,Buffer.alloc(1),0,1,bytes.length)!==0||!samePlistIdentity(opened,fs.fstatSync(fd))||!samePlistIdentity(opened,fs.lstatSync(plist)))throw new Error("LaunchAgent changed during inspection");
    // Exact canonical bytes bind all fields, including the entire argument and
    // environment collections and RunAtLoad=false, with no XML ambiguity.
    if(!bytes.equals(Buffer.from(expected,"utf8")))throw new Error("LaunchAgent is not the exact approved rendering");
    safeLaunchAgentPath(plist);
    return {fd,identity:Object.fromEntries(plistIdentityKeys.map(key=>[key,opened[key]]))};
  } catch(error) { if(!binding&&fd!==undefined)fs.closeSync(fd);throw error; }
}
function proveLoadedLaunchAgent(output,{label,plist,runner,capability,runnerPath,requirePid=false}) {
  const domain=`gui/${owner()||0}`,text=String(output||"");
  if(text.length>131072||/[\x00-\x08\x0b-\x1f]/.test(text))throw new Error("Loaded LaunchAgent output is invalid or exceeds its bound");
  const lines=text.trim().split("\n").map(line=>line.trim());
  if(lines.length>4096||lines.shift()!==`${domain}/${label} = {`)throw new Error("Loaded LaunchAgent label or domain is not exact");
  const values=new Map(),blocks=new Map();let depth=1,block=null,closed=false;
  for(const line of lines) {
    if(!line)continue;
    if(closed)throw new Error("Ambiguous loaded LaunchAgent output");
    if(line==="}"){if(--depth===0)closed=true;continue;}
    const nested=line.match(/^(.+) = \{$/);
    if(nested){if(depth===1){block=nested[1];if(values.has(block)||blocks.has(block))throw new Error("Duplicate loaded LaunchAgent field");blocks.set(block,[]);}else if(depth===2&&["arguments","environment"].includes(block))throw new Error("Ambiguous loaded LaunchAgent collection");depth++;continue;}
    if(depth===1){const scalar=line.match(/^([^=]+) = (.*)$/);if(!scalar||values.has(scalar[1])||blocks.has(scalar[1]))throw new Error("Ambiguous loaded LaunchAgent field");values.set(scalar[1],scalar[2]);}
    else if(depth===2&&["arguments","environment"].includes(block))blocks.get(block).push(line);
  }
  if(!closed||depth!==0||values.get("path")!==plist||values.get("type")!=="LaunchAgent"||values.get("program")!==runner.runner_executable||values.get("working directory")!==runnerPath||!new RegExp(`^gui/${owner()||0} \\[\\d+\\]$`).test(values.get("domain")||""))throw new Error("Loaded LaunchAgent executable, path or owned domain is not exact");
  if(JSON.stringify(blocks.get("arguments"))!==JSON.stringify([runner.runner_executable,...runner.program_arguments]))throw new Error("Loaded LaunchAgent arguments are not exact");
  const environment=new Map();
  for(const line of blocks.get("environment")||[]){const entry=line.match(/^([A-Za-z_][A-Za-z0-9_]*) => (.*)$/);if(!entry||environment.has(entry[1]))throw new Error("Ambiguous loaded LaunchAgent environment");environment.set(entry[1],entry[2]);}
  const expectedEnvironment=new Map([["PATH",MACOS_RUNNER_RUNTIME_PATH],["ORCHESTRATOR_MACOS_NATIVE_HELPER",capability.helper_path],["ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY","1"]]);
  if(environment.has("XPC_SERVICE_NAME")){if(environment.get("XPC_SERVICE_NAME")!==label)throw new Error("Loaded LaunchAgent service identity is foreign");environment.delete("XPC_SERVICE_NAME");}
  if(environment.size!==expectedEnvironment.size||[...expectedEnvironment].some(([key,value])=>environment.get(key)!==value))throw new Error("Loaded LaunchAgent environment is not exact");
  if(!values.has("properties")||/(?:^|[|\s])runatload(?:$|[|\s])/i.test(values.get("properties")))throw new Error("Loaded LaunchAgent has ambiguous or unsafe RunAtLoad authority");
  const rawPid=values.get("pid"),pid=rawPid===undefined?null:Number(rawPid),approvedPid=runner.local_listener_pid??null;
  if((rawPid!==undefined&&(!/^[1-9]\d*$/.test(rawPid)||!Number.isSafeInteger(pid)||pid<=1))||(pid!==null&&values.get("state")!=="running")||(pid===null&&!["not running","waiting"].includes(values.get("state")))||(requirePid&&pid===null)||pid!==approvedPid)throw new Error("Loaded LaunchAgent PID is not the independently observed native listener");
  return {pid};
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
  const authorizationKeys=["runner_executable","program_arguments","runner_id","approval_sha256","config_sha256","config_identity","env_sha256"];
  const approvedRunnerAuthorization=JSON.stringify(authorizationKeys.map(key=>runner[key]));
  const label=state.launch_agent_label, plist=path.join(home,"Library","LaunchAgents",`${label}.plist`),job=`gui/${owner()||0}/${label}`;
  const listed=commandRunner("launchctl",["list"]);
  if(!listed.ok) return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-001",mutations_performed:false,launchctl_state:"unknown",details:listed.output,preflight};
  const ownEntries=String(listed.output||"").split("\n").filter(line=>line.trim().split(/\s+/).at(-1)===label);
  if(ownEntries.length>1)return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-IDENTITY",mutations_performed:false,launchctl_state:"unknown",details:"Ambiguous same-label LaunchAgents."};
  const active=ownEntries.length===1,proof=commandRunner("launchctl",["print",job]);
  if(active!==proof.ok) return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-002",mutations_performed:false,launchctl_state:"unknown",details:proof.output,preflight};
  if(runner.local_listener_pid&&!active) return {status:"ERROR",error_id:"MACOS-RUNNER-UNMANAGED",mutations_performed:false,action,details:"The approved listener is already running outside its verified LaunchAgent; no second listener will be started."};
  let capability;
  try { capability=capabilityVerifier({state,home,platform,parentPid:state.parent_pid}); }
  catch(error) { return {status:"ERROR",error_id:"MACOS-NATIVE-CAPABILITY-VERIFY",mutations_performed:false,action,details:String(error.message||error)}; }
  const root=state.instance_root;
  const validCapability=capability?.status==="PASS"&&capability.installation_id===state.installation_id&&capability.instance_path===root&&capability.helper_path===path.join(root,"runtime","native","macos","process-identity")&&capability.receipt_path===path.join(root,"macos-native-helper-capability.json");
  if(!validCapability) return {status:"ERROR",error_id:capability?.error_id||"MACOS-NATIVE-CAPABILITY-INVALID",mutations_performed:false,action,capability:{status:capability?.status||"ERROR",error_id:capability?.error_id||"MACOS-NATIVE-CAPABILITY-INVALID"}};
  let expectedPlist;
  try { expectedPlist=renderLaunchAgent({label,runnerPath:runner.runner_executable,programArguments:runner.program_arguments,instanceRoot:root,workingDirectory:state.runner_path,nativeHelperPath:capability.helper_path,nativeProcessIdentity:true}); }
  catch(error) { return {status:"ERROR",error_id:"MACOS-RUNNER-EXECUTABLE",mutations_performed:false,action,details:String(error.message||error)}; }
  let plistBinding=null;
  try {
    try { fs.lstatSync(plist);plistBinding=readApprovedLaunchAgent(plist,expectedPlist); }
    catch(error) { if(error.code!=="ENOENT")return {status:"ERROR",error_id:/exact approved rendering/.test(error.message)?"MACOS-PLIST-NATIVE-PATH-MISMATCH":"MACOS-PLIST-UNSAFE",mutations_performed:false,action,details:String(error.message||error),plist_verified:false}; }
    const plistVerified=plistBinding!==null;
    if(active&&!plistVerified) return {status:"ERROR",error_id:"MACOS-PLIST-MISSING",mutations_performed:false,launchctl_state:"unknown",plist_verified:false};
    const prove=(output,current=runner,requirePid=false)=>proveLoadedLaunchAgent(output,{label,plist,runner:current,capability,runnerPath:state.runner_path,requirePid});
    if(active)try{
      const currentProof=commandRunner("launchctl",["print",job]);
      if(!currentProof.ok)throw new Error("Loaded LaunchAgent disappeared during capability inspection");
      prove(currentProof.output);readApprovedLaunchAgent(plist,expectedPlist,plistBinding);
    }catch(error){return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-IDENTITY",mutations_performed:false,action,launchctl_state:"unknown",details:String(error.message||error)};}
    if(readonly) return {status:"PASS",mutations_performed:false,launchctl_checked:true,launchctl_state:active?"loaded":"not-loaded",plist_exists:plistVerified,plist_verified:plistVerified,runner,preflight};
    if(state.macos_setup_approved!==true||state.macos_action_approval!==action) return {status:"NEEDS_USER_ACTION",error_id:"MACOS-ACTION-APPROVAL",mutations_performed:false,action:"Approve this exact macOS action: "+action};
    if(active&&(action==="install"||action==="repair"||action==="start")) return {status:"ERROR",error_id:"MACOS-RUNNER-ACTIVE",mutations_performed:false,action,launchctl_state:"loaded",plist_verified:plistVerified,preflight};
    if(action==="install"||action==="repair") {
      if(plistVerified) return {status:"ERROR",error_id:"MACOS-PLIST-COLLISION",mutations_performed:false,action,details:"Existing LaunchAgent is preserved. Inspect status; do not reinstall or overwrite it automatically."};
      const temp=path.join(path.dirname(plist),`.${label}.${process.pid}.${crypto.randomUUID()}.tmp`);
      let fd,committed=false;
      try {
        safeLaunchAgentPath(plist,{create:true});
        fd=fs.openSync(temp,"wx",0o600); fs.writeFileSync(fd,expectedPlist); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
        safeLaunchAgentPath(plist); fs.linkSync(temp,plist); committed=true; fs.unlinkSync(temp);
        const dfd=fs.openSync(path.dirname(plist),"r"); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
        plistBinding=readApprovedLaunchAgent(plist,expectedPlist);
        return {status:"PASS",mutations_performed:true,action,plist,plist_verified:true,runner};
      } catch(error) {
        if(fd!==undefined) try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(temp); } catch {}
        return {status:"ERROR",error_id:"MACOS-PLIST-COMMIT",mutations_performed:committed,action,details:String(error.message||error),recovery_status:"PRESERVE_AND_INSPECT_INSTALLED_PLIST"};
      }
    }
    if(!plistVerified) return {status:"ERROR",error_id:"MACOS-PLIST-MISSING",mutations_performed:false,action,plist_verified:false};
    const recheckRunnerAuthorization=()=>{
      let current;
      try { current=runnerInspector({state,home,platform,arch,commandRunner,requireOnline:false}); }
      catch { return {error:{status:"ERROR",error_id:"MACOS-RUNNER-VERIFY",mutations_performed:false,action}}; }
      if(current?.status!=="PASS") return {error:{...current,status:current?.status||"ERROR",mutations_performed:false,action}};
      if(JSON.stringify(authorizationKeys.map(key=>current[key]))!==approvedRunnerAuthorization) return {error:{status:"ERROR",error_id:"MACOS-RUNNER-APPROVAL-DRIFT",mutations_performed:false,action,details:"Runner authorization changed before startup."}};
      return {current};
    };
    const unknown=(error_id,details,mutated=false)=>({status:"ERROR",error_id,mutations_performed:mutated,action,launchctl_state:"unknown",details,...(mutated?{recovery_status:"INSPECT_ONLY_NO_AUTOMATIC_RETRY"}:{})});
    if(action==="start") {
      const checked=recheckRunnerAuthorization();if(checked.error)return checked.error;
      const boundary=migrationPreflight({state,home,commandRunner}),existing=commandRunner("launchctl",["print",job]);
      if(boundary.status!=="READY"||boundary.inventory.runner.ownership!=="NONE_DETECTED"||existing.ok)return unknown("MACOS-LAUNCHCTL-IDENTITY","A loaded or ambiguous LaunchAgent appeared before bootstrap.");
    } else {
      const existing=commandRunner("launchctl",["print",job]);
      if(!existing.ok)return unknown("MACOS-LAUNCHCTL-IDENTITY",existing.output);
      try{prove(existing.output);}catch(error){return unknown("MACOS-LAUNCHCTL-IDENTITY",String(error.message||error));}
    }
    // Final inspection boundary: no callback follows these direct configuration
    // and descriptor-bound plist checks before the fail-closed start decision.
    if(action==="start")try{rebindMacosRunnerConfiguration({state,home,approval:runner});}catch(error){return unknown(error.code||"MACOS-RUNNER-CONFIG",String(error.message||error));}
    try{readApprovedLaunchAgent(plist,expectedPlist,plistBinding);}catch(error){return unknown("MACOS-PLIST-DRIFT",String(error.message||error));}
    // launchctl bootstrap hands a pathname to launchd. A held descriptor and
    // a final comparison cannot prevent replacement before launchd consumes it;
    // post-import checks would be too late for a tampered RunAtLoad=true job.
    // Refuse startup until an independently verified immutable import exists.
    if(action==="start")return unknown("MACOS-LAUNCHCTL-IMMUTABLE-IMPORT-REQUIRED","Runner start is blocked: launchctl cannot bind the approved plist inode and bytes atomically. An independently verified immutable LaunchAgent import is required before any bootstrap or kickstart.");
    const result=commandRunner("launchctl",["bootout",job]);
    if(!result.ok) return {...unknown("MACOS-LAUNCHCTL-ACTION",result.output),mutations_performed:"UNKNOWN",recovery_status:"INSPECT_ONLY_NO_AUTOMATIC_RETRY"};
    const after=commandRunner("launchctl",["print",job]);
    if(after.ok)return unknown("MACOS-LAUNCHCTL-VERIFY",after.output,true);
    return {status:"PASS",mutations_performed:true,action,launchctl_state:"not-loaded",plist_verified:true,runner,details:after.output};
  } finally { if(plistBinding)fs.closeSync(plistBinding.fd); }
}
