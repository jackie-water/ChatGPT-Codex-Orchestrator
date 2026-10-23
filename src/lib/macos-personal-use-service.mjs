import { readMacosNativeProcessIdentity } from "./macos-native-process-identity.mjs";

export const MACOS_PERSONAL_USE_POLICY="personal-account-trusted-same-uid-v1";
export function macosPersonalUsePolicyChallenge(state) {
  return `APPROVE personal Mac trusted same-UID account ${state.github_login} installation ${state.installation_id} private Control ${state.control_repository}#${state.control_repository_id}; execute only owner-authorized private Control tasks; no same-account attacker resistance`;
}
export function hasMacosPersonalUsePolicy(state) {
  const policy=state.macos_service_policy;
  return policy?.schema_version===1&&policy.policy===MACOS_PERSONAL_USE_POLICY&&policy.selected_through==="official-installer"&&policy.approval===macosPersonalUsePolicyChallenge(state)&&policy.installation_id===state.installation_id&&policy.github_login===state.github_login&&policy.control_repository===state.control_repository&&String(policy.control_repository_id)===String(state.control_repository_id)&&Number.isFinite(Date.parse(policy.approved_at||""));
}
function nativeIdentity(pid,reader,helperPath) {
  const value=reader(pid,{helperPath,platform:"darwin"});
  if(value?.status!=="OK"||value.pid!==pid||!Number.isSafeInteger(value.start_sec)||value.start_sec<0||!Number.isSafeInteger(value.start_usec)||value.start_usec<0||value.start_usec>=1000000)throw new Error("Native service PID/start-time identity is unavailable");
  return {pid,start_sec:value.start_sec,start_usec:value.start_usec};
}
function processTable(commandRunner) {
  // ps discovers commands and edges; it never supplies execution identity.
  const result=commandRunner("/bin/ps",["-ww","-axo","uid=,pid=,ppid=,command="]);
  const text=String(result?.output??result?.stdout??"");
  if(!result?.ok||text.length>1024*1024)throw new Error("Service process inventory is unavailable or unbounded");
  const rows=new Map(),lines=text.split("\n");
  if(lines.length>20000)throw new Error("Service process inventory exceeds its bound");
  for(const line of lines) {
    if(!line.trim())continue;
    const match=line.match(/^\s*(\d+)\s+([1-9]\d*)\s+(\d+)\s+(.+)$/);
    if(!match)throw new Error("Service process inventory is ambiguous");
    const row={uid:Number(match[1]),pid:Number(match[2]),ppid:Number(match[3]),command:match[4]};
    if(![row.uid,row.pid,row.ppid].every(Number.isSafeInteger)||rows.has(row.pid))throw new Error("Duplicate or invalid process identity");
    rows.set(row.pid,row);
  }
  return rows;
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// A launchd PID is the shell supervisor, not Runner.Listener. Bind two native
// observations and two complete command/edge observations for every chain node.
// The unchanged libproc helper retains its native 500ms call contract.
export function inspectMacosPersonalUseLineage({jobPid,runner,helperPath,commandRunner,identityReader=readMacosNativeProcessIdentity,uid=process.getuid?.()}={}) {
  if(jobPid===null) {
    if(!runner||typeof runner!=="object"||Array.isArray(runner)||runner.status!=="PASS")throw new Error("Independent runner identity is unavailable or invalid");
    if(runner.local_listener_pid!==null&&runner.local_listener_pid!==undefined)throw new Error("A listener exists outside the imported service");
    if(!Array.isArray(runner.local_service_pids)||runner.local_service_pids.length!==0)throw new Error("An extra or unmanaged runner supervisor exists");
    return {listener_running:false,job_identity:null,listener_identity:null};
  }
  if(!Number.isSafeInteger(jobPid)||jobPid<=1||!runner.service_executable||!runner.service_node||!runner.service_script)throw new Error("Official service chain identity is incomplete");
  const before=processTable(commandRunner),shell=before.get(jobPid);
  if(!shell||shell.uid!==uid||shell.ppid!==1||shell.command!==`/bin/bash ${runner.service_executable}`)throw new Error("Imported job is not the owned official runsvc shell supervised by launchd");
  const relativeNode=`./externals/${runner.service_node_version}/bin/node ./bin/RunnerService.js`;
  const nodeCommands=new Set([relativeNode,`${runner.service_node} ${runner.service_script}`]);
  const nodes=[...before.values()].filter(row=>row.ppid===jobPid);
  if(nodes.length>1||nodes.length===1&&(nodes[0].uid!==uid||!nodeCommands.has(nodes[0].command)))throw new Error("Service interpreter lineage is foreign or ambiguous");
  const node=nodes[0]||null;
  const listeners=[...before.values()].filter(row=>/Runner\.(?:Listener|Worker)(?:\s|$)/.test(row.command));
  const listener=listeners[0]||null;
  if(listeners.length>1||listener&&(!node||listener.uid!==uid||listener.ppid!==node.pid||listener.command!==`${runner.runner_executable} run --startuptype service`||listener.pid!==runner.local_listener_pid)||!listener&&runner.local_listener_pid)throw new Error("Listener does not have the exact approved service lineage");
  const chain=[shell,...(node?[node]:[]),...(listener?[listener]:[])];
  const supervisors=[...before.values()].filter(row=>/(?:runsvc\.sh|RunnerService\.js)(?:\s|$)/.test(row.command));
  if(!Array.isArray(runner.local_service_pids)||!equal(supervisors.map(row=>row.pid).sort((a,b)=>a-b),runner.local_service_pids)||supervisors.some(row=>!chain.some(member=>member.pid===row.pid)))throw new Error("An extra or unmanaged runner supervisor exists");
  const identities=chain.map(row=>nativeIdentity(row.pid,identityReader,helperPath));
  if(listener&&!equal(identities.at(-1),runner.local_listener_identity))throw new Error("Listener native identity differs from the independently inspected runner");
  const after=processTable(commandRunner);
  for(let index=0;index<chain.length;index++) {
    const row=chain[index];
    if(!equal(row,after.get(row.pid))||!equal(identities[index],nativeIdentity(row.pid,identityReader,helperPath)))throw new Error("Service chain changed or a PID was reused during inspection");
  }
  const afterChildren=[...after.values()].filter(row=>row.ppid===jobPid||node&&row.ppid===node.pid).sort((a,b)=>a.pid-b.pid);
  const beforeChildren=[...before.values()].filter(row=>row.ppid===jobPid||node&&row.ppid===node.pid).sort((a,b)=>a.pid-b.pid);
  if(!equal(beforeChildren,afterChildren))throw new Error("Service descendants changed during inspection");
  return {listener_running:Boolean(listener),job_identity:identities[0],node_identity:node?identities[1]:null,listener_identity:listener?identities.at(-1):null};
}
