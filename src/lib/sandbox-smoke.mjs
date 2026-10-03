import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function run(command,args,{cwd,allowFailure=false}={}){
  const r=spawnSync(command,args,{cwd,encoding:"utf8",shell:process.platform==="win32"});
  if(r.status!==0&&!allowFailure){
    throw new Error((r.stderr||r.stdout||command+" failed").trim());
  }
  return {ok:r.status===0,stdout:(r.stdout||"").trim(),stderr:(r.stderr||"").trim(),status:r.status};
}

function originRouteFile(){
  return process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE ||
    path.join(os.homedir(),".chatgpt-codex-orchestrator","issue-routes.json");
}

function normalizeChatUrl(value){
  try{
    const u=new URL(value);
    if(u.origin!=="https://chatgpt.com") throw new Error("invalid origin");
    if(!/^\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]+\/?$/.test(u.pathname)) throw new Error("invalid conversation");
    return u.origin+u.pathname.replace(/\/$/,"");
  }catch{
    throw new Error("Reviewer Chat URL is invalid for local origin routing");
  }
}

function issueNumberOf(issue){
  if(Number.isInteger(issue?.number)&&issue.number>0) return issue.number;
  const url=String(issue?.url||"");
  const match=url.match(/\/issues\/(\d+)(?:$|[?#])/);
  if(match) return Number(match[1]);
  throw new Error("Could not determine GitHub issue number for local origin routing");
}

function registerKnownIssueOrigin(state,issue,projectKey){
  const issueNumber=issueNumberOf(issue);
  const chatUrl=normalizeChatUrl(state?.reviewer_chat_url);
  const file=originRouteFile();
  fs.mkdirSync(path.dirname(file),{recursive:true});

  let registry={version:1,issues:{}};
  try{
    const raw=fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"");
    const parsed=JSON.parse(raw);
    if(parsed&&typeof parsed==="object") registry=parsed;
    registry.version=1;
    if(!registry.issues||typeof registry.issues!=="object") registry.issues={};
  }catch{}

  const key=String(issueNumber);
  const existing=registry.issues[key];
  if(existing?.chat_url&&existing.chat_url!==chatUrl){
    throw new Error("Origin route conflict for installer-created issue #"+issueNumber);
  }

  const now=new Date().toISOString();
  registry.issues[key]={
    project:projectKey,
    chat_url:chatUrl,
    captured_at_utc:existing?.captured_at_utc||now,
    last_seen_utc:now,
    source:"installer-known-origin"
  };

  const temp=file+"."+process.pid+".tmp";
  fs.writeFileSync(temp,JSON.stringify(registry,null,2)+"\n","utf8");
  fs.renameSync(temp,file);
  return issueNumber;
}

function shortId(installationId){
  return String(installationId||"").replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"default";
}

export function smokeBranch(installationId){
  return "test/install-smoke-"+shortId(installationId);
}

function issueMarker(installationId){
  return "INSTALL-SMOKE-"+shortId(installationId);
}

function listSmokeIssues(controlRepository,installationId){
  const marker=issueMarker(installationId);
  const r=run("gh",[
    "issue","list","--repo",controlRepository,
    "--state","all","--limit","100",
    "--search",marker+" in:title",
    "--json","number,title,state,url,body"
  ],{allowFailure:true});
  if(!r.ok||!r.stdout) return [];
  try{return JSON.parse(r.stdout);}catch{return [];}
}

function showGit(repoPath,object){
  return run("git",["show",object],{cwd:repoPath,allowFailure:true});
}

function fetch(repoPath){
  run("git",["fetch","origin","--prune"],{cwd:repoPath});
}

export function sandboxSmokeStatus(state){
  if(!state?.sandbox_clone_path||!state?.sandbox_repository||!state?.sandbox_project_key){
    return {status:"NOT_READY",stage:"SANDBOX_NOT_CONFIGURED"};
  }

  fetch(state.sandbox_clone_path);
  const mainStatus=showGit(state.sandbox_clone_path,"origin/main:src/status.mjs");
  if(mainStatus.ok&&/status\s*=\s*["']ready["']/.test(mainStatus.stdout)){
    return {
      status:"PASS",
      stage:"COMPLETE",
      branch:smokeBranch(state.installation_id),
      message:"Sandbox main contains the reviewed ready state."
    };
  }

  const branch=smokeBranch(state.installation_id);
  const branchProbe=run("git",["rev-parse","--verify","origin/"+branch],{cwd:state.sandbox_clone_path,allowFailure:true});
  const issues=state.control_repository?listSmokeIssues(state.control_repository,state.installation_id):[];

  if(!branchProbe.ok){
    return {
      status:state.sandbox_smoke_started?"WAITING":"NOT_STARTED",
      stage:state.sandbox_smoke_started?"CODEX_PENDING":"NOT_STARTED",
      branch,
      issues
    };
  }

  const head=branchProbe.stdout.trim().toLowerCase();
  const checkpointBranch="codex/checkpoints";
  const runEvidence=showGit(state.sandbox_clone_path,"origin/"+checkpointBranch+":.codex/latest-run.md");
  let implementationStatus=null;
  if(runEvidence.ok&&runEvidence.stdout.includes("- source_branch: "+branch)&&runEvidence.stdout.includes("- source_commit: "+head)){
    const m=runEvidence.stdout.match(/Status:\s*([A-Z_]+)/);
    implementationStatus=m?.[1]||"UNKNOWN";
  }

  const reviewPath=".codex/reviews/by-commit/"+head+".md";
  const reviewEvidence=showGit(state.sandbox_clone_path,"origin/"+checkpointBranch+":"+reviewPath);
  let reviewStatus=null;
  if(reviewEvidence.ok){
    const m=reviewEvidence.stdout.match(/Status:\s*([A-Z_]+)/);
    reviewStatus=m?.[1]||"UNKNOWN";
  }

  if(reviewStatus==="CODE_REVIEW_COMPLETE"){
    return {
      status:"NEEDS_USER_ACTION",
      stage:"MERGE_APPROVAL_REQUIRED",
      branch,
      commit:head,
      implementation_status:implementationStatus,
      review_status:reviewStatus,
      issues
    };
  }

  if(implementationStatus==="VALIDATION_FAILED"||implementationStatus==="FAILED"){
    return {
      status:"ERROR",
      stage:"IMPLEMENTATION_FAILED",
      branch,
      commit:head,
      implementation_status:implementationStatus,
      issues
    };
  }

  if(implementationStatus==="READY_FOR_REVIEW"){
    return {
      status:"WAITING",
      stage:"CHAT_REVIEW_OR_CODE_REVIEW",
      branch,
      commit:head,
      implementation_status:implementationStatus,
      review_status:reviewStatus,
      issues
    };
  }

  return {
    status:"WAITING",
    stage:"CODEX_RUNNING",
    branch,
    commit:head,
    implementation_status:implementationStatus,
    issues
  };
}

export function startSandboxSmoke(state){
  if(!state?.control_repository||!state?.sandbox_project_key||!state?.sandbox_repository){
    throw new Error("Sandbox/control environment is not configured");
  }

  const existing=listSmokeIssues(state.control_repository,state.installation_id)
    .find(x=>String(x.title||"").startsWith("[CODEX-RUN]")&&String(x.title||"").includes(issueMarker(state.installation_id)));
  if(existing){
    registerKnownIssueOrigin(state,existing,state.sandbox_project_key);
    return {created:false,issue:existing,branch:smokeBranch(state.installation_id)};
  }

  const branch=smokeBranch(state.installation_id);
  const prompt=[
    "Installation sandbox smoke test.",
    "",
    "Work only in this isolated sandbox repository.",
    "Make exactly these functional changes:",
    "- In src/status.mjs change the exported status string from \"not-ready\" to \"ready\".",
    "- In test/status.test.mjs update the expected status and test description so the test verifies \"ready\".",
    "",
    "Do not modify any other file.",
    "Do not add dependencies.",
    "Do not redesign the fixture.",
    "Do not run routine validation commands; the wrapper owns deterministic validation.",
    "Return a concise implementation summary only."
  ].join("\n");

  const body=JSON.stringify({
    project:state.sandbox_project_key,
    target_repo:state.sandbox_repository,
    target_branch:branch,
    iteration:1,
    max_iterations:5,
    review_route:state.sandbox_project_key,
    prompt,
    installation_smoke:{
      installation_id:state.installation_id,
      marker:issueMarker(state.installation_id)
    }
  },null,2);

  const title="[CODEX-RUN] "+issueMarker(state.installation_id)+" sandbox ready-state";
  const r=run("gh",["issue","create","--repo",state.control_repository,"--title",title,"--body",body]);
  const url=r.stdout.split(/\s+/).find(x=>/^https:\/\/github\.com\//.test(x))||r.stdout;
  const issue={title,url};
  registerKnownIssueOrigin(state,issue,state.sandbox_project_key);
  return {created:true,issue,branch};
}

export function createSandboxCodeReview(state,{commit}){
  if(!/^[0-9a-f]{40}$/.test(String(commit||""))) throw new Error("Full reviewed commit SHA is required");
  const existing=listSmokeIssues(state.control_repository,state.installation_id)
    .find(x=>String(x.title||"").startsWith("[CODE-REVIEW]")&&String(x.body||"").includes(commit));
  if(existing){
    registerKnownIssueOrigin(state,existing,state.sandbox_project_key);
    return {created:false,issue:existing};
  }

  const title="[CODE-REVIEW] "+issueMarker(state.installation_id)+" "+commit.slice(0,12);
  const body=JSON.stringify({
    project:state.sandbox_project_key,
    source_branch:smokeBranch(state.installation_id),
    reviewed_commit:commit,
    review_route:state.sandbox_project_key,
    installation_smoke:{installation_id:state.installation_id,marker:issueMarker(state.installation_id)}
  },null,2);
  const r=run("gh",["issue","create","--repo",state.control_repository,"--title",title,"--body",body]);
  const url=r.stdout.split(/\s+/).find(x=>/^https:\/\/github\.com\//.test(x))||r.stdout;
  const issue={title,url};
  registerKnownIssueOrigin(state,issue,state.sandbox_project_key);
  return {created:true,issue};
}

export function createSandboxMergeApproval(state,{commit}){
  if(!/^[0-9a-f]{40}$/.test(String(commit||""))) throw new Error("Full approved commit SHA is required");
  const existing=listSmokeIssues(state.control_repository,state.installation_id)
    .find(x=>String(x.title||"").startsWith("[MERGE-APPROVE]")&&String(x.body||"").includes(commit));
  if(existing){
    registerKnownIssueOrigin(state,existing,state.sandbox_project_key);
    return {created:false,issue:existing};
  }

  const title="[MERGE-APPROVE] "+issueMarker(state.installation_id)+" "+commit.slice(0,12);
  const body=JSON.stringify({
    project:state.sandbox_project_key,
    source_branch:smokeBranch(state.installation_id),
    approved_commit:commit,
    review_route:state.sandbox_project_key,
    installation_smoke:{installation_id:state.installation_id,marker:issueMarker(state.installation_id)}
  },null,2);
  const r=run("gh",["issue","create","--repo",state.control_repository,"--title",title,"--body",body]);
  const url=r.stdout.split(/\s+/).find(x=>/^https:\/\/github\.com\//.test(x))||r.stdout;
  const issue={title,url};
  registerKnownIssueOrigin(state,issue,state.sandbox_project_key);
  return {created:true,issue};
}
