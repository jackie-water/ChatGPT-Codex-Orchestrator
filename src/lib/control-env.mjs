import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {spawnSafeSync} from "./spawn-safe.mjs";
import {detectProjectProfile} from "./project-detect.mjs";
import {assertSafeRuntimePath,prepareControlRuntimeFiles,writeControlRuntimeFiles} from "./control-runtime-bundle.mjs";
import {
  defaultLocalPaths,
  projectEntry,
  renderProjectsRegistry,
  renderConfigPs1,
  renderWorkflow,
  safeKey,
  canonicalInstallationId,
  MACOS_PRIVATE_CONTROL_LAYOUT_V2
} from "./control-render.mjs";
import { trustedCodeReviewCodexExecutable } from "./macos-code-review-runtime.mjs";

function run(command,args,{cwd,allowFailure=false,env}={}){
  const r=spawnSafeSync(command,args,{cwd,encoding:"utf8",...(process.platform==="darwin"&&command==="gh"?{env:{...process.env,GH_HOST:"github.com",...env}}:env?{env}:{})});
  if(r.status!==0&&!allowFailure){
    throw new Error((r.stderr||r.stdout||command+" failed").trim());
  }
  return {ok:r.status===0,stdout:(r.stdout||"").trim(),stderr:(r.stderr||"").trim(),status:r.status};
}

export function githubLogin(){
  const r=run("gh",["api","user","--jq",".login",...(process.platform==="darwin"?["--hostname","github.com"]:[])]);
  if(!/^[A-Za-z0-9-]+$/.test(r.stdout)) throw new Error("Could not determine GitHub login");
  return r.stdout;
}

export function repositoryInfo(repository){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid repository");
  const r=run("gh",["repo","view",repository,"--json","nameWithOwner,defaultBranchRef,visibility,description"]);
  return JSON.parse(r.stdout);
}

function ensureOwnedPrivateRepo({fullName,installationId,purpose}){
  const marker="ChatGPT Codex Orchestrator "+purpose+" installation "+installationId;
  const view=run("gh",["repo","view",fullName,"--json","nameWithOwner,visibility,description"],{allowFailure:true});
  if(!view.ok){
    run("gh",["repo","create",fullName,"--private","--description",marker]);
    return {created:true,marker};
  }

  const existing=JSON.parse(view.stdout);
  if(String(existing.visibility).toUpperCase()!=="PRIVATE"){
    throw new Error("Refusing to use an existing non-private "+purpose+" repository");
  }
  if(!String(existing.description||"").includes(installationId)){
    throw new Error("A repository with the generated "+purpose+" name already exists and does not belong to this installation");
  }
  return {created:false,marker};
}

// Query immutable identities independently of installer answers and checkout
// metadata. This is deliberately read-only and cannot grant connector access.
export function verifyMacosGeneratedRepositories({state,commandRunner=run}){
  const login=String(state.github_login||"");
  const short=canonicalInstallationId(state.installation_id);
  if(!state.installation_id||!short||!/^[A-Za-z0-9-]+$/.test(login)) throw new Error("Exact macOS installation and GitHub owner are required");
  const json=args=>{const r=commandRunner("gh",[...args,"--hostname","github.com"]);if(!r.ok)throw new Error("Independent GitHub identity query failed");return JSON.parse(r.stdout);};
  const user=json(["api","user"]);
  const validId=id=>/^[1-9]\d*$/.test(String(id||""))&&Number.isSafeInteger(Number(id));
  if(user.login!==login||!validId(user.id)) throw new Error("Authenticated GitHub immutable owner identity changed");
  if(state.github_owner_id!==undefined&&String(state.github_owner_id)!==String(user.id)) throw new Error("Persisted immutable GitHub owner identity changed");
  const ids={};
  for(const role of ["control","sandbox"]){
    const repository=`${login}/chatgpt-codex-orchestrator-${role}-${short}`;
    if(state[`${role}_repository`]!==repository) throw new Error("Generated repository name does not match this installation");
    const remote=json(["api",`repos/${repository}`]);
    if(remote.full_name!==repository||remote.name!==repository.split("/")[1]||remote.private!==true||remote.owner?.login!==login||String(remote.owner?.id)!==String(user.id)||!validId(remote.id)||remote.description!==`ChatGPT Codex Orchestrator ${role} installation ${state.installation_id}`) throw new Error("Generated private repository owner, role, or immutable identity is contradictory");
    if(state[`${role}_repository_id`]!==undefined&&String(state[`${role}_repository_id`])!==String(remote.id)) throw new Error("Generated repository immutable ID changed");
    ids[`${role}_repository_id`]=String(remote.id);
  }
  if(ids.control_repository_id===ids.sandbox_repository_id) throw new Error("Control and Sandbox trust domains must be distinct");
  return {...ids,github_owner_id:String(user.id)};
}

