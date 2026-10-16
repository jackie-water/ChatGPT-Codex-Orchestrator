import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSafeSync } from "./spawn-safe.mjs";

const HOME = () => process.env.HOME || os.homedir();
const cmd = (name,args=[],options={}) => { const r=spawnSafeSync(name,args,{encoding:"utf8",...options}); return {ok:r.status===0, output:(r.stdout||r.stderr||"").trim()}; };
const homeContained = value => {
  if(!value) return false;
  const home=path.resolve(HOME());
  const target=path.resolve(value);
  return target===home || target.startsWith(home+path.sep);
};
const privatePath = value => {
  if(!homeContained(value)) return false;
  let current=path.resolve(value);
  while(current!==path.resolve(HOME())) {
    try { const st=fs.lstatSync(current); if(st.isSymbolicLink() || st.uid!==process.getuid?.() || (st.mode&0o022)!==0) return false; } catch { /* future paths are checked lexically */ }
    current=path.dirname(current);
  }
  return true;
};

export function parseNodeMajor(version) { return Number((String(version||"").match(/v(\d+)/)||[])[1]||0); }
export function macosPrerequisites() {
  const node=cmd("node",["--version"]), git=cmd("git",["--version"]), gh=cmd("gh",["--version"]), codex=cmd("codex",["--version"]);
  const major=parseNodeMajor(node.output);
  return {node:node.ok&&major>=22,node_version:node.output,git:git.ok,gh:gh.ok,codex:codex.ok,
    session_auth:codex.ok&&cmd("codex",["login","status"]).ok,github_auth:gh.ok&&cmd("gh",["auth","status"]).ok};
}

function redactStatus(status) {
  return status.split("\n").map(line=>line.replace(/[^\s]+(token|secret|oauth|credential|password)[^\s]*/ig,"[REDACTED]")).join("\n");
}
function gitInventory(root) {
  if(!root || !fs.existsSync(root) || !fs.existsSync(path.join(root,".git"))) return {present:false,reason:"missing-or-not-a-git-worktree"};
  const head=cmd("git",["-C",root,"rev-parse","HEAD"]), status=cmd("git",["-C",root,"status","--porcelain=v1","--untracked-files=all"]);
  const evidence=redactStatus(status.output||"");
  return {present:true,root:path.resolve(root),head:head.output||null,dirty:Boolean(evidence),status:evidence};
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

export function detectConcurrentRunner({state={}}={}) {
  const r=cmd("launchctl",["list"]);
  const label=state.runner_label||"";
  const found=r.ok&&label? r.output.split("\n").some(line=>line.includes(label)):false;
  const known=Boolean(state.runner_label||state.runner_path||state.instance_id);
  return {checked:r.ok,found,unknown:!r.ok||(!label&&known),fail_closed:!r.ok||(!label&&known),output:r.output};
}

export function migrationPreflight({state={},home=HOME()}={}) {
  const inventory=migrationInventory({state,home});
  const concurrent=detectConcurrentRunner({state});
  inventory.runner.concurrent=concurrent.found;
  inventory.runner.ownership=concurrent.unknown?"UNKNOWN":(concurrent.found?"OTHER_OR_CURRENT":"NONE_DETECTED");
  const conflicts=[];
  if(concurrent.found||concurrent.fail_closed) conflicts.push({kind:concurrent.found?"concurrent_runner":"runner_ownership_unknown",action:"stop_and_resolve_manually"});
  if(inventory.git.dirty) conflicts.push({kind:"dirty_repository",action:"preserve_and_resolve_manually"});
  return {status:conflicts.length?"CONFLICT":"READY",inventory,conflicts,mutations_performed:false,rollback:{available:true,automatic:false}};
}

export function renderLaunchAgent({label,runnerPath,instanceRoot,programArguments=[]}={}) {
  if(!/^com\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(label)) throw new Error("LaunchAgent label must be reverse-DNS");
  if(!runnerPath||!instanceRoot||![runnerPath,instanceRoot].every(privatePath)) throw new Error("LaunchAgent paths must be private HOME-scoped paths");
  const xml=x=>String(x).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${[runnerPath,...programArguments].map(x=>`<string>${xml(x)}</string>`).join("")}</array><key>WorkingDirectory</key><string>${xml(instanceRoot)}</string><key>RunAtLoad</key><false/></dict></plist>`;
}

export function macosRuntimeAction(action,{state={}}={}) {
  if(!["status","doctor","install","start","stop","repair"].includes(action)) return {status:"ERROR",mutations_performed:false,action};
  const preflight=migrationPreflight({state});
  if(preflight.status!=="READY") return {status:"ERROR",error_id:"MACOS-RUNNER-OWNERSHIP",mutations_performed:false,preflight,action:"Resolve runner ownership manually; no existing runner was stopped."};
  const label=state.launch_agent_label, plist=path.join(HOME(),"Library","LaunchAgents",`${label}.plist`), listed=cmd("launchctl",["list"]);
  if(!state.sandbox_only || state.target_environment_ready===true || !state.instance_id || state.runner_owner!==state.installation_id || !/^com\.chatgpt\.codex\.[A-Za-z0-9-]+$/.test(String(label||"")) || !/^[A-Za-z0-9._-]+$/.test(String(state.runner_label||""))) return {status:"ERROR",error_id:"MACOS-SANDBOX-SCOPE",mutations_performed:false,action,details:"Runner and LaunchAgent identities are incomplete or target ownership is present."};
  if(state.browser_port_conflict===true || state.browser_profile_conflict===true || state.conflicting_runner===true) return {status:"ERROR",error_id:"MACOS-INSTANCE-CONFLICT",mutations_performed:false,action};
  const active=listed.ok&&listed.output.split("\n").some(line=>line.includes(label));
  if(action==="status"||action==="doctor") return {status:"PASS",mutations_performed:false,launchctl_checked:listed.ok,launchctl_state:active?"loaded":"not-loaded",plist_exists:fs.existsSync(plist),preflight};
  if(state.macos_setup_approved!==true || state.macos_action_approval!==action) return {status:"NEEDS_USER_ACTION",error_id:"MACOS-ACTION-APPROVAL",mutations_performed:false,action:"Approve this exact macOS action: "+action};
  if(action==="install"||action==="repair") { if(fs.existsSync(plist)){ const st=fs.lstatSync(plist); if(st.isSymbolicLink()||st.uid!==process.getuid?.()||st.mode&0o022) return {status:"ERROR",error_id:"MACOS-PLIST-COLLISION",mutations_performed:false,action}; if(action==="install"&&!state.plist_owned) return {status:"ERROR",error_id:"MACOS-PLIST-COLLISION",mutations_performed:false,action}; } fs.mkdirSync(path.dirname(plist),{recursive:true,mode:0o700}); const temp=plist+`.${process.pid}.tmp`; const fd=fs.openSync(temp,"wx",0o600); try { fs.writeFileSync(fd,renderLaunchAgent({label,runnerPath:state.runner_path,instanceRoot:state.instance_root})); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp,plist); fs.chmodSync(plist,0o600); return {status:"PASS",mutations_performed:true,action,plist}; }
  if(!listed.ok) return {status:"ERROR",error_id:"MACOS-LAUNCHCTL-001",mutations_performed:false,details:listed.output};
  const result=cmd("launchctl",[action==="start"?"bootstrap":"bootout",`gui/${process.getuid?.()||0}`,plist]);
  return {status:result.ok?"PASS":"ERROR",mutations_performed:result.ok,action,launchctl_state:result.ok?(action==="start"?"loaded":"not-loaded"):"unknown",details:result.output};
}
