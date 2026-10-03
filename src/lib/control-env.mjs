import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {detectProjectProfile} from "./project-detect.mjs";
import {defaultLocalPaths,renderProjectsJson,renderConfigPs1,renderWorkflow,safeKey} from "./control-render.mjs";

function run(command,args,{cwd,allowFailure=false}={}){
  const r=spawnSync(command,args,{cwd,encoding:"utf8",shell:process.platform==="win32"});
  if(r.status!==0&&!allowFailure){
    throw new Error((r.stderr||r.stdout||command+" failed").trim());
  }
  return {ok:r.status===0,stdout:(r.stdout||"").trim(),stderr:(r.stderr||"").trim(),status:r.status};
}

export function githubLogin(){
  const r=run("gh",["api","user","--jq",".login"]);
  if(!/^[A-Za-z0-9-]+$/.test(r.stdout)) throw new Error("Could not determine GitHub login");
  return r.stdout;
}

export function repositoryInfo(repository){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid repository");
  const r=run("gh",["repo","view",repository,"--json","nameWithOwner,defaultBranchRef,visibility"]);
  return JSON.parse(r.stdout);
}

function ensureEmptyOrOwnedControlRepo({fullName,installationId}){
  const view=run("gh",["repo","view",fullName,"--json","nameWithOwner,visibility,description"],{allowFailure:true});
  if(!view.ok){
    run("gh",["repo","create",fullName,"--private","--description","Private control repository for ChatGPT Codex Orchestrator installation "+installationId]);
    return {created:true};
  }

  const existing=JSON.parse(view.stdout);
  if(String(existing.visibility).toUpperCase()!=="PRIVATE"){
    throw new Error("Refusing to use an existing non-private control repository");
  }
  if(!String(existing.description||"").includes(installationId)){
    throw new Error("A repository with the generated control-repo name already exists and is not marked as belonging to this installation");
  }
  return {created:false};
}

function ensureClone(repository,target){
  if(fs.existsSync(path.join(target,".git"))){
    const origin=run("git",["remote","get-url","origin"],{cwd:target}).stdout;
    if(!origin.toLowerCase().includes(repository.toLowerCase())) throw new Error("Existing local folder points to a different Git repository");
    run("git",["fetch","origin","--prune"],{cwd:target});
    return;
  }
  if(fs.existsSync(target)&&fs.readdirSync(target).length>0) throw new Error("Target clone directory already exists and is not empty");
  fs.mkdirSync(path.dirname(target),{recursive:true});
  run("gh",["repo","clone",repository,target]);
}

function copyDirectory(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const entry of fs.readdirSync(src,{withFileTypes:true})){
    const from=path.join(src,entry.name);
    const to=path.join(dst,entry.name);
    if(entry.isDirectory()) copyDirectory(from,to);
    else fs.copyFileSync(from,to);
  }
}

function commitControlRepo(controlPath){
  run("git",["add","-A"],{cwd:controlPath});
  const diff=run("git",["diff","--cached","--quiet"],{cwd:controlPath,allowFailure:true});
  if(diff.ok) return {changed:false};
  run("git",["-c","user.name=ChatGPT Codex Orchestrator","-c","user.email=codex-orchestrator@users.noreply.github.com","commit","-m","chore: configure private orchestrator control plane"],{cwd:controlPath});
  run("git",["push","-u","origin","HEAD:main"],{cwd:controlPath});
  return {changed:true};
}

export function prepareControlEnvironment({
  installationId,
  targetRepository,
  reviewerChatUrl,
  sourceRoot=process.cwd(),
  home=os.homedir()
}){
  if(!installationId) throw new Error("installationId is required");
  if(!/^https:\/\/chatgpt\.com\//i.test(reviewerChatUrl)) throw new Error("Invalid reviewer Chat URL");

  const login=githubLogin();
  const target=repositoryInfo(targetRepository);
  const projectKey=safeKey(String(targetRepository).split("/").pop());
  const paths=defaultLocalPaths({home,installationId,projectKey});

  ensureClone(targetRepository,paths.project);
  const validationProfile=detectProjectProfile(paths.project);

  const short=String(installationId).replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"default";
  const controlRepository=login+"/chatgpt-codex-orchestrator-control-"+short;
  ensureEmptyOrOwnedControlRepo({fullName:controlRepository,installationId});
  ensureClone(controlRepository,paths.control);

  const runtimeSource=path.join(sourceRoot,"runtime");
  const scriptsSource=path.join(runtimeSource,"scripts");
  const workflowTemplate=fs.readFileSync(path.join(sourceRoot,"templates","control-repo","orchestrator.yml.template"),"utf8");

  copyDirectory(scriptsSource,path.join(paths.control,"scripts"));
  fs.mkdirSync(path.join(paths.control,".github","workflows"),{recursive:true});
  fs.writeFileSync(path.join(paths.control,".github","workflows","orchestrator.yml"),renderWorkflow(workflowTemplate,{runnerLabel:paths.runnerLabel}));
  fs.writeFileSync(path.join(paths.control,"projects.json"),renderProjectsJson({
    projectKey,
    repository:targetRepository,
    defaultBranch:target.defaultBranchRef?.name||"main",
    validationProfile
  }));
  fs.writeFileSync(path.join(paths.control,"README.md"),[
    "# Private ChatGPT Codex Orchestrator Control Repository",
    "",
    "This repository was generated automatically for one Orchestrator installation.",
    "Keep it private because its self-hosted runner can execute automation on the configured machine.",
    "",
    "Do not use this repository as an application/project repository."
  ].join("\n")+"\n");

  const configRoot=path.join(home,".chatgpt-codex-orchestrator");
  fs.mkdirSync(configRoot,{recursive:true});
  const browserProfile=process.platform==="win32"
    ? path.join(process.env.LOCALAPPDATA||path.join(home,"AppData","Local"),"ChatGPTCodexOrchestratorReviewer-"+short)
    : path.join(configRoot,"browser-profile-"+short);

  let browserPort=9333;
  const configText=renderConfigPs1({
    githubLogin:login,
    projectKey,
    projectClonePath:paths.project,
    reviewerChatUrl,
    runnerPath:paths.runner,
    browserPort,
    browserProfile
  });
  fs.writeFileSync(path.join(configRoot,"config.ps1"),configText,{mode:0o600});

  const commit=commitControlRepo(paths.control);

  return {
    github_login:login,
    project_key:projectKey,
    target_repository:targetRepository,
    default_branch:target.defaultBranchRef?.name||"main",
    validation_profile:validationProfile,
    control_repository:controlRepository,
    control_clone_path:paths.control,
    project_clone_path:paths.project,
    runner_path:paths.runner,
    runner_label:paths.runnerLabel,
    config_path:path.join(configRoot,"config.ps1"),
    browser_port:browserPort,
    browser_profile:browserProfile,
    control_repo_changed:commit.changed
  };
}
