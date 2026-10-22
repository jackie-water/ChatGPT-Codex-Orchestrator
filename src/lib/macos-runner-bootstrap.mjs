import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { spawnSafeSync } from "./spawn-safe.mjs";
import { canonicalInstallationId } from "./control-render.mjs";
import { trustedCodeReviewCodexExecutable } from "./macos-code-review-runtime.mjs";

const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const ID = /^[1-9][0-9]*$/;
const HASH = /^[a-f0-9]{64}$/;
export const MACOS_RUNNER_RUNTIME_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const run = (command, args,options={}) => {
  const r = spawnSafeSync(command, args, {encoding:"utf8",shell:false,timeout:15000,maxBuffer:1024*1024,...options});
  return {ok:r.status===0,output:String(r.stdout||r.stderr||"").trim()};
};
function reject(code, details) { const e = new Error(details); e.code = code; throw e; }
function inside(root, target) { return target === root || target.startsWith(root + path.sep); }
function owned(st) { return typeof process.getuid !== "function" || st.uid === process.getuid(); }
function checkHomeAncestors(home,fsImpl) {
  const absolute=path.resolve(home); let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part); const st=fsImpl.lstatSync(current);
    const stickyTemp=["/tmp","/private/tmp"].includes(current)&&st.uid===0&&(st.mode&0o7777)===0o1777;
    if(st.isSymbolicLink()||!st.isDirectory()||(!owned(st)&&st.uid!==0)||(!stickyTemp&&(st.mode&0o022)!==0)) reject("MACOS-RUNNER-PATH","Unsafe selected HOME ancestor");
  }
}
function checkPath(file, {home, directory=false, executable=false, privateLeaf=true, fsImpl=fs}={}) {
  const absolute=path.resolve(file), base=path.resolve(home);
  if(!inside(base,absolute)) reject("MACOS-RUNNER-PATH","Path escapes the selected HOME");
  let current=base;
  for(const part of ["",...path.relative(base,absolute).split(path.sep).filter(Boolean)]) {
    if(part) current=path.join(current,part);
    const st=fsImpl.lstatSync(current), leaf=current===absolute;
    if(st.isSymbolicLink()||!owned(st)||(st.mode&0o022)!==0) reject("MACOS-RUNNER-PATH","Unsafe ownership, link, or writable ancestor");
    if(!leaf&&!st.isDirectory()) reject("MACOS-RUNNER-PATH","Nondirectory ancestor");
    if(leaf) {
      if(directory?!st.isDirectory():(!st.isFile()||st.nlink!==1)) reject("MACOS-RUNNER-PATH","Expected an independently owned directory or singly linked regular file");
      if(privateLeaf&&(st.mode&0o077)!==0) reject("MACOS-RUNNER-PATH","Selected instance data is not private");
      if(executable&&(st.mode&0o100)===0) reject("MACOS-RUNNER-EXECUTABLE","Approved launch executable is not executable");
    }
  }
  return absolute;
}
function json(file,options) { checkPath(file,options); return JSON.parse((options.fsImpl||fs).readFileSync(file,"utf8")); }
function api(commandRunner, endpoint) {
  const response=commandRunner("gh",["api","--hostname","github.com",endpoint],{env:{...process.env,PATH:MACOS_RUNNER_RUNTIME_PATH}});
  if(!response?.ok) reject("MACOS-RUNNER-GITHUB-UNVERIFIED","Read-only GitHub identity query failed");
  try { return JSON.parse(response.output??response.stdout??""); }
  catch { reject("MACOS-RUNNER-GITHUB-UNVERIFIED","Read-only GitHub query returned invalid JSON"); }
}
function verifyRuntimeTools(commandRunner,fsImpl) {
  for(const directory of MACOS_RUNNER_RUNTIME_PATH.split(":")) {
    let current=path.parse(directory).root;
    for(const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
      current=path.join(current,part);let stat;
      try { stat=fsImpl.lstatSync(current); }catch(error){if(error.code==="ENOENT")break;throw error;}
      if(stat.isSymbolicLink()||!stat.isDirectory()||(!owned(stat)&&stat.uid!==0)||(stat.mode&0o022)!==0)reject("MACOS-RUNNER-PATH-UNTRUSTED","LaunchAgent runtime PATH contains an unsafe directory or ancestor");
    }
  }
  for(const tool of ["node","gh"]) {
    const result=commandRunner("/usr/bin/which",[tool],{env:{PATH:MACOS_RUNNER_RUNTIME_PATH,LC_ALL:"C"}});
    const executable=String(result?.output??result?.stdout??"").trim();
    if(!result?.ok||!MACOS_RUNNER_RUNTIME_PATH.split(":").includes(path.dirname(executable)))reject("MACOS-RUNNER-TOOLS-MISSING","Trusted node and gh must be available in the approved LaunchAgent PATH");
    const pinned=trustedCodeReviewCodexExecutable(fsImpl.realpathSync(executable));
    if(tool==="node"&&pinned!==fsImpl.realpathSync(process.execPath))reject("MACOS-RUNNER-NODE-MISMATCH","LaunchAgent node must be the same trusted native Node executable as the installer");
  }
}
function verifyBrowser(commandRunner,home,profile,port) {
  const listener=commandRunner("/usr/sbin/lsof",["-nP",`-iTCP:${port}`,"-sTCP:LISTEN","-Fpcn"]);
  if(!listener?.ok) reject("MACOS-RUNNER-BROWSER-UNVERIFIED","The approved browser must already be listening on its isolated port; this adapter never opens a browser");
  const lines=String(listener.output??listener.stdout??"").split("\n"),pids=[...new Set(lines.filter(x=>/^p[1-9][0-9]*$/.test(x)).map(x=>x.slice(1)))],addresses=lines.filter(x=>x.startsWith("n")).map(x=>x.slice(1));
  if(pids.length!==1||addresses.length===0||addresses.some(value=>!new Set([`127.0.0.1:${port}`,`[::1]:${port}`]).has(value))) reject("MACOS-RUNNER-BROWSER-CONFLICT","Browser port is shared, externally bound, or has unknown ownership");
  const processProof=commandRunner("/bin/ps",["-ww","-p",pids[0],"-o","uid=,command="]);
  const text=String(processProof?.output??processProof?.stdout??"").trim(),match=text.match(/^(\d+)\s+(.+)$/);
  const escaped=String(profile).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const profileFlag=new RegExp(`(?:^|\\s)--user-data-dir=${escaped}(?=\\s+--|$)`);
  const portFlag=new RegExp(`(?:^|\\s)--remote-debugging-port=${port}(?=\\s|$)`);
  const approvedBrowsers=["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",path.join(home,"Applications","Google Chrome.app","Contents","MacOS","Google Chrome"),path.join(home,"Applications","Microsoft Edge.app","Contents","MacOS","Microsoft Edge")];
  if(!processProof?.ok||!match||Number(match[1])!==process.getuid?.()||!approvedBrowsers.some(browser=>match[2].startsWith(browser+" "))||!profileFlag.test(match[2])||!portFlag.test(match[2])||(match[2].match(/--user-data-dir(?:=|\s)/g)||[]).length!==1||(match[2].match(/--remote-debugging-port(?:=|\s)/g)||[]).length!==1) reject("MACOS-RUNNER-BROWSER-CONFLICT","The port owner is not the exact owned isolated browser profile");
  return {pid:Number(pids[0]),profile,port};
}
function verifyLocalRunnerProcesses(commandRunner,executable) {
  const result=commandRunner("/bin/ps",["-ww","-axo","uid=,pid=,command="]);
  if(!result?.ok)reject("MACOS-RUNNER-PROCESS-UNKNOWN","Local runner process ownership cannot be independently inspected");
  const listeners=[];
  for(const line of String(result.output??result.stdout??"").split("\n")) {
    const match=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);if(!match)continue;
    const command=match[3];
    if(!/^(?:\/[^;]*\/)?Runner\.(?:Listener|Worker)(?:\s|$)/.test(command))continue;
    if(Number(match[1])!==process.getuid?.()||command!==`${executable} run`)reject("MACOS-RUNNER-PROCESS-CONFLICT","An extra, busy, foreign, or unmanaged runner process is present");
    listeners.push(Number(match[2]));
  }
  if(listeners.length>1)reject("MACOS-RUNNER-PROCESS-CONFLICT","More than one runner listener is present");
  return listeners[0]||null;
}
const PACKAGE_FILE_BOUND=256*1024*1024, PACKAGE_TOTAL_BOUND=512*1024*1024;
function samePackageFile(a,b) {
  return ["dev","ino","uid","gid","mode","nlink","size","mtimeMs","ctimeMs"].every(key=>a[key]===b[key]);
}
function readPackageFile(file,options,{bound=PACKAGE_FILE_BOUND,executable}={}) {
  const fsImpl=options.fsImpl||fs;
  checkPath(file,{...options,executable:executable===true});
  const before=fsImpl.lstatSync(file);
  if(!Number.isSafeInteger(before.size)||before.size<0||before.size>bound)reject("MACOS-RUNNER-PACKAGE","Runner package file exceeds its inspection bound");
  let fd;
  try {
    fd=fsImpl.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const opened=fsImpl.fstatSync(fd);
    if(!opened.isFile()||opened.nlink!==1||!samePackageFile(before,opened)||(executable!==undefined&&Boolean(opened.mode&0o100)!==executable))reject("MACOS-RUNNER-PACKAGE","Runner package identity or executable mode changed");
    const bytes=Buffer.alloc(opened.size);let cursor=0;
    while(cursor<bytes.length) {
      const count=fsImpl.readSync(fd,bytes,cursor,bytes.length-cursor,null);
      if(!count)reject("MACOS-RUNNER-PACKAGE","Runner package changed during inspection");
      cursor+=count;
    }
    if(fsImpl.readSync(fd,Buffer.alloc(1),0,1,null)!==0||!samePackageFile(opened,fsImpl.fstatSync(fd))||!samePackageFile(opened,fsImpl.lstatSync(file)))reject("MACOS-RUNNER-PACKAGE","Runner package changed during inspection");
    checkPath(file,options);
    return bytes;
  } finally { if(fd!==undefined)fsImpl.closeSync(fd); }
}
function inspectRunnerEnvironment(root,options) {
  // Runner.Listener imports .env itself. Only these inert, exact locale values
  // may supplement the LaunchAgent environment; PATH and every other key fail.
  const fsImpl=options.fsImpl||fs,file=path.join(root,".env");
  try {
    if(!fs.constants.O_NOFOLLOW)reject("MACOS-RUNNER-ENV","No-follow environment inspection is unavailable");
    checkPath(root,{...options,directory:true});
    let before;
    try { before=fsImpl.lstatSync(file); }
    catch(error) { if(error.code==="ENOENT")return {digest:null,identity:null};throw error; }
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||!owned(before)||![0o400,0o600].includes(before.mode&0o7777))reject("MACOS-RUNNER-ENV","Unsafe runner environment file");
    const bytes=readPackageFile(file,options,{bound:4096,executable:false});
    const after=fsImpl.lstatSync(file);
    if(!samePackageFile(before,after))reject("MACOS-RUNNER-ENV","Runner environment changed during inspection");
    const lines=bytes.length?bytes.toString("utf8").split("\n"):[];
    if(lines.at(-1)==="")lines.pop();
    const keys=new Set();
    for(const line of lines) {
      const key=line==="LANG=C"?"LANG":line==="LC_ALL=C"?"LC_ALL":null;
      if(key===null||keys.has(key))reject("MACOS-RUNNER-ENV","Unapproved runner environment contents");
      keys.add(key);
    }
    return {digest:sha(bytes),identity:Object.fromEntries(["dev","ino","uid","gid","mode","nlink","size","mtimeMs","ctimeMs"].map(key=>[key,after[key]]))};
  } catch { reject("MACOS-RUNNER-ENV","Runner .env must be absent or a private, stable file containing only approved exact locale values"); }
}
function approvedRunnerEnvironment(root,approval,options) {
  if(!Object.hasOwn(approval,"env_sha256")||(approval.env_sha256!==null&&!HASH.test(String(approval.env_sha256))))reject("MACOS-RUNNER-ENV","Explicit runner environment approval is required");
  const environment=inspectRunnerEnvironment(root,options);
  if(environment.digest!==approval.env_sha256)reject("MACOS-RUNNER-ENV","Runner environment differs from its exact approval");
  return environment;
}
function verifyPackagePayload(root,layout,options) {
  const {manifest,directories,executables}=layout,found=[];
  // These are generated runner state, not release payload. Never descend into
  // action workspaces or diagnostic logs when binding the installed package.
  const mutableFiles=new Set([".runner",".credentials",".credentials_rsaparams",".env",".path"]),mutableDirectories=new Set(["_work","_diag"]);
  let visited=0,total=0;
  function walk(dir,depth=0) {
    if(depth>32||++visited>20000)reject("MACOS-RUNNER-PACKAGE","Runner package tree exceeds its inspection bound");
    checkPath(dir,{...options,directory:true});
    for(const entry of options.fsImpl.readdirSync(dir)) {
      if(++visited>20000||entry.includes(path.sep)||entry==="."||entry==="..")reject("MACOS-RUNNER-PACKAGE","Runner package inventory exceeds its bound or has an invalid path");
      const file=path.join(dir,entry),relative=path.relative(root,file).split(path.sep).join("/");
      if(dir===root&&mutableFiles.has(entry)) {
        checkPath(file,options);
        if(options.fsImpl.lstatSync(file).mode&0o111)reject("MACOS-RUNNER-PACKAGE","Generated runner state cannot be an executable dependency");
        continue;
      }
      if(dir===root&&mutableDirectories.has(entry)) { checkPath(file,{...options,directory:true});continue; }
      if(directories.has(relative)) walk(file,depth+1);
      else {
        if(!Object.hasOwn(manifest,relative))reject("MACOS-RUNNER-PACKAGE","Unapproved runner package file or directory");
        const bytes=readPackageFile(file,options,{executable:executables.has(relative)});total+=bytes.length;
        if(total>PACKAGE_TOTAL_BOUND||sha(bytes)!==manifest[relative])reject("MACOS-RUNNER-PACKAGE","Unapproved or modified runner package dependency");
        found.push(relative);
      }
    }
  }
  walk(root);
  if(found.sort().join("\n")!==Object.keys(manifest).sort().join("\n"))reject("MACOS-RUNNER-PACKAGE","Runner package manifest has missing or extra files");
  // Empty official directories also belong to the inspected archive layout.
  for(const directory of directories)checkPath(path.join(root,directory),{...options,directory:true});
}
function arm64MachO(bytes) {
  if(bytes.length<32) return false;
  // A native thin 64-bit ARM executable is required; scripts, Intel binaries and
  // uninspected universal wrappers cannot become the LaunchAgent executable.
  return bytes.readUInt32LE(0)===0xfeedfacf && bytes.readUInt32LE(4)===0x0100000c && bytes.readUInt32LE(12)===2;
}
function archiveBinaryManifest(archive) {
  if(archive.length>PACKAGE_FILE_BOUND) reject("MACOS-RUNNER-PACKAGE","Runner archive exceeds its inspection bound");
  let tar; try { tar=gunzipSync(archive,{maxOutputLength:PACKAGE_TOTAL_BOUND}); } catch { reject("MACOS-RUNNER-PACKAGE","Runner package is not a bounded readable official gzip archive"); }
  const manifest=Object.create(null),directories=new Set(),executables=new Set(),nativeExecutables=new Set(),entries=new Map();
  let offset=0,nextName=null,paxName=null,count=0,ended=false;
  const field=bytes=>{
    const end=bytes.indexOf(0),value=end<0?bytes:bytes.subarray(0,end);
    if(end>=0&&bytes.subarray(end).some(byte=>byte!==0))reject("MACOS-RUNNER-PACKAGE","Archive field has hidden trailing data");
    try { return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(value); } catch { reject("MACOS-RUNNER-PACKAGE","Archive field is not valid UTF-8"); }
  };
  const octal=bytes=>{if(bytes.some(byte=>byte!==0&&byte!==32&&(byte<48||byte>55)))reject("MACOS-RUNNER-PACKAGE","Uninspected archive numeric encoding");const value=bytes.toString("ascii").replace(/[\0 ]+$/g,"").trim();if(!/^[0-7]+$/.test(value))reject("MACOS-RUNNER-PACKAGE","Uninspected archive numeric encoding");const number=Number.parseInt(value,8);if(!Number.isSafeInteger(number))reject("MACOS-RUNNER-PACKAGE","Unbounded archive numeric field");return number;};
  const canonicalName=(input,type)=>{
    let name=input.startsWith("./")?input.slice(2):input;
    if(type==="5"&&name.endsWith("/"))name=name.slice(0,-1);
    if(name===""&&type==="5")return "";
    const parts=name.split("/");
    if(name.length>4096||parts.length>32||parts.some(part=>!part||part==="."||part===".."||/[^A-Za-z0-9_.+@-]/.test(part)))reject("MACOS-RUNNER-PACKAGE","Archive path is not a canonical private package path");
    if((parts.length>1||type==="5")&&!["bin","externals"].includes(parts[0]))reject("MACOS-RUNNER-PACKAGE","Archive has an unapproved payload root");
    if(parts[0].startsWith(".")||["_work","_diag"].includes(parts[0]))reject("MACOS-RUNNER-PACKAGE","Archive collides with generated runner state");
    return name;
  };
  while(offset+512<=tar.length) {
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(byte=>byte===0)) {
      if(tar.length%512!==0||tar.length-offset<512||tar.subarray(offset).some(byte=>byte!==0))reject("MACOS-RUNNER-PACKAGE","Archive has an invalid end marker or hidden trailing payload");
      ended=true;break;
    }
    if(++count>20000) reject("MACOS-RUNNER-PACKAGE","Runner archive inventory exceeds its bound");
    const checksum=octal(header.subarray(148,156)),actual=header.reduce((sum,byte,index)=>sum+(index>=148&&index<156?32:byte),0);
    if(checksum!==actual) reject("MACOS-RUNNER-PACKAGE","Archive header checksum mismatch");
    if(!["ustar\0","ustar "].some(magic=>header.subarray(257,263).equals(Buffer.from(magic,"ascii"))))reject("MACOS-RUNNER-PACKAGE","Archive uses an uninspected header format");
    const size=octal(header.subarray(124,136)),type=String.fromCharCode(header[156]||48),payload=tar.subarray(offset,offset+size);
    if(size>PACKAGE_FILE_BOUND||offset+Math.ceil(size/512)*512>tar.length) reject("MACOS-RUNNER-PACKAGE","Truncated or unbounded runner archive file");
    offset+=Math.ceil(size/512)*512;
    if(type==="L") {
      if(nextName!==null||paxName!==null||size>4096)reject("MACOS-RUNNER-PACKAGE","Unbounded or ambiguous archive long name");
      nextName=field(payload);continue;
    }
    if(type==="x") {
      if(nextName!==null||paxName!==null||size>16384)reject("MACOS-RUNNER-PACKAGE","Unbounded or ambiguous archive extended header");
      let cursor=0;
      const keys=new Set();
      while(cursor<payload.length) {
        const space=payload.indexOf(32,cursor),digitBytes=payload.subarray(cursor,space),digits=digitBytes.toString("ascii"),length=Number(digits);
        if(space<cursor||digitBytes.some(byte=>byte<48||byte>57)||!/^[1-9][0-9]*$/.test(digits)||!Number.isSafeInteger(length)||length<=space-cursor+2||cursor+length>payload.length||payload[cursor+length-1]!==10) reject("MACOS-RUNNER-PACKAGE","Malformed archive extended header");
        const record=field(payload.subarray(space+1,cursor+length-1)),equals=record.indexOf("="),key=record.slice(0,equals),value=record.slice(equals+1);
        if(equals<1||keys.has(key)||!["path","mtime","atime","ctime","uid","gid","uname","gname"].includes(key)||/[\r\n\0]/.test(value))reject("MACOS-RUNNER-PACKAGE","Uninspected archive extended-header override");
        keys.add(key);if(key==="path")paxName=value;
        cursor+=length;
      }
      continue;
    }
    const prefix=field(header.subarray(345,500));
    if(!["0","5"].includes(type))reject("MACOS-RUNNER-PACKAGE","Archive contains a link or unapproved special file");
    if(field(header.subarray(157,257))!=="")reject("MACOS-RUNNER-PACKAGE","Archive regular entry contains an unexpected link target");
    const name=canonicalName(paxName??nextName??[prefix,field(header.subarray(0,100))].filter(Boolean).join("/"),type);nextName=null;paxName=null;
    const mode=octal(header.subarray(100,108));
    if((mode&0o7022)!==0||mode>0o777||type==="5"&&size!==0)reject("MACOS-RUNNER-PACKAGE","Archive entry has unsafe mode or directory contents");
    if(name==="")continue;
    if(entries.has(name)||type==="0"&&directories.has(name))reject("MACOS-RUNNER-PACKAGE","Archive repeats or aliases a package path");
    const parts=name.split("/");
    for(let index=1;index<parts.length;index++) {
      const parent=parts.slice(0,index).join("/");
      if(entries.get(parent)==="0")reject("MACOS-RUNNER-PACKAGE","Archive path traverses a regular file");
      directories.add(parent);
    }
    entries.set(name,type);
    if(type==="5")directories.add(name);
    else {
      if(Object.keys(manifest).length>=8192)reject("MACOS-RUNNER-PACKAGE","Runner package file inventory exceeds its bound");
      const magic=payload.length>=4?payload.readUInt32LE(0):0;
      if([0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(magic)&&(payload.length<32||magic!==0xfeedfacf||payload.readUInt32LE(4)!==0x0100000c))reject("MACOS-RUNNER-PACKAGE","Official package contains a nonnative or uninspected native dependency");
      manifest[name]=sha(payload);if(mode&0o111)executables.add(name);if(arm64MachO(payload))nativeExecutables.add(name);
    }
  }
  if(!ended||nextName!==null||paxName!==null||!nativeExecutables.has("bin/Runner.Listener")||!executables.has("bin/Runner.Listener"))reject("MACOS-RUNNER-PACKAGE","Official archive lacks a complete native runner payload");
  const runtimes=[...directories].filter(name=>/^externals\/node[1-9][0-9]*$/.test(name));
  if(runtimes.length===0)reject("MACOS-RUNNER-PACKAGE","Official archive lacks bundled JavaScript action runtimes");
  for(const runtime of runtimes) {
    const node=`${runtime}/bin/node`;
    if(!nativeExecutables.has(node)||!executables.has(node))reject("MACOS-RUNNER-PACKAGE","Official archive has an incomplete native ARM64 JavaScript action runtime");
    // The bytes were already bounded and hashed above. Require the executable
    // shape too; a script or wrong-architecture replacement is not a runtime.
    if(entries.get(node)!=="0")reject("MACOS-RUNNER-PACKAGE","Official action runtime is not a regular executable");
  }
  return {manifest,directories,executables};
}
export function macosRunnerApprovalRequest({state={},home=process.env.HOME||os.homedir()}={}) {
  const root=path.join(path.resolve(home),".chatgpt-codex-orchestrator","instances",canonicalInstallationId(state.installation_id));
  return {action_id:"provision_macos_runner",receipt_path:path.join(root,"macos-runner-approval.json"),candidate_path:path.join(root,"macos-runner-candidate.json"),runner_path:path.join(root,"runner"),runner_executable:path.join(root,"runner","bin","Runner.Listener"),archive_path:path.join(root,"runner-package.tar.gz"),mutations_performed:false,
    action:"Separately approve the exact official actions/runner macOS ARM64 release, acquire and register one isolated repository runner, and record the private approval bound to this installation. This adapter never downloads, extracts, configures, or registers a runner. Install and start require further separate approvals."};
}

