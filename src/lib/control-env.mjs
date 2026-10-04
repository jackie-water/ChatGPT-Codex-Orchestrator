import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawnSafeSync} from "./spawn-safe.mjs";
import {detectProjectProfile} from "./project-detect.mjs";
import {
  defaultLocalPaths,
  projectEntry,
  renderProjectsRegistry,
  renderConfigPs1,
  renderWorkflow,
  safeKey
} from "./control-render.mjs";

function run(command,args,{cwd,allowFailure=false}={}){
  const r=spawnSafeSync(command,args,{cwd,encoding:"utf8"});
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

function commitAndPush({repoPath,message,branch="main"}){
  run("git",["add","-A"],{cwd:repoPath});
  const diff=run("git",["diff","--cached","--quiet"],{cwd:repoPath,allowFailure:true});
  if(diff.ok) return {changed:false};
  run("git",[
    "-c","user.name=ChatGPT Codex Orchestrator",
    "-c","user.email=codex-orchestrator@users.noreply.github.com",
    "commit","-m",message
  ],{cwd:repoPath});
  run("git",["push","-u","origin","HEAD:"+branch],{cwd:repoPath});
  return {changed:true};
}

function seedSandbox({repoPath,installationId}){
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
    branch:"main"
  });
}

function commitControlRepo(controlPath){
  return commitAndPush({
    repoPath:controlPath,
    message:"chore: configure private orchestrator control plane",
    branch:"main"
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
  const short=String(installationId).replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"default";

  ensureClone(targetRepository,paths.project);
  const validationProfile=detectProjectProfile(paths.project);

  const sandboxProjectKey="sandbox-"+short;
  const sandboxRepository=login+"/chatgpt-codex-orchestrator-sandbox-"+short;
  const sandboxClonePath=path.join(home,"ChatGPTCodexOrchestrator","sandbox-"+short);
  ensureOwnedPrivateRepo({fullName:sandboxRepository,installationId,purpose:"sandbox"});
  ensureClone(sandboxRepository,sandboxClonePath);
  seedSandbox({repoPath:sandboxClonePath,installationId});
  const sandboxValidationProfile=detectProjectProfile(sandboxClonePath);

  const controlRepository=login+"/chatgpt-codex-orchestrator-control-"+short;
  ensureOwnedPrivateRepo({fullName:controlRepository,installationId,purpose:"control"});
  ensureClone(controlRepository,paths.control);

  const scriptsSource=path.join(sourceRoot,"runtime","scripts");
  const workflowTemplate=fs.readFileSync(path.join(sourceRoot,"templates","control-repo","orchestrator.yml.template"),"utf8");

  copyDirectory(scriptsSource,path.join(paths.control,"scripts"));
  fs.mkdirSync(path.join(paths.control,".github","workflows"),{recursive:true});
  fs.writeFileSync(
    path.join(paths.control,".github","workflows","orchestrator.yml"),
    renderWorkflow(workflowTemplate,{runnerLabel:paths.runnerLabel})
  );

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

  const configRoot=path.join(home,".chatgpt-codex-orchestrator");
  fs.mkdirSync(configRoot,{recursive:true});
  const browserProfile=process.platform==="win32"
    ? path.join(process.env.LOCALAPPDATA||path.join(home,"AppData","Local"),"ChatGPTCodexOrchestratorReviewer-"+short)
    : path.join(configRoot,"browser-profile-"+short);

  const browserPort=9333;
  const instanceId=path.basename(paths.runner);
  const chatRouteFile=path.join(home,".chatgpt-codex-orchestrator","routes",instanceId,"chat-routes.json");
  const configText=renderConfigPs1({
    githubLogin:login,
    projectMappings:[
      {projectKey,projectClonePath:paths.project,reviewerChatUrl},
      {projectKey:sandboxProjectKey,projectClonePath:sandboxClonePath,reviewerChatUrl}
    ],
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
    sandbox_project_key:sandboxProjectKey,
    sandbox_repository:sandboxRepository,
    sandbox_clone_path:sandboxClonePath,
    sandbox_validation_profile:sandboxValidationProfile,
    runner_path:paths.runner,
    runner_label:paths.runnerLabel,
    config_path:path.join(configRoot,"config.ps1"),
    browser_port:browserPort,
    browser_profile:browserProfile,
    chat_route_file:chatRouteFile,
    control_repo_changed:commit.changed
  };
}