// Avoid `git status`/`git diff`: even with --no-optional-locks they can
// execute core.fsmonitor and filter.*.clean from a Control checkout's config.
// The plumbing commands below enumerate only object/index/path identities;
// actual worktree bytes are hashed by Node, WITHOUT invoking Git filters.
// Unknown formats, missing files, staged changes and unsafe symlinks fail closed.
function inspectControlCleanTreeWithoutGitExtensions({control,fsImpl,gitRunner,requireControlIdentity=true}){
  const gitRead=args=>{
    const r=gitRunner("git",[
      "--no-optional-locks","-c","core.fsmonitor=false",
      "-c","core.untrackedCache=false",...args
    ],{cwd:control,allowFailure:true});
    if(!r?.ok||typeof r.stdout!=="string"||r.stdout.length>2_000_000||
        r.stdout.includes("\ufffd")) throw new Error("Git read-only identity unavailable");
    return r.stdout;
  };
  const records=(raw,kind)=>{
    if(!raw)return [];
    if(!raw.endsWith("\0"))throw new Error("Unterminated Git record");
    const values=raw.slice(0,-1).split("\0");
    if(values.length>10000)throw new Error("Unbounded Git index");
    return values.map(value=>{
      const delimiter=value.indexOf("\t");
      if(delimiter<0)throw new Error("Malformed Git record");
      const header=value.slice(0,delimiter),file=value.slice(delimiter+1);
      const match=kind==="tree"
        ? /^(100644|100755|120000) blob ([0-9a-f]{40})$/.exec(header)
        : /^(100644|100755|120000) ([0-9a-f]{40}) 0$/.exec(header);
      if(!match||!file||path.posix.isAbsolute(file)||file.split("/").some(p=>
          !p||p==="."||p===".."||p===".git")) throw new Error("Unsafe Git index entry");
      return {file,mode:match[1],blob:match[2]};
    });
  };
  try{
    const head=records(gitRead(["ls-tree","-r","-z","HEAD"]),"tree");
    const index=records(gitRead(["ls-files","--stage","-z"]),"index");
    // `--others --exclude-standard` follows ordinary Git untracked semantics
    // but never invokes a clean/smudge/diff/filter executable.
    if(gitRead(["ls-files","--others","--exclude-standard","-z"]))
      return {ok:false,reason:"existing_control_dirty"};
    const indexed=new Map(index.map(x=>[x.file,x]));
    // The authority-bearing identity file itself must be part of the
    // committed checkout; an ignored, locally planted marker is not enough.
    if(requireControlIdentity&&(!indexed.has("instance.json")||!head.some(x=>x.file==="instance.json")))
      return {ok:false,reason:"existing_control_git_unverified"};
    if(indexed.size!==index.length||head.length!==index.length)
      return {ok:false,reason:"existing_control_dirty"};
    let totalBytes=0;
    for(const tracked of head){
      const entry=indexed.get(tracked.file);
      if(!entry||entry.mode!==tracked.mode||entry.blob!==tracked.blob)
        return {ok:false,reason:"existing_control_dirty"};
      let current=control,stat;
      const parts=tracked.file.split("/");
      for(let i=0;i<parts.length;i++){
        current=path.join(current,parts[i]);
        stat=fsImpl.lstatSync(current);
        if(i<parts.length-1&&(stat.isSymbolicLink()||!stat.isDirectory()))
          throw new Error("Unsafe tracked path component");
      }
      const isLink=entry.mode==="120000";
      if(isLink?!stat.isSymbolicLink():(!stat.isFile()||stat.isSymbolicLink()))
        return {ok:false,reason:"existing_control_dirty"};
      if(!isLink&&Boolean(stat.mode&0o111)!==(entry.mode==="100755"))
        return {ok:false,reason:"existing_control_dirty"};
      if(stat.size>8*1024*1024||totalBytes+stat.size>64*1024*1024)
        throw new Error("Unbounded tracked file");
      let bytes=isLink?fsImpl.readlinkSync(current,{encoding:"buffer"}):fsImpl.readFileSync(current);
      if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
      totalBytes+=bytes.length;
      if(crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")!==entry.blob)
        return {ok:false,reason:"existing_control_dirty"};
    }
    return {ok:true};
  }catch{return {ok:false,reason:"existing_control_git_unverified"};}
}

// A pre-existing Control checkout is authority-bearing state, not merely a
// directory with acceptable mode bits. Check its saved installation identity,
// local Git origin, and clean worktree BEFORE touching target/Sandbox repos.
// These bounded reads never clone, fetch, chmod, or create a repository.
function inspectMacosControlCheckoutReadOnly({control,installationId,macosControlLayout,expectedGithubLogin,fsImpl=fs,gitRunner=run}){
  let names;
  try{names=fsImpl.readdirSync(control);}catch{return {ok:false,reason:"existing_control_unreadable"};}
  if(names.length===0) return {ok:true,empty:true};
  if(!names.includes("instance.json")||!names.includes(".git")) return {ok:false,reason:"existing_control_unbound"};
  const uid=typeof process.getuid==="function"?process.getuid():null;
  const owned=st=>uid===null||st.uid===uid;
  const gitDir=path.join(control,".git"),gitConfig=path.join(gitDir,"config"),metadataFile=path.join(control,"instance.json");
  let metadataStat,gitStat,configStat;
  try{
    metadataStat=fsImpl.lstatSync(metadataFile);
    gitStat=fsImpl.lstatSync(gitDir);
    configStat=fsImpl.lstatSync(gitConfig);
  }catch{return {ok:false,reason:"existing_control_identity_unreadable"};}
  if(!metadataStat.isFile()||metadataStat.isSymbolicLink()||!owned(metadataStat)||metadataStat.nlink!==1||
      (metadataStat.mode&0o077)!==0||metadataStat.size>65536||
      !gitStat.isDirectory()||gitStat.isSymbolicLink()||!owned(gitStat)||(gitStat.mode&0o022)!==0||
      !configStat.isFile()||configStat.isSymbolicLink()||!owned(configStat)||configStat.nlink!==1||
      (configStat.mode&0o022)!==0||configStat.size>65536)
    return {ok:false,reason:"existing_control_identity_unsafe"};
  let metadata;
  try{metadata=JSON.parse(fsImpl.readFileSync(metadataFile,"utf8"));}
  catch{return {ok:false,reason:"existing_control_metadata_invalid"};}
  const short=canonicalInstallationId(installationId);
  const login=String(expectedGithubLogin||metadata?.trusted_github_username||"");
  const repo=`${login}/chatgpt-codex-orchestrator-control-${short}`;
  const sandbox=`${login}/chatgpt-codex-orchestrator-sandbox-${short}`;
  if(!metadata||typeof metadata!=="object"||Array.isArray(metadata)||
     !/^[A-Za-z0-9-]+$/.test(login)||metadata.trusted_github_username!==login||
     metadata.installation_id!==installationId||metadata.instance_id!==short||
     metadata.role!=="control"||metadata.platform!=="darwin"||
     metadata.control_repository!==repo||metadata.sandbox_repository!==sandbox||
     normalizedGithubRepository(metadata.origin)!==repo.toLowerCase()||
     normalizedGithubRepository(metadata.remote_origin)!==repo.toLowerCase()||
     (macosControlLayout===MACOS_PRIVATE_CONTROL_LAYOUT_V2
        ? metadata.macos_control_layout!==MACOS_PRIVATE_CONTROL_LAYOUT_V2
        : metadata.macos_control_layout!==undefined&&metadata.macos_control_layout!==null))
    return {ok:false,reason:"existing_control_metadata_mismatch"};
  // A remote URL query does not fetch. Dirty-state inspection must not run
  // status/diff or any attribute/config-driven executable Git extension.
  try{
    const origin=gitRunner("git",["--no-optional-locks","remote","get-url","origin"],{cwd:control,allowFailure:true});
    if(!origin?.ok||normalizedGithubRepository(origin.stdout)!==repo.toLowerCase())
      return {ok:false,reason:"existing_control_foreign_origin"};
    const clean=inspectControlCleanTreeWithoutGitExtensions({control,fsImpl,gitRunner});
    if(!clean.ok)return clean;
  }catch{return {ok:false,reason:"existing_control_git_unverified"};}
  return {ok:true,empty:false};
}

// Read-only inventory before the first filesystem mutation. Inspect all five
// canonical preparation paths, rather than hiding later blockers behind the
// first unsafe ancestor. Names and absolute paths never appear in the report.
// Missing paths are eligible for the ordinary private 0700 mkdir operation;
// pre-existing unsafe paths are NEVER adopted or chmod'ed.
export function auditMacosPrivatePreparationPaths({home,installationId,projectKey,macosControlLayout=null,expectedGithubLogin=null,fsImpl=fs,gitRunner=run}={}){
  const base=path.resolve(home||""),paths=defaultLocalPaths({home:base,installationId,projectKey,platform:"darwin",macosControlLayout});
  const instanceRoot=path.join(base,".chatgpt-codex-orchestrator","instances",canonicalInstallationId(installationId));
  const targets=[
    ["instance_root",instanceRoot],
    ["automation_parent",path.dirname(paths.project)],
    ["control_parent",path.dirname(paths.control)],
    ["control_clone",paths.control],
    ["browser_profile",path.join(instanceRoot,"browser-profile")],
    ["pending_wakes",path.join(instanceRoot,"pending-wakes")]
  ];
  const issues=[],observed=[];
  if(!home||!path.isAbsolute(home)||base!==home){
    return {status:"BLOCKED",issues:[{role:"home",reason:"noncanonical_home"}],observed:[],mutations_performed:false};
  }
  const uid=typeof process.getuid==="function"?process.getuid():null;
  for(const [role,absolute] of targets){
    if(!absolute.startsWith(base+path.sep)||path.resolve(absolute)!==absolute){issues.push({role,reason:"path_escape"});continue;}
    let cursor=path.parse(absolute).root,missing=false;
    const parts=absolute.slice(cursor.length).split(path.sep).filter(Boolean);
    for(const part of parts){
      cursor=path.join(cursor,part);
      if(missing)continue;
      let st;
      try{st=fsImpl.lstatSync(cursor);}catch(e){
        if(e.code==="ENOENT"){missing=true;continue;}
        issues.push({role,reason:"stat_failed"});break;
      }
      const within=cursor===base||cursor.startsWith(base+path.sep);
      const owned=uid===null||st.uid===uid||(!within&&st.uid===0);
      const writable=(st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0&&!within);
      if(st.isSymbolicLink()||!st.isDirectory()||!owned||writable){
        issues.push({role,reason:st.isSymbolicLink()?"symlink":!st.isDirectory()?"not_directory":!owned?"foreign_owner":"unsafe_writable_ancestor"});break;
      }
      const legacyControlLeaf=role==="control_clone"&&macosControlLayout!==MACOS_PRIVATE_CONTROL_LAYOUT_V2;
      if(cursor===absolute&&(st.mode&0o7777)!==0o700&&
          !(legacyControlLeaf&&(st.mode&0o7000)===0&&(st.mode&0o700)===0o700&&(st.mode&0o022)===0)){
        issues.push({role,reason:"existing_leaf_not_private"});break;
      }
    }
    if(role==="control_clone"&&!missing&&!issues.some(x=>x.role===role)){
      const checkout=inspectMacosControlCheckoutReadOnly({control:absolute,installationId,macosControlLayout,expectedGithubLogin,fsImpl,gitRunner});
      if(!checkout.ok) issues.push({role,reason:checkout.reason});
      else if(checkout.empty){
        // An unbound checkout can only be created in a strictly private leaf.
        try{if((fsImpl.lstatSync(absolute).mode&0o7777)!==0o700)issues.push({role,reason:"existing_control_unbound_nonprivate"});}
        catch{issues.push({role,reason:"existing_control_unreadable"});}
      }
    }
    observed.push({role,exists:!missing});
  }
  if(macosControlLayout===MACOS_PRIVATE_CONTROL_LAYOUT_V2){
    // An old canonical Control for the SAME installation ID must not be
    // silently replaced by a new path. A legacy shared parent, however,
    // cannot veto an otherwise isolated fresh namespace.
    const legacy=defaultLocalPaths({home:base,installationId,projectKey,platform:"darwin"}).control;
    try{
      fsImpl.lstatSync(legacy);
      issues.push({role:"legacy_control_clone",reason:"existing_v1_binding_requires_separate_migration"});
    }catch(e){if(e.code!=="ENOENT")issues.push({role:"legacy_control_clone",reason:"identity_unavailable"});}
  }
  return {status:issues.length?"BLOCKED":"PASS",issues,observed,mutations_performed:false};
}

function preparePrivateMacDirectory(directory,home,{verifiedLegacyControl=null}={}){
  const absolute=path.resolve(directory),base=path.resolve(home);
  if(absolute!==directory||!absolute.startsWith(base+path.sep)) throw new Error("macOS installation path escapes canonical HOME");
  let cursor=path.parse(absolute).root;
  for(const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    let st;
    try{st=fs.lstatSync(cursor);}catch(error){if(error.code!=="ENOENT")throw error;if(!cursor.startsWith(base+path.sep))throw new Error("Missing HOME ancestor");fs.mkdirSync(cursor,{mode:0o700});st=fs.lstatSync(cursor);}
    const inside=cursor===base||cursor.startsWith(base+path.sep);
    const owned=typeof process.getuid!=="function"||st.uid===process.getuid()||(!inside&&st.uid===0);
    const writable=(st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0&&!inside);
    const legacyLeaf=cursor===absolute&&directory===verifiedLegacyControl&&
      (st.mode&0o7000)===0&&(st.mode&0o700)===0o700&&(st.mode&0o022)===0;
    if(st.isSymbolicLink()||!st.isDirectory()||!owned||writable||
        (cursor===absolute&&(st.mode&0o077)!==0&&!legacyLeaf))
      throw new Error("Unsafe macOS private installation path; no permission repair or adoption is allowed");
  }
}

// G3-RV-05: trusted single-user does not imply that repository Git extensions
// may execute during official setup. These settings propagate to Git launched
// by `gh repo clone` as well as our direct Git child. The *only* approved
// external credential process is the installed `gh auth git-credential`.
// Do not inherit user-supplied GIT_CONFIG_*, templates, SSH/proxy commands,
// repo-local filters, executable hooks or global Git attributes.
const MACOS_G3_GIT_SETTINGS=[
  ["core.hooksPath","/dev/null"],
  ["core.fsmonitor","false"],
  ["core.untrackedCache","false"],
  ["core.attributesFile","/dev/null"],
  ["commit.gpgsign","false"],
  ["tag.gpgsign","false"],
  ["protocol.allow","never"],
  ["protocol.https.allow","always"],
  ["protocol.file.allow","never"],
  ["protocol.ssh.allow","never"],
  ["credential.helper",""],
  ["credential.helper","!gh auth git-credential"],
  ["gc.auto","0"],
  ["maintenance.auto","false"],
  ["fetch.writeCommitGraph","false"]
];
function macosG3GitEnvironment(){
  const env={...process.env};
  for(const key of Object.keys(env)){
    if(key.startsWith("GIT_")||key==="SSH_ASKPASS"||key==="SSH_COMMAND")delete env[key];
  }
  Object.assign(env,{
    GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_SYSTEM:"/dev/null",
    GIT_CONFIG_GLOBAL:"/dev/null",GIT_TEMPLATE_DIR:"/dev/null",
    GIT_TERMINAL_PROMPT:"0",GIT_ALLOW_PROTOCOL:"https",
    GIT_CONFIG_COUNT:String(MACOS_G3_GIT_SETTINGS.length)
  });
  MACOS_G3_GIT_SETTINGS.forEach(([key,value],i)=>{
    env[`GIT_CONFIG_KEY_${i}`]=key;
    env[`GIT_CONFIG_VALUE_${i}`]=value;
  });
  return env;
}
function runG3Git(args,options={}){
  if(process.platform!=="darwin")return run("git",args,options);
  return run("git",["--no-optional-locks",...args],{...options,env:macosG3GitEnvironment()});
}
function safeG3CloneCommand(repository,target){
  if(process.platform!=="darwin")return run("gh",["repo","clone",repository,target]);
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:invalid_clone_repository");
  // Use the *same* bounded Git child and authenticated HTTPS protocol as
  // staging/commit/push. `gh repo clone` would add another uninspected Git
  // invocation layer whose local hook/filter settings cannot be pinned.
  return runG3Git(["clone","--no-recurse-submodules",`https://github.com/${repository}.git`,target]);
}

// Only a bounded, locally identified GitHub HTTPS clone is eligible for G3.
// Reject rather than execute repo-local extension and transport configuration.
function assertMacosG3RepositoryPolicy(target,expectedRepository){
  if(process.platform!=="darwin")return;
  const gitPath=path.join(target,".git"),configPath=path.join(gitPath,"config");
  let gitStat,configStat,config;
  try{
    gitStat=fs.lstatSync(gitPath);
    configStat=fs.lstatSync(configPath);
    if(!gitStat.isDirectory()||gitStat.isSymbolicLink()||
       !configStat.isFile()||configStat.isSymbolicLink()||configStat.nlink!==1||configStat.size>65536||
       (typeof process.getuid==="function"&&(gitStat.uid!==process.getuid()||configStat.uid!==process.getuid()))||
       (gitStat.mode&0o022)!==0||(configStat.mode&0o022)!==0)
      throw new Error("unsafe Git metadata");
    config=fs.readFileSync(configPath,"utf8");
  }catch{throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:unverified_git_directory");}
  let section="",subsection="",origin=null,pushUrl=null;
  for(const sourceLine of config.split(/\r?\n/)){
    const line=sourceLine.trim();
    if(!line||line.startsWith("#")||line.startsWith(";"))continue;
    if(line.startsWith("[")){
      const match=/^\[([a-zA-Z][\w-]*)(?:\s+"([^"]+)")?\]$/.exec(line);
      if(!match)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:config_format");
      section=match[1].toLowerCase();subsection=(match[2]||"").toLowerCase();
      if(!["core","remote","branch","user","init","gc","fetch","pack"].includes(section))
        throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:config_extension");
      if(section==="remote"&&subsection!=="origin")throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:unexpected_remote");
      continue;
    }
    const kv=/^([a-zA-Z][\w-]*)\s*=\s*(.*)$/.exec(line);
    if(!kv||!section)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:config_format");
    const key=kv[1].toLowerCase(),value=kv[2].trim();
    if(section==="core"){
      const safe=new Set(["repositoryformatversion","filemode","bare","logallrefupdates",
        "ignorecase","precomposeunicode","protecthfs","protectntfs","symlinks",
        "quotepath","autocrlf","eol","trustctime","fsmonitor"]);
      if(!safe.has(key)||(key==="fsmonitor"&&value.toLowerCase()!=="false"))
        throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:core_extension");
    }
    if(section==="branch"&&!["remote","merge","rebase","description"].includes(key))
      throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:branch_extension");
    if(section==="remote"){
      if(key==="url"){if(origin!==null)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:multiple_origins");origin=value;}
      else if(key==="pushurl"){if(pushUrl!==null)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:multiple_push_urls");pushUrl=value;}
      else if(!["fetch","promisor","partialclonefilter"].includes(key))throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:remote_extension");
    }
  }
  const https=`https://github.com/${expectedRepository}.git`.toLowerCase();
  const normalized=url=>String(url||"").replace(/\/$/,"").toLowerCase().replace(/\.git$/,"");
  if(normalized(origin)!==normalized(https)||(pushUrl!==null&&normalized(pushUrl)!==normalized(https)))
    throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:foreign_or_executable_remote");
  const hooksPath=path.join(gitPath,"hooks");
  try{
    const st=fs.lstatSync(hooksPath);
    if(!st.isDirectory()||st.isSymbolicLink())throw new Error("unsafe hooks");
    for(const name of fs.readdirSync(hooksPath)){
      const hook=fs.lstatSync(path.join(hooksPath,name));
      if(hook.isSymbolicLink()||!hook.isFile()||(hook.mode&0o111)!==0&&!name.endsWith(".sample"))
        throw new Error("executable hooks");
    }
  }catch(e){if(e.code!=="ENOENT")throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:git_hooks");}
  const checkAttributes=file=>{
    try{
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||
         /(^|\s)(?:filter|diff|merge|working-tree-encoding)\s*(?:=|-|\b)/im.test(fs.readFileSync(file,"utf8")))
        throw new Error("executable attributes");
    }catch(e){if(e.code!=="ENOENT")throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:attributes");}
  };
  checkAttributes(path.join(gitPath,"info","attributes"));
  // Attribute files in all checked-out subdirectories can enable filters.
  let inspectedPaths=0;
  const walk=(directory,depth=0)=>{
    if(++inspectedPaths>20000)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:unbounded_attributes");
    if(depth>20)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:unbounded_attributes");
    for(const name of fs.readdirSync(directory)){
      if(name===".git")continue;
      if(++inspectedPaths>20000)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:unbounded_attributes");
      const item=path.join(directory,name),st=fs.lstatSync(item);
      if(name===".gitattributes")checkAttributes(item);
      if(st.isDirectory()&&!st.isSymbolicLink())walk(item,depth+1);
    }
  };
  try{walk(target);}catch(e){if(String(e.message).startsWith("MACOS-G3-"))throw e;throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:unreadable_attributes");}
}
function macosG3CloneClean(target,purpose){
  const clean=inspectControlCleanTreeWithoutGitExtensions({control:target,fsImpl:fs,
    gitRunner:(command,args,options)=>runG3Git(args,options),requireControlIdentity:false});
  if(clean.ok)return;
  // A freshly created, unborn private Sandbox/Control Git repository can be
  // empty, with no HEAD/index. A nonempty or dirty unborn repo is not eligible.
  if((purpose==="Sandbox"||purpose==="Control"||purpose==="Fresh")&&
     fs.readdirSync(target).every(x=>x===".git")&&
     !runG3Git(["rev-parse","--verify","HEAD"],{cwd:target,allowFailure:true}).ok&&
     runG3Git(["ls-files","--stage"],{cwd:target}).stdout==="")return;
  throw new Error(`${purpose} clone contains dirty, unsafe or unverifiable Git state; refusing to fetch or overwrite it`);
}
export function preflightMacosG3ExistingClones({targetPath,targetRepository,sandboxPath,sandboxRepository,controlPath,controlRepository}){
  if(process.platform!=="darwin")return;
  for(const [directory,purpose,repository] of [
    [targetPath,"Target",targetRepository],
    [sandboxPath,"Sandbox",sandboxRepository],
    [controlPath,"Control",controlRepository]
  ])inspectExistingClone(directory,purpose,repository);
}

function ensureClone(repository,target){
  if(fs.existsSync(path.join(target,".git"))){
    const origin=runG3Git(["remote","get-url","origin"],{cwd:target}).stdout;
    if(process.platform==="darwin"?normalizedGithubRepository(origin)!==repository.toLowerCase():!origin.toLowerCase().includes(repository.toLowerCase())) throw new Error("Existing local folder points to a different Git repository");
    runG3Git(["fetch","origin","--prune"],{cwd:target});
    return;
  }
  if(fs.existsSync(target)&&fs.readdirSync(target).length>0) throw new Error("Target clone directory already exists and is not empty");
  fs.mkdirSync(path.dirname(target),{recursive:true});
  safeG3CloneCommand(repository,target);
  if(process.platform==="darwin")inspectExistingClone(target,"Fresh",repository);
}

function inspectExistingClone(target,purpose,expectedRepository=null){
  if(!fs.existsSync(target)) return;
  const st=fs.lstatSync(target);
  if(st.isSymbolicLink() || !st.isDirectory() || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw new Error(`${purpose} clone directory is symlinked, foreign-owned, or not a directory`);
  const git=path.join(target,".git");
  if(fs.existsSync(git)) {
    const gs=fs.lstatSync(git);
    if(gs.isSymbolicLink() || (typeof process.getuid === "function" && gs.uid !== process.getuid())) throw new Error(`${purpose} clone Git directory is symlinked or foreign-owned`);
    if(process.platform==="darwin"){
      if(!expectedRepository)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:unbound_repository");
      assertMacosG3RepositoryPolicy(target,expectedRepository);
      macosG3CloneClean(target,purpose);
    }else{
      const status=run("git",["status","--porcelain","--untracked-files=all"],{cwd:target}).stdout;
      if(status) throw new Error(`${purpose} clone contains dirty or untracked state; refusing to fetch or overwrite it`);
    }
  } else if(fs.readdirSync(target).length) throw new Error(`${purpose} clone directory is not an empty Git checkout`);
}

function requireCleanOwnedClone(target, purpose){
  if(!fs.existsSync(path.join(target,".git"))) return;
  const status=run("git",["status","--porcelain","--untracked-files=all"],{cwd:target}).stdout;
  if(status) throw new Error(`${purpose} clone contains dirty or untracked state; refusing to overwrite it`);
}

function commitAndPush({repoPath,message,branch="main",expectedRepository=null}){
  if(process.platform==="darwin"){
    if(!expectedRepository)throw new Error("MACOS-G3-GIT-EXTENSION-BLOCKED:unbound_commit");
    assertMacosG3RepositoryPolicy(repoPath,expectedRepository);
  }
  runG3Git(["add","-A"],{cwd:repoPath});
  const diff=runG3Git(process.platform==="darwin"
    ?["diff","--no-ext-diff","--no-textconv","--cached","--quiet"]
    :["diff","--cached","--quiet"],{cwd:repoPath,allowFailure:true});
  if(diff.ok) return {changed:false};
  if(process.platform==="darwin"&&diff.status!==1)throw new Error("Git staged comparison failed; refusing to commit or push");
  runG3Git([
    "-c","user.name=ChatGPT Codex Orchestrator",
    "-c","user.email=codex-orchestrator@users.noreply.github.com",
    "commit","-m",message
  ],{cwd:repoPath});
  runG3Git(["push","-u","origin","HEAD:"+branch],{cwd:repoPath});
  return {changed:true};
}

function seedSandbox({repoPath,installationId,expectedRepository=null}){
  const marker=path.join(repoPath,".orchestrator-sandbox");
  if(fs.existsSync(marker)){
    const value=fs.readFileSync(marker,"utf8").trim();
    if(value!==installationId) throw new Error("Existing sandbox marker belongs to a different installation");
    return {changed:false};
  }

  if(fs.readdirSync(repoPath).filter(x=>x!==".git").length>0){
    throw new Error("Generated sandbox repository is not empty and has no matching installation marker");
  }

  fs.mkdirSync(path.join(repoPath,"src"),{recursive:true});
  fs.mkdirSync(path.join(repoPath,"test"),{recursive:true});
  fs.writeFileSync(marker,installationId+"\n");
  fs.writeFileSync(path.join(repoPath,"README.md"),[
    "# ChatGPT Codex Orchestrator Sandbox",
    "",
    "This private repository exists only for installation and end-to-end safety tests.",
    "It is not a production application repository.",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(repoPath,"package.json"),JSON.stringify({
    name:"chatgpt-codex-orchestrator-sandbox",
    version:"1.0.0",
    private:true,
    type:"module",
    engines:{node:">=22"},
    scripts:{test:"node --test"}
  },null,2)+"\n");
  fs.writeFileSync(path.join(repoPath,"src","status.mjs"),'export const status = "not-ready";\n');
  fs.writeFileSync(path.join(repoPath,"test","status.test.mjs"),[
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import {status} from "../src/status.mjs";',
    "",
    'test("sandbox starts in not-ready state",()=>{',
    '  assert.equal(status,"not-ready");',
    "});",
    ""
  ].join("\n"));

  return commitAndPush({
    repoPath,
    message:"chore: initialize isolated orchestrator sandbox",
    branch:"main",expectedRepository
  });
}

function commitControlRepo(controlPath,expectedRepository=null){
  return commitAndPush({
    repoPath:controlPath,
    message:"chore: configure private orchestrator control plane",
    branch:"main",expectedRepository
  });
}

export function activateTargetProject({controlClonePath,projectKey,repository}){
  if(!controlClonePath||!projectKey||!repository) throw new Error("Target activation requires control clone, project key and repository");
  const registryPath=path.join(controlClonePath,"projects.json");
  if(!fs.existsSync(registryPath)) throw new Error("Control project registry is missing");

  const registry=JSON.parse(fs.readFileSync(registryPath,"utf8"));
  const project=registry?.projects?.[projectKey];
  if(!project) throw new Error("Target project is missing from the control registry");
  if(project.repository!==repository) throw new Error("Target activation repository does not match registry");

  if(project.enabled===true) return {changed:false,already_enabled:true};

  project.enabled=true;
  fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+"\n");
  const commit=commitAndPush({
    repoPath:controlClonePath,
    message:"chore: activate verified application project",
    branch:"main"
  });
  return {changed:commit.changed,already_enabled:false};
}

const RETIRED_ROUTING_SCRIPTS=[
  "capture-chat-origins.mjs",
  "chat-routing.ps1",
  "dispatch-chat-callback.ps1",
  "origin-router-loop.ps1"
];

function stopRetiredOriginRouter(controlPath){
  if(process.platform!=="win32") return {stopped:0};
  const needle=path.join(controlPath,"scripts","origin-router-loop.ps1").toLowerCase();
  const ps=[
    "$needle=$env:ORCH_RETIRED_ROUTER_NEEDLE",
    "$matches=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) })",
    "$count=0",
    "foreach($p in $matches){ try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $count++ } catch {} }",
    "Write-Output $count"
  ].join("; ");
  const r=spawnSafeSync("powershell.exe",["-NoProfile","-Command",ps],{
    encoding:"utf8",
    env:{...process.env,ORCH_RETIRED_ROUTER_NEEDLE:needle}
  });
  return {stopped:r.status===0?Number((r.stdout||"0").trim())||0:0};
}

function installationShortId(value){
  return canonicalInstallationId(value);
}

function browserPortForInstallation(shortId){
  const hex=String(shortId||"").replace(/[^0-9a-f]/gi,"").slice(0,6);
  const n=Number.parseInt(hex||"0",16);
  return 10000+(Number.isFinite(n)?n%40000:0);
}

function requireRuntimePlatform(platform,arch){
  if((platform==="darwin"&&(arch==="arm64"||arch==="x64"))||(platform==="win32"&&arch==="x64")) return;
  throw new Error("Instance platform or architecture is missing or unsupported for runtime refresh");
}

function pinCodexExecutable(platform,execute=run){
  if(platform!=="darwin") return null;
  const found=execute("which",["codex"],{allowFailure:true}).stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(found.length!==1||!path.isAbsolute(found[0])) throw new Error("Installed macOS Codex executable could not be pinned");
  try {
    const pinned=fs.realpathSync(found[0]);
    return trustedCodeReviewCodexExecutable(pinned);
  } catch { throw new Error("Installed macOS Codex executable could not be pinned"); }
}

function writeInstanceMetadata(controlPath,{instanceId,installationId,trustedGithubUsername,launchAgentLabel,runnerLabel,controlRepository,sandboxRepository,codexExecutable,macosBindings={},platform=process.platform,arch=process.arch}){
  requireRuntimePlatform(platform,arch);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(instanceId)) throw new Error("Invalid instance id");
  if(!/^[A-Za-z0-9-]+$/.test(String(trustedGithubUsername||""))) throw new Error("Invalid trusted GitHub login");
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(runnerLabel||""))) throw new Error("Invalid runner identity");
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(controlRepository||""))) throw new Error("Invalid Control repository identity");
  if(launchAgentLabel!==undefined&&launchAgentLabel!==null&&!/^com\.chatgpt\.codex\.[A-Za-z0-9-]+$/.test(launchAgentLabel)) throw new Error("Invalid LaunchAgent label");
  if(platform==="darwin"&&(!codexExecutable||!path.isAbsolute(codexExecutable))) throw new Error("Pinned macOS Codex executable is missing");
  assertSafeRuntimePath(path.join(controlPath,"instance.json"),{allowMissing:true,type:"file"});
  const metadataPath=path.join(controlPath,"instance.json");
  const metadata=JSON.stringify({
    schema_version:1,
    instance_id:instanceId,
    ...(platform==="darwin"?{installation_id:installationId}:{}),
    platform,
    arch,
    runner_label:runnerLabel,
    control_repository:controlRepository,
    ...(platform==="darwin"?{sandbox_repository:sandboxRepository,role:"control",origin:`https://github.com/${controlRepository}.git`,remote_origin:`https://github.com/${controlRepository}.git`}:{}),
    trusted_github_username:trustedGithubUsername,
    launch_agent_label:launchAgentLabel||null,
    ...(platform==="darwin"?{codex_executable:codexExecutable,...macosBindings}: {})
  },null,2)+"\n";
  if(platform==="darwin") {
    const temporary=`${metadataPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const fd=fs.openSync(temporary,"wx",0o600);
    try { fs.writeFileSync(fd,metadata); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary,metadataPath);
    fs.chmodSync(metadataPath,0o600);
  } else {
    fs.writeFileSync(metadataPath,metadata);
  }
}

function requireMacosRegistrationMetadata(metadata,state){
  // Refresh publishes the strict registrar but does not migrate its authority.
  // Old C2 metadata has the earlier runner identity without these instance,
  // browser, outbox and immutable repository pins. Refuse it while read-only.
  const instanceRoot=path.join(os.homedir(),".chatgpt-codex-orchestrator","instances",state.instance_id);
  const layout=state.macos_control_layout??null;
  if(layout!==null&&layout!==MACOS_PRIVATE_CONTROL_LAYOUT_V2) throw new Error("MACOS-CONTROL-LAYOUT-UNSUPPORTED");
  if((metadata.macos_control_layout??null)!==layout) throw new Error("MACOS-CONTROL-LAYOUT-MISMATCH");
  const canonicalControl=defaultLocalPaths({home:os.homedir(),installationId:state.installation_id,
    projectKey:state.sandbox_project_key||"__unbound-project__",platform:"darwin",macosControlLayout:layout}).control;
  if(layout===MACOS_PRIVATE_CONTROL_LAYOUT_V2&&state.control_clone_path!==canonicalControl) throw new Error("MACOS-CONTROL-LAYOUT-INVALID-PATH");
  const repositoryId=String(metadata.control_repository_id||"");
  if(metadata.arch!=="arm64"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(metadata.installation_id||""))||
    metadata.installation_id!==state.installation_id||metadata.instance_root!==instanceRoot||state.instance_root!==instanceRoot||
    metadata.chat_route_file!==path.join(instanceRoot,"chat-routes.json")||metadata.chat_route_file!==state.chat_route_file||
    metadata.pending_wake_outbox!==path.join(instanceRoot,"pending-wakes")||metadata.pending_wake_outbox!==state.pending_wake_outbox||
    !/^[1-9][0-9]*$/.test(repositoryId)||!Number.isSafeInteger(Number(repositoryId))||repositoryId!==String(state.control_repository_id||"")||
    metadata.browser_profile!==path.join(instanceRoot,"browser-profile")||metadata.browser_profile!==state.browser_profile||
    !Number.isInteger(metadata.browser_port)||metadata.browser_port<1024||metadata.browser_port>65535||metadata.browser_port!==state.browser_port){
    throw new Error("MACOS-CONTROL-MIGRATION-REQUIRED: Existing macOS Control metadata is incompatible with pinned CHAT-REGISTER identity; explicit migration is required before runtime refresh");
  }
}

function runtimeRefreshIdentity(state){
  const {instance_platform:platform,instance_arch:arch}=state;
  requireRuntimePlatform(platform,arch);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(state.instance_id||""))||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(state.runner_label||""))||
    !/^[A-Za-z0-9-]+$/.test(String(state.github_login||""))) throw new Error("Existing instance or trusted runner identity is incomplete for runtime refresh");
  const metadataPath=path.join(state.control_clone_path,"instance.json");
  assertSafeRuntimePath(metadataPath,{type:"file"});
  const metadata=JSON.parse(fs.readFileSync(metadataPath,"utf8"));
  if(platform==="darwin") requireMacosRegistrationMetadata(metadata,state);
  if(metadata.schema_version!==1||metadata.instance_id!==state.instance_id||(platform==="darwin"&&metadata.installation_id!==state.installation_id)||metadata.platform!==platform||metadata.arch!==arch||
    metadata.trusted_github_username!==state.github_login||metadata.runner_label!==state.runner_label||metadata.control_repository!==state.control_repository||
    (platform==="darwin"&&(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(state.sandbox_repository||""))||metadata.sandbox_repository!==state.sandbox_repository||metadata.role!=="control"))) throw new Error("Persisted Control instance identity does not match installation state for runtime refresh");
  if(platform==="darwin"&&(!/^com\.chatgpt\.codex\.[A-Za-z0-9-]+$/.test(String(state.launch_agent_label||""))||metadata.launch_agent_label!==state.launch_agent_label||typeof metadata.codex_executable!=="string"||!path.isAbsolute(metadata.codex_executable))) throw new Error("Existing macOS runtime identity is incomplete or mismatched for runtime refresh");
  if(platform==="win32"&&(metadata.launch_agent_label!==null||state.launch_agent_label!=null)) throw new Error("Persisted Windows instance has an ambiguous LaunchAgent identity");
  if(state.environment?.platform&&state.environment.platform!==platform) throw new Error("Persisted instance platform conflicts with installation environment");
  if(state.environment?.arch&&state.environment.arch!==arch) throw new Error("Persisted instance architecture conflicts with installation environment");
  return {platform,arch,runnerLabel:state.runner_label,trustedGithubUsername:metadata.trusted_github_username,codexExecutable:metadata.codex_executable||null};
}

function upgradeRuntimeIdentity({state,instanceId,commandRunner=run}){
  const platform=state.instance_platform;
  const arch=state.instance_arch;
  requireRuntimePlatform(platform,arch);
  if(platform!==process.platform||arch!==process.arch) throw new Error("Existing instance platform or architecture does not match this host");
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(instanceId)||
    (state.instance_id!==undefined&&state.instance_id!==instanceId)||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(state.runner_label||""))||
    !/^[A-Za-z0-9-]+$/.test(String(state.github_login||""))||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(state.control_repository||""))||
    !state.installation_id||state.runner_owner!==state.installation_id) throw new Error("Existing instance or trusted owner identity is incomplete for upgrade");
  if(state.environment?.platform&&state.environment.platform!==platform) throw new Error("Persisted instance platform conflicts with installation environment");
  if(state.environment?.arch&&state.environment.arch!==arch) throw new Error("Persisted instance architecture conflicts with installation environment");

  assertSafeRuntimePath(state.control_clone_path,{type:"directory"});
  assertSafeRuntimePath(path.join(state.control_clone_path,".git"),{type:"directory"});
  const metadataPath=path.join(state.control_clone_path,"instance.json");
  assertSafeRuntimePath(metadataPath,{type:"file"});
  const metadata=JSON.parse(fs.readFileSync(metadataPath,"utf8"));
  if(metadata.schema_version!==1||metadata.instance_id!==instanceId||(platform==="darwin"&&metadata.installation_id!==state.installation_id)||metadata.platform!==platform||metadata.arch!==arch||
    metadata.trusted_github_username!==state.github_login||metadata.runner_label!==state.runner_label||metadata.control_repository!==state.control_repository||
    (platform==="darwin"&&(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(state.sandbox_repository||""))||metadata.sandbox_repository!==state.sandbox_repository||metadata.role!=="control"))){
    throw new Error("Persisted Control instance identity does not match installation state for upgrade");
  }
  if(platform==="win32"&&(metadata.launch_agent_label!==null||state.launch_agent_label!=null)) throw new Error("Persisted Windows instance has an ambiguous LaunchAgent identity");
  if(platform==="darwin"){
    const layout=state.macos_control_layout??null;
    if((layout!==null&&layout!==MACOS_PRIVATE_CONTROL_LAYOUT_V2)||
       (metadata.macos_control_layout??null)!==layout||
       (layout===MACOS_PRIVATE_CONTROL_LAYOUT_V2&&state.control_clone_path!==defaultLocalPaths({home:os.homedir(),installationId:state.installation_id,
         projectKey:state.sandbox_project_key||"__unbound-project__",platform:"darwin",macosControlLayout:layout}).control))
      throw new Error("MACOS-CONTROL-LAYOUT-MIGRATION-REQUIRED");
    if(!/^com\.chatgpt\.codex\.[A-Za-z0-9-]+$/.test(String(state.launch_agent_label||""))||metadata.launch_agent_label!==state.launch_agent_label) throw new Error("Existing macOS LaunchAgent identity is incomplete or mismatched for upgrade");
    if(Object.hasOwn(metadata,"codex_executable")){
      if(typeof metadata.codex_executable!=="string"||!path.isAbsolute(metadata.codex_executable)) throw new Error("Existing macOS Codex executable pin is invalid");
      try { metadata.codex_executable=trustedCodeReviewCodexExecutable(metadata.codex_executable); }
      catch { throw new Error("Existing macOS Codex executable pin is unsafe"); }
    } else {
      metadata.codex_executable=pinCodexExecutable(platform,commandRunner);
    }
  }
  return {platform,arch,runnerLabel:state.runner_label,trustedGithubUsername:metadata.trusted_github_username,codexExecutable:metadata.codex_executable||null};
}

function prepareRuntimeWorkflow({sourceRoot,controlPath,platform,arch,runnerLabel,trustedGithubUsername}){
  requireRuntimePlatform(platform,arch);
  const templatePath=path.join(sourceRoot,"templates","control-repo",platform==="darwin"?"orchestrator.macos.yml.template":"orchestrator.yml.template");
  assertSafeRuntimePath(templatePath,{type:"file"});
  const workflowPath=path.join(controlPath,".github","workflows","orchestrator.yml");
  assertSafeRuntimePath(workflowPath,{allowMissing:true,type:"file"});
  return {workflowPath,content:renderWorkflow(fs.readFileSync(templatePath,"utf8"),{runnerLabel,platform,arch,trustedGithubUsername})};
}

function retireLegacyGlobalPending({home,instanceRoot}){
  const legacy=path.join(home,".chatgpt-codex-orchestrator","pending-wakes");
  if(!fs.existsSync(legacy)) return {retired:0,destination:null};
  const files=fs.readdirSync(legacy,{withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith(".json"));
  if(!files.length) return {retired:0,destination:null};

  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const destination=path.join(instanceRoot,"retired-pending-wakes","legacy-global-"+stamp);
  fs.mkdirSync(destination,{recursive:true});
  let retired=0;
  for(const file of files){
    fs.renameSync(path.join(legacy,file.name),path.join(destination,file.name));
    retired++;
  }
  return {retired,destination};
}

export function normalizedGithubRepository(remote){
  const match=String(remote||"").trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  return match?.[1].toLowerCase()||null;
}

function refreshControlCommit(controlPath,ownedPaths,execute=run){
  if(!execute("git",["diff","--cached","--quiet"],{cwd:controlPath,allowFailure:true}).ok) throw new Error("Control repository index contains pre-staged unrelated changes");
  const add=ownedPaths.filter(name=>fs.existsSync(path.join(controlPath,name)));
  if(add.length) execute("git",["add","--",...add],{cwd:controlPath});
  const retired=RETIRED_ROUTING_SCRIPTS.map(name=>path.posix.join("scripts",name));
  const trackedRetired=execute("git",["ls-files","--cached","--",...retired],{cwd:controlPath}).stdout.split(/\r?\n/).filter(Boolean);
  if(trackedRetired.length) execute("git",["add","-u","--",...trackedRetired],{cwd:controlPath});
  const staged=execute("git",["diff","--cached","--name-only"],{cwd:controlPath}).stdout.split(/\r?\n/).filter(Boolean);
  if(staged.some(name=>!ownedPaths.includes(name)&&!retired.includes(name))) throw new Error("Runtime refresh staged an unrelated control file");
  if(execute("git",["diff","--cached","--quiet"],{cwd:controlPath,allowFailure:true}).ok) return {changed:false};
  const before=execute("git",["rev-parse","HEAD"],{cwd:controlPath}).stdout;
  execute("git",["-c","user.name=ChatGPT Codex Orchestrator","-c","user.email=codex-orchestrator@users.noreply.github.com","commit","-m","chore: refresh orchestrator runtime"],{cwd:controlPath});
  try { execute("git",["push","origin","HEAD:main"],{cwd:controlPath}); } catch(error) { execute("git",["reset","--mixed",before],{cwd:controlPath}); throw error; }
  return {changed:true};
}

export function removeLegacyDefaultReviewRoutes(registryPath){
  const registry=JSON.parse(fs.readFileSync(registryPath,"utf8"));
  let changed=false;
  for(const project of Object.values(registry.projects||{})){
    if(Object.hasOwn(project,"default_review_route")){
      delete project.default_review_route;
      changed=true;
    }
  }
  if(changed) fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+"\n");
  return {changed};
}

export function upgradeControlEnvironment({state,sourceRoot=process.cwd(),home=os.homedir(),commandRunner=run}){
  if(!state?.control_clone_path||!fs.existsSync(path.join(state.control_clone_path,".git"))){
    throw new Error("Existing control clone is unavailable for upgrade");
  }
  if(!state?.runner_label||!state?.runner_path||!state?.browser_profile||!state?.browser_port){
    throw new Error("Existing installation state is incomplete for upgrade");
  }

  const instanceId=installationShortId(state.installation_id)||path.basename(state.runner_path);
  const identity=upgradeRuntimeIdentity({state,instanceId,commandRunner});
  const runtimeFiles=prepareControlRuntimeFiles({sourceRoot,controlRoot:state.control_clone_path});
  const workflow=prepareRuntimeWorkflow({sourceRoot,controlPath:state.control_clone_path,platform:process.platform,arch:process.arch,runnerLabel:state.runner_label,trustedGithubUsername:state.github_login});
  const stopped=stopRetiredOriginRouter(state.control_clone_path);
  const scriptsDir=path.join(state.control_clone_path,"scripts");
  writeControlRuntimeFiles({controlRoot:state.control_clone_path,files:runtimeFiles});
  for(const name of RETIRED_ROUTING_SCRIPTS){
    fs.rmSync(path.join(scriptsDir,name),{force:true});
  }
  removeLegacyDefaultReviewRoutes(path.join(state.control_clone_path,"projects.json"));

  fs.mkdirSync(path.dirname(workflow.workflowPath),{recursive:true});
  fs.writeFileSync(workflow.workflowPath,workflow.content);

  writeInstanceMetadata(state.control_clone_path,{instanceId,installationId:state.installation_id,trustedGithubUsername:state.github_login,launchAgentLabel:state.launch_agent_label,runnerLabel:state.runner_label,controlRepository:state.control_repository,sandboxRepository:state.sandbox_repository,codexExecutable:identity.codexExecutable});

  const configRoot=path.join(home,".chatgpt-codex-orchestrator");
  const instanceRoot=path.join(configRoot,"instances",instanceId);
  fs.mkdirSync(instanceRoot,{recursive:true});
  const chatRouteFile=path.join(instanceRoot,"chat-routes.json");
  const configPath=path.join(instanceRoot,"config.ps1");
  const configText=renderConfigPs1({
    githubLogin:state.github_login,
    projectMappings:[
      {projectKey:state.project_key,projectClonePath:state.project_clone_path},
      {projectKey:state.sandbox_project_key,projectClonePath:state.sandbox_clone_path}
    ],
    runnerPath:state.runner_path,
    ...(process.platform==="darwin"?{instanceId:`runner-${instanceId}`}:{}),
    browserPort:state.browser_port,
    browserProfile:state.browser_profile,
    chatRouteFile
  });
  fs.writeFileSync(configPath,configText,{mode:0o600});

  const pendingMigration=retireLegacyGlobalPending({home,instanceRoot});
  const commit=commitControlRepo(state.control_clone_path);
  // The CLI's legacy-upgrade caller saves this object but only consumes the
  // historical return fields. Persist the platform of the completed upgrade too.
  state.instance_platform=process.platform;
  state.instance_arch=process.arch;

  return {
    changed:commit.changed,
    instance_id:instanceId,
    instance_platform:process.platform,
    instance_arch:process.arch,
    instance_root:instanceRoot,
    stopped_retired_router_processes:stopped.stopped,
    chat_route_file:chatRouteFile,
    config_path:configPath,
    retired_legacy_pending:pendingMigration.retired,
    retired_legacy_pending_destination:pendingMigration.destination,
    retired_scripts:RETIRED_ROUTING_SCRIPTS
  };
}

export function refreshControlRuntime({state,sourceRoot=process.cwd(),gitRun=run}){
  const repository=String(state?.control_repository||"");
  if(state?.control_environment_ready!==true||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Control environment identity is incomplete for runtime refresh");
  if(!state?.control_clone_path||!fs.existsSync(path.join(state.control_clone_path,".git"))){
    throw new Error("Existing control clone is unavailable for runtime refresh");
  }
  assertSafeRuntimePath(state.control_clone_path,{type:"directory"});
  assertSafeRuntimePath(path.join(state.control_clone_path,".git"),{type:"directory"});
  const earlyIdentity=state.instance_platform==="darwin"?runtimeRefreshIdentity(state):null;
  const fetchUrl=gitRun("git",["config","--get","remote.origin.url"],{cwd:state.control_clone_path}).stdout;
  const pushUrls=gitRun("git",["config","--get-all","remote.origin.pushurl"],{cwd:state.control_clone_path,allowFailure:true}).stdout.split(/\r?\n/).filter(Boolean);
  if(normalizedGithubRepository(fetchUrl)!==repository.toLowerCase()||
    pushUrls.some(url=>normalizedGithubRepository(url)!==repository.toLowerCase())){
    throw new Error("Control clone push destination does not match control repository");
  }
  const topLevel=gitRun("git",["rev-parse","--show-toplevel"],{cwd:state.control_clone_path}).stdout;
  if(!path.isAbsolute(topLevel)||path.resolve(topLevel)!==path.resolve(state.control_clone_path)) throw new Error("Control clone path does not match Git repository root");
  if(gitRun("git",["branch","--show-current"],{cwd:state.control_clone_path}).stdout!=="main") throw new Error("Control clone must be on main for runtime refresh");
  const localHead=gitRun("git",["rev-parse","HEAD"],{cwd:state.control_clone_path}).stdout;
  if(!/^[0-9a-f]{40}$/i.test(localHead)) throw new Error("Control repository HEAD is invalid for runtime refresh");
  const remoteMain=gitRun("git",["ls-remote","--heads","origin","refs/heads/main"],{cwd:state.control_clone_path,allowFailure:true});
  const remoteMatch=remoteMain.stdout.match(/^([0-9a-f]{40})\trefs\/heads\/main$/i);
  if(!remoteMain.ok||!remoteMatch||remoteMatch[1].toLowerCase()!==localHead.toLowerCase()) throw new Error("Control repository local HEAD must match remote main for runtime refresh");
  const identity=earlyIdentity||runtimeRefreshIdentity(state);
  const runtimeFiles=prepareControlRuntimeFiles({sourceRoot,controlRoot:state.control_clone_path});
  const workflow=prepareRuntimeWorkflow({sourceRoot,controlPath:state.control_clone_path,...identity});
  const scriptsDir=path.join(state.control_clone_path,"scripts");
  for(const name of RETIRED_ROUTING_SCRIPTS) assertSafeRuntimePath(path.join(scriptsDir,name),{allowMissing:true,type:"file"});
  if(!gitRun("git",["diff","--cached","--quiet"],{cwd:state.control_clone_path,allowFailure:true}).ok) throw new Error("Control repository index contains pre-staged unrelated changes");

  writeControlRuntimeFiles({controlRoot:state.control_clone_path,files:runtimeFiles});
  for(const name of RETIRED_ROUTING_SCRIPTS) fs.rmSync(path.join(scriptsDir,name),{force:true});

  fs.mkdirSync(path.dirname(workflow.workflowPath),{recursive:true});
  fs.writeFileSync(workflow.workflowPath,workflow.content);

  const ownedPaths=[...runtimeFiles.map(file=>file.path),".github/workflows/orchestrator.yml"];
  return {
    ...refreshControlCommit(state.control_clone_path,ownedPaths,gitRun),
    retired_scripts:RETIRED_ROUTING_SCRIPTS
  };
}

export function prepareControlEnvironment({
  installationId,
  targetRepository,
  reviewerChatUrl,
  trustedGithubLogin,
  macosSetupApproved=false,
  sourceRoot=process.cwd(),
  home=os.homedir(),
  macosControlLayout=null
}){
  if(!installationId) throw new Error("installationId is required");
  if(!/^https:\/\/chatgpt\.com\//i.test(reviewerChatUrl)) throw new Error("Invalid reviewer Chat URL");
  if(process.platform==="darwin"&&(process.arch!=="arm64"||macosSetupApproved!==true)) throw new Error("macOS ARM64 Control preparation requires exact setup approval");

  const login=githubLogin();
  if(trustedGithubLogin && String(trustedGithubLogin)!==login) throw new Error("Authenticated GitHub identity changed; refusing to retarget generated repositories");
  const target=repositoryInfo(targetRepository);
  const projectKey=safeKey(String(targetRepository).split("/").pop());
  const paths=defaultLocalPaths({home,installationId,projectKey,platform:process.platform,macosControlLayout});
  const short=installationShortId(installationId);
  const instanceRoot=path.join(home,".chatgpt-codex-orchestrator","instances",short);
  const browserProfile=process.platform==="win32"
    ? path.join(process.env.LOCALAPPDATA||path.join(home,"AppData","Local"),"ChatGPTCodexOrchestratorReviewer-"+short)
    : path.join(instanceRoot,"browser-profile");
  const browserPort=browserPortForInstallation(short);
  const chatRouteFile=path.join(instanceRoot,"chat-routes.json");
  const pendingWakeOutbox=path.join(instanceRoot,"pending-wakes");
  const sandboxProjectKey="sandbox-"+short;
  const sandboxRepository=login+"/chatgpt-codex-orchestrator-sandbox-"+short;
  const sandboxClonePath=path.join(home,".chatgpt-codex-orchestrator","instances",short,"automation",sandboxProjectKey);
  const controlRepository=login+"/chatgpt-codex-orchestrator-control-"+short;
  if(process.platform==="darwin"){
    const checked=auditMacosPrivatePreparationPaths({home,installationId,projectKey,macosControlLayout,expectedGithubLogin:login});
    if(checked.status!=="PASS") throw new Error("MACOS-PRIVATE-PATH-AUDIT:"+checked.issues.map(x=>x.role+":"+x.reason).join(","));
    preflightMacosG3ExistingClones({targetPath:paths.project,targetRepository,
      sandboxPath:sandboxClonePath,sandboxRepository,controlPath:paths.control,controlRepository});
    const verifiedLegacyControl=macosControlLayout===MACOS_PRIVATE_CONTROL_LAYOUT_V2?null:paths.control;
    for(const directory of [instanceRoot,path.dirname(paths.project),path.dirname(paths.control),paths.control,browserProfile,pendingWakeOutbox])
      preparePrivateMacDirectory(directory,home,{verifiedLegacyControl});
    if(fs.existsSync(paths.control)&&fs.existsSync(path.join(paths.control,"instance.json"))){
      assertSafeRuntimePath(path.join(paths.control,"instance.json"),{type:"file"});
      const prior=JSON.parse(fs.readFileSync(path.join(paths.control,"instance.json"),"utf8"));
      if(prior.installation_id!==installationId||prior.instance_id!==short||prior.role!=="control") throw new Error("Existing Control clone is not this exact approved installation");
    }
  }

  inspectExistingClone(paths.project,"Target",targetRepository);
  ensureClone(targetRepository,paths.project);
  const validationProfile=detectProjectProfile(paths.project);

  ensureOwnedPrivateRepo({fullName:sandboxRepository,installationId,purpose:"sandbox"});
  inspectExistingClone(sandboxClonePath,"Sandbox",sandboxRepository);
  ensureClone(sandboxRepository,sandboxClonePath);
  seedSandbox({repoPath:sandboxClonePath,installationId,expectedRepository:sandboxRepository});
  const sandboxValidationProfile=detectProjectProfile(sandboxClonePath);

  ensureOwnedPrivateRepo({fullName:controlRepository,installationId,purpose:"control"});
  const immutableIdentities=process.platform==="darwin"?verifyMacosGeneratedRepositories({state:{installation_id:installationId,github_login:login,control_repository:controlRepository,sandbox_repository:sandboxRepository}}):{};
  inspectExistingClone(paths.control,"Control",controlRepository);
  ensureClone(controlRepository,paths.control);
  const runtimeFiles=prepareControlRuntimeFiles({sourceRoot,controlRoot:paths.control});
  const workflow=prepareRuntimeWorkflow({sourceRoot,controlPath:paths.control,platform:process.platform,arch:process.arch,runnerLabel:paths.runnerLabel,trustedGithubUsername:login});
  writeInstanceMetadata(paths.control,{instanceId:short,installationId,trustedGithubUsername:login,launchAgentLabel:process.platform==="darwin"?`com.chatgpt.codex.${short.toLowerCase()}`:null,runnerLabel:paths.runnerLabel,controlRepository,sandboxRepository,codexExecutable:pinCodexExecutable(process.platform),macosBindings:{...immutableIdentities,...(macosControlLayout===MACOS_PRIVATE_CONTROL_LAYOUT_V2?{macos_control_layout:macosControlLayout}:{}),instance_root:instanceRoot,browser_profile:browserProfile,browser_port:browserPort,chat_route_file:chatRouteFile,pending_wake_outbox:pendingWakeOutbox}});
  writeControlRuntimeFiles({controlRoot:paths.control,files:runtimeFiles});
  fs.mkdirSync(path.dirname(workflow.workflowPath),{recursive:true});
  fs.writeFileSync(workflow.workflowPath,workflow.content);

  const targetEntry=projectEntry({
    projectKey,
    repository:targetRepository,
    defaultBranch:target.defaultBranchRef?.name||"main",
    validationProfile,
    enabled:false
  });
  const sandboxEntry=projectEntry({
    projectKey:sandboxProjectKey,
    repository:sandboxRepository,
    defaultBranch:"main",
    validationProfile:sandboxValidationProfile,
    enabled:true
  });
  fs.writeFileSync(
    path.join(paths.control,"projects.json"),
    renderProjectsRegistry([targetEntry,sandboxEntry])
  );

  fs.writeFileSync(path.join(paths.control,"README.md"),[
    "# Private ChatGPT Codex Orchestrator Control Repository",
    "",
    "This private repository was generated automatically for one Orchestrator installation.",
    "Keep it private because its self-hosted runner can execute automation on the configured machine.",
    "",
    "Configured application project: "+targetRepository,
    "Installation sandbox: "+sandboxRepository,
    "",
    "The sandbox is the only repository used for first-time end-to-end installation tests.",
    ""
  ].join("\n"));

  fs.mkdirSync(instanceRoot,{recursive:true});
  if(process.platform==="darwin"&&!fs.existsSync(chatRouteFile)) fs.writeFileSync(chatRouteFile,JSON.stringify({version:1,instance_id:short,installation_id:installationId,control_repository:controlRepository,sandbox_repository:sandboxRepository,routes:[]})+"\n",{flag:"wx",mode:0o600});
  const configPath=path.join(instanceRoot,"config.ps1");
  const configText=renderConfigPs1({
    githubLogin:login,
    projectMappings:[
      {projectKey,projectClonePath:paths.project},
      {projectKey:sandboxProjectKey,projectClonePath:sandboxClonePath}
    ],
    runnerPath:paths.runner,
    ...(process.platform==="darwin"?{instanceId:`runner-${short}`}:{}),
    browserPort,
    browserProfile,
    chatRouteFile
  });
  fs.writeFileSync(configPath,configText,{mode:0o600});

  const commit=commitControlRepo(paths.control,controlRepository);

  return {
    github_login:login,
    ...immutableIdentities,
    project_key:projectKey,
    target_repository:targetRepository,
    default_branch:target.defaultBranchRef?.name||"main",
    validation_profile:validationProfile,
    control_repository:controlRepository,
    control_clone_path:paths.control,
    project_clone_path:paths.project,
    sandbox_project_key:sandboxProjectKey,
    sandbox_repository:sandboxRepository,
    sandbox_clone_path:sandboxClonePath,
    sandbox_validation_profile:sandboxValidationProfile,
    runner_path:paths.runner,
    runner_label:paths.runnerLabel,
    ...(process.platform==="darwin"&&macosControlLayout===MACOS_PRIVATE_CONTROL_LAYOUT_V2?{macos_control_layout:macosControlLayout}:{}),
    launch_agent_label:process.platform==="darwin"?`com.chatgpt.codex.${short.toLowerCase()}`:null,
    runner_owner:installationId,
    sandbox_only:true,
    instance_id:short,
    instance_platform:process.platform,
    instance_arch:process.arch,
    instance_root:instanceRoot,
    config_path:configPath,
    browser_port:browserPort,
    browser_profile:browserProfile,
    pending_wake_outbox:pendingWakeOutbox,
    chat_route_file:chatRouteFile,
    control_repo_changed:commit.changed
  };
}