// This inspection never acquires a package, registers a runner, starts a process,
// repairs permissions, touches historical instances, or treats a receipt as a
// substitute for the independent GitHub repository and runner API identities.
export function inspectMacosRunnerBootstrap({state={},home=process.env.HOME||os.homedir(),commandRunner=run,requireOnline=false,requireApproval=true,platform=process.platform,arch=process.arch,fsImpl=fs}={}) {
  const request=macosRunnerApprovalRequest({state,home}), fail=(error)=>({status:error.code==="ENOENT"?"NEEDS_USER_ACTION":"ERROR",error_id:error.code==="ENOENT"?"MACOS-RUNNER-PROVISIONING-REQUIRED":error.code||"MACOS-RUNNER-UNVERIFIED",details:String(error.message||error),...request});
  try {
    if(platform!=="darwin"||arch!=="arm64") reject("MACOS-RUNNER-PLATFORM","First-boot runner requires native macOS ARM64");
    checkHomeAncestors(home,fsImpl);
    verifyRuntimeTools(commandRunner,fsImpl);
    const short=canonicalInstallationId(state.installation_id),root=path.dirname(request.receipt_path),runner=request.runner_path,options={home,fsImpl};
    if(!state.installation_id||state.instance_id!==short||state.instance_root!==root||state.runner_path!==runner||state.runner_owner!==state.installation_id||state.runner_label!==`codex-orchestrator-${short}`||state.launch_agent_label!==`com.chatgpt.codex.${short}`||state.sandbox_project_key!==`sandbox-${short}`||state.sandbox_only!==true||state.target_environment_ready===true) reject("MACOS-RUNNER-INSTANCE","Runner identity is not the canonical isolated Sandbox installation");
    if(!/^[A-Za-z0-9-]+$/.test(String(state.github_login||""))||!ID.test(String(state.control_repository_id||""))||!ID.test(String(state.sandbox_repository_id||""))||String(state.control_repository_id)===String(state.sandbox_repository_id)||state.control_repository!==`${state.github_login}/chatgpt-codex-orchestrator-control-${short}`||state.sandbox_repository!==`${state.github_login}/chatgpt-codex-orchestrator-sandbox-${short}`) reject("MACOS-RUNNER-REPOSITORY","Distinct generated immutable repository identities are required");
    checkPath(root,{...options,directory:true}); checkPath(runner,{...options,directory:true});
    const expectedProfile=path.join(root,"browser-profile"), expectedOutbox=path.join(root,"pending-wakes");
    if(state.browser_profile!==expectedProfile||!Number.isInteger(state.browser_port)||state.browser_port<1024||state.browser_port>65535||state.pending_wake_outbox!==expectedOutbox||state.browser_port_conflict===true||state.browser_profile_conflict===true||state.conflicting_runner===true) reject("MACOS-RUNNER-ISOLATION","Browser profile, port, outbox, or runner isolation is incomplete");
    checkPath(expectedProfile,{...options,directory:true}); checkPath(expectedOutbox,{...options,directory:true});
    const browser=verifyBrowser(commandRunner,home,expectedProfile,state.browser_port);
    const approval=json(requireApproval?request.receipt_path:request.candidate_path,options), config=json(path.join(runner,".runner"),options);
    const exact={installation_id:state.installation_id,instance_id:short,instance_path:root,project:state.sandbox_project_key,control_repository:state.control_repository,sandbox_repository:state.sandbox_repository,control_repository_id:String(state.control_repository_id),sandbox_repository_id:String(state.sandbox_repository_id),runner_path:runner,runner_executable:request.runner_executable,runner_label:state.runner_label,launch_agent_label:state.launch_agent_label,browser_profile:expectedProfile,browser_port:state.browser_port,pending_wake_outbox:expectedOutbox,runtime_path:MACOS_RUNNER_RUNTIME_PATH};
    if(!exact.project||approval.schema_version!==1||Object.entries(exact).some(([key,value])=>approval[key]!==value)||(requireApproval&&(approval.approved_action!=="use-existing-official-macos-arm64-runner"||approval.approved_by!==state.github_login||!/^human-[A-Za-z0-9-]{8,100}$/.test(String(approval.approval_id||""))||!Number.isFinite(Date.parse(approval.approved_at||""))))) reject("MACOS-RUNNER-APPROVAL","Separate durable exact human runner approval is missing or mismatched");
    const environment=approvedRunnerEnvironment(runner,approval,options);
    if(!/^\d+\.\d+\.\d+$/.test(String(approval.source_version||""))||approval.source_url!==`https://github.com/actions/runner/releases/download/v${approval.source_version}/actions-runner-osx-arm64-${approval.source_version}.tar.gz`||!HASH.test(String(approval.archive_sha256||""))||!HASH.test(String(approval.executable_sha256||""))) reject("MACOS-RUNNER-APPROVAL","Official ARM64 source and approved artifact digests are required");
    const archive=readPackageFile(request.archive_path,options);
    if(sha(archive)!==approval.archive_sha256) reject("MACOS-RUNNER-PACKAGE","Retained approved official runner archive digest mismatch");
    const archiveLayout=archiveBinaryManifest(archive);
    if(!approval.binary_manifest||Array.isArray(approval.binary_manifest)||typeof approval.binary_manifest!=="object"||Object.keys(approval.binary_manifest).length>8192||Object.values(approval.binary_manifest).some(value=>!HASH.test(String(value)))||JSON.stringify(Object.entries(archiveLayout.manifest).sort())!==JSON.stringify(Object.entries(approval.binary_manifest).sort()))reject("MACOS-RUNNER-PACKAGE","Approved executable package manifest differs from the retained official archive");
    const executable=readPackageFile(request.runner_executable,options,{executable:true});
    if(!arm64MachO(executable)||sha(executable)!==approval.executable_sha256) reject("MACOS-RUNNER-EXECUTABLE","Approved launch path must be the exact native ARM64 Runner.Listener executable");
    const listenerPid=verifyLocalRunnerProcesses(commandRunner,request.runner_executable);
    for(const credentials of [".credentials",".credentials_rsaparams"]) checkPath(path.join(runner,credentials),options);
    const configDigest=sha(fsImpl.readFileSync(path.join(runner,".runner")));
    if(!ID.test(String(config.agentId||""))||String(config.agentId)!==String(approval.runner_id)||config.agentName!==state.runner_label||config.gitHubUrl!==`https://github.com/${state.control_repository}`||!/^https:\/\/[^/]+\.actions\.githubusercontent\.com\//.test(String(config.serverUrl||""))||config.workFolder!=="_work"||approval.config_sha256!==configDigest) reject("MACOS-RUNNER-CONFIG","Runner configuration does not match approved isolated GitHub identity");
    const user=api(commandRunner,"user");
    if(user.login!==state.github_login||String(user.id)!==String(approval.github_user_id)||!ID.test(String(user.id||""))) reject("MACOS-RUNNER-GITHUB-IDENTITY","Authenticated GitHub owner differs from the human-approved owner");
    for(const [repository,id] of [[state.control_repository,state.control_repository_id],[state.sandbox_repository,state.sandbox_repository_id]]) {
      const remote=api(commandRunner,`repos/${repository}`);
      if(remote.full_name!==repository||String(remote.id)!==String(id)||remote.private!==true||remote.owner?.login!==state.github_login||String(remote.owner?.id)!==String(user.id)) reject("MACOS-RUNNER-REPOSITORY","Remote private repository immutable identity mismatch");
    }
    const release=api(commandRunner,`repos/actions/runner/releases/tags/v${approval.source_version}`),assetName=`actions-runner-osx-arm64-${approval.source_version}.tar.gz`;
    const assets=Array.isArray(release.assets)?release.assets.filter(asset=>asset.name===assetName):[];
    if(release.tag_name!==`v${approval.source_version}`||release.draft!==false||release.prerelease!==false||String(release.id)!==String(approval.source_release_id)||!ID.test(String(approval.source_release_id||""))||assets.length!==1||String(assets[0].id)!==String(approval.source_asset_id)||!ID.test(String(approval.source_asset_id||""))||assets[0].browser_download_url!==approval.source_url||assets[0].digest!==`sha256:${approval.archive_sha256}`||assets[0].state!=="uploaded") reject("MACOS-RUNNER-OFFICIAL-SOURCE","Official actions/runner release asset identity or authoritative SHA-256 digest is unavailable or mismatched");
    const listing=api(commandRunner,`repos/${state.control_repository}/actions/runners?per_page=100`);
    if(listing.total_count!==1||!Array.isArray(listing.runners)||listing.runners.length!==1) reject("MACOS-RUNNER-EXTRA","Exactly one isolated Control repository runner is required");
    const remote=listing.runners[0],labels=Array.isArray(remote.labels)?remote.labels.map(x=>x.name):[];
    if(String(remote.id)!==String(config.agentId)||remote.name!==state.runner_label||remote.os!=="osx"||remote.busy!==false||!["online","offline"].includes(remote.status)||labels.length!==4||new Set(labels).size!==4||!["self-hosted","macOS","ARM64",state.runner_label].every(x=>labels.includes(x))) reject("MACOS-RUNNER-REMOTE","Runner name, id, macOS ARM64 labels, or isolated availability mismatch");
    if(requireOnline&&(remote.status!=="online"||listenerPid===null)) return {status:"NEEDS_USER_ACTION",error_id:"MACOS-RUNNER-OFFLINE",details:"The exact approved runner must be independently observed online with its matching owned local listener before CHAT-REGISTER publication.",...request};
    const metadata=json(path.join(state.control_clone_path||"","instance.json"),options), codex=metadata.codex_executable;
    if(metadata.schema_version!==1||metadata.role!=="control"||metadata.installation_id!==state.installation_id||metadata.instance_id!==short||metadata.instance_root!==root||metadata.platform!=="darwin"||metadata.arch!=="arm64"||metadata.runner_label!==state.runner_label||metadata.launch_agent_label!==state.launch_agent_label||metadata.trusted_github_username!==state.github_login||metadata.control_repository!==state.control_repository||metadata.sandbox_repository!==state.sandbox_repository||String(metadata.control_repository_id)!==String(state.control_repository_id)||String(metadata.sandbox_repository_id)!==String(state.sandbox_repository_id)||metadata.browser_profile!==expectedProfile||metadata.browser_port!==state.browser_port||metadata.pending_wake_outbox!==expectedOutbox||typeof codex!=="string"||!path.isAbsolute(codex)) reject("MACOS-RUNNER-CODEX","Pinned installed Codex identity is missing or mismatched");
    const projects=json(path.join(state.control_clone_path,"projects.json"),{...options,privateLeaf:false}).projects;
    if(!projects||Array.isArray(projects)||typeof projects!=="object"||projects[state.sandbox_project_key]?.repository!==state.sandbox_repository||projects[state.sandbox_project_key]?.enabled!==true||Object.entries(projects).some(([key,value])=>key!==state.sandbox_project_key&&value?.enabled!==false)) reject("MACOS-RUNNER-TARGET-ENABLED","Actual Control registry must enable only the independently isolated Sandbox; target activation remains gated for M6");
    trustedCodeReviewCodexExecutable(codex);
    const login=commandRunner(codex,["login","status"],{env:{...process.env,PATH:MACOS_RUNNER_RUNTIME_PATH}});
    if(!login?.ok||!/^Logged in using ChatGPT\s*$/im.test(String(login.output??login.stdout??""))) reject("MACOS-RUNNER-CODEX-LOGIN","Authentic ChatGPT Codex login is required; API-key or unverified authentication cannot start this runner");
    const challenge=sha(Buffer.from(JSON.stringify(approval)));
    const approvalDigest=requireApproval?sha(fsImpl.readFileSync(request.receipt_path)):null;
    // Inspect the extracted package after the read-only identity/auth callbacks,
    // then rebind the retained archive so late changes cannot authorize a runner.
    verifyPackagePayload(runner,archiveLayout,options);
    if(sha(readPackageFile(request.archive_path,options))!==approval.archive_sha256)reject("MACOS-RUNNER-PACKAGE","Retained official package changed before authorization");
    if(JSON.stringify(approvedRunnerEnvironment(runner,approval,options))!==JSON.stringify(environment))reject("MACOS-RUNNER-ENV","Runner environment changed before authorization");
    return {status:requireApproval?"PASS":"NEEDS_USER_ACTION",action_id:requireApproval?undefined:"macos_runner_package_approval",mutations_performed:false,installation_id:state.installation_id,instance_path:root,runner_path:runner,runner_executable:request.runner_executable,program_arguments:["run"],runner_id:String(remote.id),runner_label:state.runner_label,runner_status:remote.status,local_listener_pid:listenerPid,control_repository_id:String(state.control_repository_id),sandbox_repository_id:String(state.sandbox_repository_id),approval_id:approval.approval_id,approval_sha256:approvalDigest,approval_challenge:requireApproval?undefined:challenge,approval_candidate:requireApproval?undefined:approval,config_sha256:configDigest,env_sha256:environment.digest,browser};
  } catch(error) { return fail(error); }
}

export function approveMacosRunnerBootstrap({state={},home=process.env.HOME||os.homedir(),approval,commandRunner=run,platform=process.platform,arch=process.arch,fsImpl=fs}={}) {
  const inspected=inspectMacosRunnerBootstrap({state,home,commandRunner,platform,arch,fsImpl,requireApproval:false});
  if(inspected.action_id!=="macos_runner_package_approval"||!HASH.test(String(approval||""))||inspected.approval_challenge!==approval) return {status:"ERROR",error_id:"MACOS-RUNNER-APPROVAL-CHALLENGE",mutations_performed:false,details:"The exact independently inspected package approval challenge must be supplied by the human user.",inspection:inspected};
  const request=macosRunnerApprovalRequest({state,home});
  const receipt={...inspected.approval_candidate,approved_action:"use-existing-official-macos-arm64-runner",approved_by:state.github_login,approval_id:`human-${approval}`,approved_at:new Date().toISOString()};
  let fd,written=false;
  try {
    checkPath(path.dirname(request.receipt_path),{home,directory:true,fsImpl});
    fd=fsImpl.openSync(request.receipt_path,"wx",0o600); written=true;
    fsImpl.writeFileSync(fd,JSON.stringify(receipt,null,2)+"\n"); fsImpl.fsyncSync(fd); fsImpl.closeSync(fd); fd=undefined;
    const dir=fsImpl.openSync(path.dirname(request.receipt_path),"r"); try { fsImpl.fsyncSync(dir); } finally { fsImpl.closeSync(dir); }
    const verified=inspectMacosRunnerBootstrap({state,home,commandRunner,platform,arch,fsImpl});
    return {...verified,mutations_performed:true,receipt_path:request.receipt_path};
  } catch(error) {
    if(fd!==undefined) try { fsImpl.closeSync(fd); } catch {}
    return {status:"ERROR",error_id:"MACOS-RUNNER-APPROVAL-PERSIST",mutations_performed:written?"UNKNOWN":false,details:String(error.message||error),recovery_status:"PRESERVE_RECEIPT_AND_REINSPECT"};
  }
}
