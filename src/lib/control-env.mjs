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
  return String(value||"").replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"default";
}

function browserPortForInstallation(shortId){
  const hex=String(shortId||"").replace(/[^0-9a-f]/gi,"").slice(0,6);
  const n=Number.parseInt(hex||"0",16);
  return 10000+(Number.isFinite(n)?n%40000:0);
}

function writeInstanceMetadata(controlPath,{instanceId}){
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(instanceId)) throw new Error("Invalid instance id");
  fs.writeFileSync(path.join(controlPath,"instance.json"),JSON.stringify({
    schema_version:1,
    instance_id:instanceId
  },null,2)+"\n");
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
  try { execute("git",["push","-u","origin","HEAD:main"],{cwd:controlPath}); } catch(error) { execute("git",["reset","--mixed",before],{cwd:controlPath}); throw error; }
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

export function upgradeControlEnvironment({state,sourceRoot=process.cwd(),home=os.homedir()}){
  if(!state?.control_clone_path||!fs.existsSync(path.join(state.control_clone_path,".git"))){
    throw new Error("Existing control clone is unavailable for upgrade");
  }
  if(!state?.runner_label||!state?.runner_path||!state?.browser_profile||!state?.browser_port){
    throw new Error("Existing installation state is incomplete for upgrade");
  }

  const stopped=stopRetiredOriginRouter(state.control_clone_path);
  const scriptsDir=path.join(state.control_clone_path,"scripts");
  copyDirectory(path.join(sourceRoot,"runtime","scripts"),scriptsDir);
  for(const name of RETIRED_ROUTING_SCRIPTS){
    fs.rmSync(path.join(scriptsDir,name),{force:true});
  }
  removeLegacyDefaultReviewRoutes(path.join(state.control_clone_path,"projects.json"));

  const workflowTemplate=fs.readFileSync(path.join(sourceRoot,"templates","control-repo","orchestrator.yml.template"),"utf8");
  fs.mkdirSync(path.join(state.control_clone_path,".github","workflows"),{recursive:true});
  fs.writeFileSync(
    path.join(state.control_clone_path,".github","workflows","orchestrator.yml"),
    renderWorkflow(workflowTemplate,{runnerLabel:state.runner_label})
  );

  const instanceId=installationShortId(state.installation_id)||path.basename(state.runner_path);
  writeInstanceMetadata(state.control_clone_path,{instanceId});

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
    browserPort:state.browser_port,
    browserProfile:state.browser_profile,
    chatRouteFile
  });
  fs.writeFileSync(configPath,configText,{mode:0o600});

  const pendingMigration=retireLegacyGlobalPending({home,instanceRoot});
  const commit=commitControlRepo(state.control_clone_path);

  return {
    changed:commit.changed,
    instance_id:instanceId,
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
  const fetchUrl=gitRun("git",["config","--get","remote.origin.url"],{cwd:state.control_clone_path}).stdout;
  const pushUrls=gitRun("git",["config","--get-all","remote.origin.pushurl"],{cwd:state.control_clone_path,allowFailure:true}).stdout.split(/\r?\n/).filter(Boolean);
  const destinations=pushUrls.length?pushUrls:[fetchUrl];
  if(!destinations.every(url=>normalizedGithubRepository(url)===repository.toLowerCase())) throw new Error("Control clone push destination does not match control repository");
  if(gitRun("git",["branch","--show-current"],{cwd:state.control_clone_path}).stdout!=="main") throw new Error("Control clone must be on main for runtime refresh");
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(state.runner_label||""))){
    throw new Error("Existing runner identity is incomplete or invalid for runtime refresh");
  }

  const scriptsSource=path.join(sourceRoot,"runtime","scripts");
  const workflowTemplatePath=path.join(sourceRoot,"templates","control-repo","orchestrator.yml.template");
  if(!fs.existsSync(scriptsSource)||!fs.existsSync(workflowTemplatePath)){
    throw new Error("Current runtime source tree is incomplete");
  }
  if(!gitRun("git",["diff","--cached","--quiet"],{cwd:state.control_clone_path,allowFailure:true}).ok) throw new Error("Control repository index contains pre-staged unrelated changes");

  const scriptsDir=path.join(state.control_clone_path,"scripts");
  copyDirectory(scriptsSource,scriptsDir);
  for(const name of RETIRED_ROUTING_SCRIPTS) fs.rmSync(path.join(scriptsDir,name),{force:true});

  const workflowPath=path.join(state.control_clone_path,".github","workflows","orchestrator.yml");
  fs.mkdirSync(path.dirname(workflowPath),{recursive:true});
  fs.writeFileSync(workflowPath,renderWorkflow(
    fs.readFileSync(workflowTemplatePath,"utf8"),
    {runnerLabel:state.runner_label}
  ));

  const ownedPaths=[...fs.readdirSync(scriptsSource).map(name=>path.posix.join("scripts",name)),".github/workflows/orchestrator.yml"];
  return {
    ...refreshControlCommit(state.control_clone_path,ownedPaths,gitRun),
    retired_scripts:RETIRED_ROUTING_SCRIPTS
  };
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
  const short=installationShortId(installationId);

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
  writeInstanceMetadata(paths.control,{instanceId:short});

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
  const instanceRoot=path.join(configRoot,"instances",short);
  fs.mkdirSync(instanceRoot,{recursive:true});
  const browserProfile=process.platform==="win32"
    ? path.join(process.env.LOCALAPPDATA||path.join(home,"AppData","Local"),"ChatGPTCodexOrchestratorReviewer-"+short)
    : path.join(instanceRoot,"browser-profile");
  const browserPort=browserPortForInstallation(short);
  const chatRouteFile=path.join(instanceRoot,"chat-routes.json");
  const configPath=path.join(instanceRoot,"config.ps1");
  const configText=renderConfigPs1({
    githubLogin:login,
    projectMappings:[
      {projectKey,projectClonePath:paths.project},
      {projectKey:sandboxProjectKey,projectClonePath:sandboxClonePath}
    ],
    runnerPath:paths.runner,
    browserPort,
    browserProfile,
    chatRouteFile
  });
  fs.writeFileSync(configPath,configText,{mode:0o600});

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
    instance_id:short,
    instance_root:instanceRoot,
    config_path:configPath,
    browser_port:browserPort,
    browser_profile:browserProfile,
    chat_route_file:chatRouteFile,
    control_repo_changed:commit.changed
  };
}
