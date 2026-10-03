#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSafeSync } from "./lib/spawn-safe.mjs";
import { loadState, saveState, stateRoot } from "./lib/state.mjs";
import { t, normalizeLanguage } from "./lib/i18n.mjs";
import { ERROR_CATALOG } from "./lib/errors.mjs";
import { sanitizeObject } from "./lib/sanitize.mjs";
import { submitDiagnosticReport } from "./lib/reporting.mjs";
import { prepareControlEnvironment, activateTargetProject } from "./lib/control-env.mjs";
import { renderProjectInstructions } from "./lib/project-instructions.mjs";
import {
  sandboxSmokeStatus,
  startSandboxSmoke,
  createSandboxCodeReview,
  createSandboxMergeApproval
} from "./lib/sandbox-smoke.mjs";

const argv = process.argv.slice(2);
const command = argv[0] || "help";
const wantsJson = argv.includes("--json");
const productConfig = JSON.parse(fs.readFileSync(new URL("../product.json", import.meta.url),"utf8"));

function valueOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function emit(payload, code = 0) {
  if (wantsJson) process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  else {
    const zh=payload.preferred_language==="zh-CN";
    console.log(payload.message || payload.status || "");
    if(payload.error_id) console.log((zh?"错误编号":"Error ID")+": "+payload.error_id);
    if(payload.current_step) console.log((zh?"当前步骤":"Current step")+": "+payload.current_step);
    if(payload.report_file) console.log((zh?"本地诊断报告":"Local diagnostic report")+": "+payload.report_file);
    if(payload.consent_required_before_upload) {
      console.log(zh?"报告尚未上传。提交前会再次征求你的明确同意。":"The report has not been uploaded. Explicit consent will be requested before submission.");
    }
    if(payload.checks&&typeof payload.checks==="object"){
      console.log("");
      console.log(zh?"检查结果：":"Checks:");
      for(const [key,value] of Object.entries(payload.checks)){
        if(typeof value==="boolean") console.log("  "+(value?"✓":"✗")+" "+key.replaceAll("_"," "));
        else if(key==="pending_callbacks") console.log("  "+key.replaceAll("_"," ")+": "+value);
      }
    }
    if(payload.runtime&&typeof payload.runtime==="object"){
      console.log("");
      console.log(zh?"运行状态：":"Runtime:");
      for(const [key,value] of Object.entries(payload.runtime)){
        if(typeof value==="boolean") console.log("  "+(value?"✓":"✗")+" "+key.replaceAll("_"," "));
        else console.log("  "+key.replaceAll("_"," ")+": "+value);
      }
    }
    if (payload.details) console.log(payload.details);
  }
  process.exitCode = code;
}

function commandExists(name, args = ["--version"]) {
  const result = spawnSafeSync(name, args, { encoding: "utf8" });
  return { ok: result.status === 0, output: (result.stdout || result.stderr || "").trim() };
}

function ensureStateLanguage(state) {
  const requested = valueOf("--language");
  if (requested) state.preferred_language = normalizeLanguage(requested);
  state.preferred_language ||= "en";
  return state.preferred_language;
}

function action(state, actionId, messageKey, extra = {}) {
  state.current_step = actionId;
  saveState(state);
  return {
    status: "NEEDS_USER_ACTION",
    action_id: actionId,
    preferred_language: state.preferred_language,
    message_key: messageKey,
    message: t(state.preferred_language, messageKey),
    resume_command: "node src/cli.mjs resume --json",
    ...extra
  };
}


function dryRun() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const git=commandExists("git");
  const node=commandExists("node");
  const gh=commandExists("gh");
  const codex=commandExists("codex");
  const ghAuth=gh.ok?commandExists("gh",["auth","status"]):{ok:false};

  const plan=[
    {
      step:"prerequisites",
      automatic:true,
      current:{
        git:git.ok,
        node:node.ok,
        github_cli:gh.ok,
        codex:codex.ok
      },
      action:"Install any supported missing prerequisites automatically."
    },
    {
      step:"github_cli_sign_in",
      automatic:false,
      required:!ghAuth.ok,
      action:"Ask the user to complete GitHub sign-in only if it is not already authenticated."
    },
    {
      step:"github_plugin_authorization",
      automatic:false,
      required:!state.github_plugin_authorized,
      action:"Ask the user to connect/authorize the GitHub Plugin in ChatGPT."
    },
    {
      step:"project_selection",
      automatic:false,
      required:!state.target_repository,
      current_repository:state.target_repository||null,
      action:"Ask for one GitHub repository in owner/repository form."
    },
    {
      step:"reviewer_chat",
      automatic:false,
      required:!state.reviewer_chat_url,
      action:"Ask for the reviewer ChatGPT conversation URL."
    },
    {
      step:"isolated_control_environment",
      automatic:true,
      action:"Create a private control repository, private sandbox repository, isolated local paths, isolated runner label and isolated browser profile."
    },
    {
      step:"sandbox_end_to_end",
      automatic:"mixed",
      action:"Run implementation, wrapper validation and independent Code Review in the generated sandbox only. Require explicit approval before the sandbox-only merge."
    },
    {
      step:"real_project_activation",
      automatic:true,
      gated_by:"sandbox_complete",
      action:"Keep the real project disabled until the sandbox is complete, then create its checkpoint branch and activate orchestration."
    },
    {
      step:"project_folder_trust",
      automatic:false,
      action:"Ask the user to approve Codex trust for the real project only after sandbox verification."
    }
  ];

  emit({
    status:"PASS",
    preferred_language:lang,
    message:lang==="zh-CN"?"安装预演完成，没有修改任何 GitHub repository、runner 或项目。":"Installation dry-run complete. No GitHub repository, runner or project was modified.",
    dry_run:true,
    mutations_performed:false,
    plan
  });
}

function answer() {
  const state = loadState();
  const lang = ensureStateLanguage(state);
  const actionId = valueOf("--action");
  const value = valueOf("--value");

  const bool = v => /^(true|yes|y|1|done|completed)$/i.test(String(v || ""));

  if (actionId === "github_plugin_authorization" || actionId === "github_authorization") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-001",recoverable:true,preferred_language:lang,message:t(lang,"answer.github.invalid")},1);
    state.github_plugin_authorized = true;
  } else if (actionId === "target_repository") {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || ""))) {
      return emit({status:"ERROR",error_id:"SETUP-005",recoverable:true,preferred_language:lang,message:t(lang,"answer.repository.invalid")},1);
    }
    state.target_repository = value;
  } else if (actionId === "reviewer_chat_url") {
    if (!/^https:\/\/chatgpt\.com\//i.test(String(value || ""))) {
      return emit({status:"ERROR",error_id:"SETUP-006",recoverable:true,preferred_language:lang,message:t(lang,"answer.chat.invalid")},1);
    }
    state.reviewer_chat_url = value;
  } else if (actionId === "generated_repo_authorization") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-005",recoverable:true,preferred_language:lang,message:t(lang,"answer.generated_repo.invalid")},1);
    state.generated_repo_authorized = true;
  } else if (actionId === "codex_trust_sandbox") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-002",recoverable:true,preferred_language:lang,message:t(lang,"answer.codex.invalid")},1);
    state.codex_trust_sandbox = true;
  } else if (actionId === "codex_trust_project") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-002",recoverable:true,preferred_language:lang,message:t(lang,"answer.codex.invalid")},1);
    state.codex_trust_project = true;
  } else if (actionId === "reviewer_browser_login") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"SETUP-012",recoverable:true,preferred_language:lang,message:t(lang,"answer.browser.invalid")},1);
    state.reviewer_browser_ready = true;
  } else if (actionId === "chatgpt_project_instructions") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"SETUP-007",recoverable:true,preferred_language:lang,message:t(lang,"answer.instructions.invalid")},1);
    state.instructions_added = true;
  } else if (actionId === "sandbox_verification") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"SETUP-008",recoverable:true,preferred_language:lang,message:t(lang,"answer.sandbox.invalid")},1);
    state.sandbox_verified = true;
  } else {
    return emit({status:"ERROR",error_id:"SETUP-009",recoverable:false,preferred_language:lang,message:t(lang,"answer.action.unknown")},1);
  }

  saveState(state);
  emit({
    status:"PASS",
    preferred_language:lang,
    message:t(lang,"answer.saved"),
    action_id:actionId,
    resume_command:"node src/cli.mjs resume --json"
  });
}

function runSetup() {
  const state = loadState();
  const lang = ensureStateLanguage(state);
  state.installation_id ||= crypto.randomUUID();
  state.completed ||= [];

  const git = commandExists("git");
  const node = commandExists("node");
  const gh = commandExists("gh");
  const codex = commandExists("codex");
  const ghAuth = gh.ok ? commandExists("gh",["auth","status"]) : {ok:false,output:""};
  state.environment = { platform:process.platform, release:os.release(), git:git.output||null, node:node.output||null, gh:gh.output||null, codex:codex.output||null };

  if (!git.ok || !node.ok || !gh.ok || !codex.ok) {
    saveState(state);
    return emit({
      status:"ERROR", error_id:"SETUP-004", recoverable:true, preferred_language:lang,
      message:t(lang,"setup.prerequisites.failed"),
      missing:{git:!git.ok,node:!node.ok,gh:!gh.ok,codex:!codex.ok}
    },1);
  }
  if (!state.completed.includes("environment_check")) state.completed.push("environment_check");

  if (!ghAuth.ok) {
    return emit(action(state,"github_cli_authorization","setup.github_cli.connect",{
      helper_command:"node src/cli.mjs github-login --json"
    }));
  }
  if (!state.completed.includes("github_cli_authorization")) state.completed.push("github_cli_authorization");

  if (!state.github_plugin_authorized) {
    return emit(action(state,"github_plugin_authorization","setup.github_plugin.connect"));
  }
  if (!state.completed.includes("github_plugin_authorization")) state.completed.push("github_plugin_authorization");

  if (!state.target_repository) return emit(action(state,"target_repository","setup.repository.ask"));
  if (!state.completed.includes("target_repository")) state.completed.push("target_repository");

  if (!state.reviewer_chat_url) return emit(action(state,"reviewer_chat_url","setup.chat.ask"));
  if (!state.completed.includes("reviewer_chat_url")) state.completed.push("reviewer_chat_url");

  if (!state.control_environment_ready) {
    try {
      const control=prepareControlEnvironment({
        installationId:state.installation_id,
        targetRepository:state.target_repository,
        reviewerChatUrl:state.reviewer_chat_url,
        sourceRoot:process.cwd(),
        home:os.homedir()
      });
      Object.assign(state,{
        github_login:control.github_login,
        project_key:control.project_key,
        default_branch:control.default_branch,
        validation_profile:control.validation_profile,
        control_repository:control.control_repository,
        control_clone_path:control.control_clone_path,
        project_clone_path:control.project_clone_path,
        sandbox_project_key:control.sandbox_project_key,
        sandbox_repository:control.sandbox_repository,
        sandbox_clone_path:control.sandbox_clone_path,
        sandbox_validation_profile:control.sandbox_validation_profile,
        runner_path:control.runner_path,
        runner_label:control.runner_label,
        config_path:control.config_path,
        browser_port:control.browser_port,
        browser_profile:control.browser_profile
      });

      // Installation isolation: before the sandbox passes, only the generated
      // sandbox may receive checkpoint branches or orchestration writes.
      const setupSandbox=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(control.control_clone_path,"scripts","setup-project-clone.ps1"),
        "-Project",control.sandbox_project_key
      ],{encoding:"utf8"});
      if(setupSandbox.status!==0) {
        throw new Error((setupSandbox.stderr||setupSandbox.stdout||("Sandbox clone/checkpoint setup failed for "+control.sandbox_project_key)).trim());
      }

      const runnerInstall=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(control.control_clone_path,"scripts","install-runner.ps1"),
        "-ControlRepository",control.control_repository,
        "-RunnerPath",control.runner_path,
        "-RunnerLabel",control.runner_label
      ],{encoding:"utf8"});
      if(runnerInstall.status!==0) throw new Error((runnerInstall.stderr||runnerInstall.stdout||"Runner installation failed").trim());

      state.control_environment_ready=true;
      if(!state.completed.includes("control_environment")) state.completed.push("control_environment");
      saveState(state);
    } catch(error) {
      state.last_error={error_id:"SETUP-011",message:String(error.message||error),at:new Date().toISOString()};
      saveState(state);
      return emit({status:"ERROR",error_id:"SETUP-011",recoverable:true,preferred_language:lang,message:t(lang,"setup.control.failed"),details:String(error.message||error)},1);
    }
  }

  if(!state.generated_repo_authorized) {
    return emit(action(state,"generated_repo_authorization","setup.generated_repo.connect",{
      repositories:[state.control_repository,state.sandbox_repository],
      verification_requirement:"ChatGPT GitHub connection must be able to read both generated private repositories before continuing."
    }));
  }
  if(!state.completed.includes("generated_repo_authorization")) state.completed.push("generated_repo_authorization");

  const codexLogin=commandExists("codex",["login","status"]);
  if(!codexLogin.ok) {
    return emit(action(state,"codex_login","setup.codex.login",{
      helper_command:"node src/cli.mjs codex-login --json"
    }));
  }
  if(!state.completed.includes("codex_login")) state.completed.push("codex_login");

  if(!state.codex_trust_sandbox) {
    return emit(action(state,"codex_trust_sandbox","setup.codex.trust_sandbox",{
      folder:state.sandbox_clone_path,
      helper_command:"node src/cli.mjs codex-open --scope sandbox"
    }));
  }
  if(!state.completed.includes("codex_trust_sandbox")) state.completed.push("codex_trust_sandbox");

  if(!state.reviewer_browser_ready) {
    const browserScript=path.join(state.control_clone_path,"scripts","start-reviewer-browser.ps1");
    const openBrowser=spawnSafeSync("powershell.exe",[
      "-NoProfile","-ExecutionPolicy","Bypass","-File",browserScript,
      "-ChatUrl",state.reviewer_chat_url
    ],{encoding:"utf8"});
    if(openBrowser.status!==0){
      state.last_error={error_id:"CALLBACK-001",message:(openBrowser.stderr||openBrowser.stdout||"Reviewer browser launch failed").trim(),at:new Date().toISOString()};
      saveState(state);
    }
    return emit(action(state,"reviewer_browser_login","setup.browser.login",{
      reviewer_chat_url:state.reviewer_chat_url
    }));
  }
  if(!state.completed.includes("reviewer_browser_login")) state.completed.push("reviewer_browser_login");

  const generated = path.resolve(".generated");
  fs.mkdirSync(generated,{recursive:true});
  const templateName = lang === "zh-CN" ? "chatgpt-project-instructions.zh-CN.md" : "chatgpt-project-instructions.md";
  const template = fs.readFileSync(path.resolve("templates",templateName),"utf8");
  const projectKey = state.project_key || state.target_repository.split("/").pop().toLowerCase().replace(/[^a-z0-9-]+/g,"-");
  const rendered = renderProjectInstructions(template,{
    projectKey,
    repository:state.target_repository,
    controlRepository:state.control_repository,
    sandboxProjectKey:state.sandbox_project_key
  });
  fs.writeFileSync(path.join(generated,"chatgpt-project-instructions.md"),rendered);
  state.project_key = projectKey;
  if (!state.completed.includes("instructions_generated")) state.completed.push("instructions_generated");

  if (!state.instructions_added) {
    saveState(state);
    return emit(action(state,"chatgpt_project_instructions","setup.instructions.add",{generated_file:".generated/chatgpt-project-instructions.md"}));
  }

  if (!state.sandbox_verified) {
    try {
      const sessionScript=path.join(state.control_clone_path,"scripts","start-orchestrator-session.ps1");
      const session=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",sessionScript,
        "-Project",state.sandbox_project_key
      ],{encoding:"utf8"});
      if(session.status!==0){
        throw new Error((session.stderr||session.stdout||"Sandbox session startup failed").trim());
      }

      let smoke=sandboxSmokeStatus(state);
      if(smoke.stage==="NOT_STARTED"){
        const started=startSandboxSmoke(state);
        state.sandbox_smoke_started=true;
        state.sandbox_smoke_issue=started.issue?.url||null;
        saveState(state);
        smoke=sandboxSmokeStatus(state);
      }

      if(smoke.stage==="COMPLETE"){
        state.sandbox_verified=true;
        if(!state.completed.includes("sandbox_verified")) state.completed.push("sandbox_verified");
        saveState(state);
      } else if(smoke.stage==="MERGE_APPROVAL_REQUIRED"){
        saveState(state);
        return emit(action(state,"sandbox_merge_approval","setup.sandbox.merge_approval",{
          sandbox_repository:state.sandbox_repository,
          reviewed_commit:smoke.commit,
          branch:smoke.branch,
          approve_command:"node src/cli.mjs smoke-approve --commit "+smoke.commit+" --yes --json"
        }));
      } else if(smoke.stage==="IMPLEMENTATION_FAILED"){
        state.last_error={error_id:"SANDBOX-002",message:"Sandbox implementation/validation failed",details:smoke,at:new Date().toISOString()};
        saveState(state);
        return emit({status:"ERROR",error_id:"SANDBOX-002",recoverable:true,preferred_language:lang,message:t(lang,"setup.sandbox.failed"),smoke},1);
      } else {
        state.current_step="sandbox_smoke_waiting";
        saveState(state);
        return emit({
          status:"WAITING",
          preferred_language:lang,
          message:t(lang,"setup.sandbox.waiting"),
          smoke,
          note:t(lang,"setup.sandbox.chat_handles_review")
        });
      }
    } catch(error) {
      state.last_error={error_id:"SANDBOX-001",message:String(error.message||error),at:new Date().toISOString()};
      saveState(state);
      return emit({status:"ERROR",error_id:"SANDBOX-001",recoverable:true,preferred_language:lang,message:t(lang,"setup.sandbox.start_failed"),details:String(error.message||error)},1);
    }
  }

  if(!state.target_environment_ready) {
    try {
      if(!state.sandbox_verified) throw new Error("Target project cannot be activated before sandbox verification");

      const activation=activateTargetProject({
        controlClonePath:state.control_clone_path,
        projectKey:state.project_key,
        repository:state.target_repository
      });

      const setupTarget=spawnSafeSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(state.control_clone_path,"scripts","setup-project-clone.ps1"),
        "-Project",state.project_key
      ],{encoding:"utf8"});
      if(setupTarget.status!==0) {
        throw new Error((setupTarget.stderr||setupTarget.stdout||("Target clone/checkpoint setup failed for "+state.project_key)).trim());
      }

      state.target_environment_ready=true;
      state.target_registry_activated=true;
      state.target_activation_changed=Boolean(activation.changed);
      if(!state.completed.includes("target_environment_ready")) state.completed.push("target_environment_ready");
      saveState(state);
    } catch(error) {
      state.last_error={error_id:"SETUP-013",message:String(error.message||error),at:new Date().toISOString()};
      saveState(state);
      return emit({
        status:"ERROR",
        error_id:"SETUP-013",
        recoverable:true,
        preferred_language:lang,
        message:t(lang,"setup.target.activate_failed"),
        details:String(error.message||error)
      },1);
    }
  }

  if(!state.codex_trust_project) {
    return emit(action(state,"codex_trust_project","setup.codex.trust_project",{
      folder:state.project_clone_path,
      helper_command:"node src/cli.mjs codex-open --scope project"
    }));
  }
  if(!state.completed.includes("codex_trust_project")) state.completed.push("codex_trust_project");

  state.current_step="ready";
  state.ready=true;
  if (!state.completed.includes("ready")) state.completed.push("ready");
  saveState(state);
  emit({status:"PASS",preferred_language:lang,message:t(lang,"setup.ready"),project_key:state.project_key,repository:state.target_repository});
}

function codexLogin() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const result=spawnSafeSync("codex",["login"],{stdio:"inherit"});
  const verify=commandExists("codex",["login","status"]);
  if(result.status!==0||!verify.ok){
    return emit({status:"ERROR",error_id:"AUTH-002",recoverable:true,preferred_language:lang,message:t(lang,"codex.login.failed")},1);
  }
  emit({status:"PASS",preferred_language:lang,message:t(lang,"codex.login.success"),resume_command:"node src/cli.mjs resume --json"});
}

function codexOpen() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const scope=valueOf("--scope");
  const folder=scope==="sandbox"?state.sandbox_clone_path:scope==="project"?state.project_clone_path:null;
  if(!folder||!fs.existsSync(folder)){
    return emit({status:"ERROR",error_id:"AUTH-004",recoverable:true,preferred_language:lang,message:t(lang,"codex.folder.missing")},1);
  }
  const result=spawnSafeSync("codex",[],{cwd:folder,stdio:"inherit"});
  emit({
    status:result.status===0?"PASS":"NEEDS_USER_ACTION",
    preferred_language:lang,
    message:t(lang,"codex.trust.after_open"),
    scope,
    folder,
    confirm_command:"node src/cli.mjs answer --action codex_trust_"+scope+" --value true --json"
  },result.status===0?0:0);
}

function smokeStatusCommand() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  try{
    const smoke=sandboxSmokeStatus(state);
    emit({status:smoke.status,preferred_language:lang,message:t(lang,"sandbox.status"),smoke});
  }catch(error){
    emit({status:"ERROR",error_id:"SANDBOX-001",recoverable:true,preferred_language:lang,message:t(lang,"setup.sandbox.start_failed"),details:String(error.message||error)},1);
  }
}

function smokeReviewCommand() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const commit=String(valueOf("--commit")||"").toLowerCase();
  try{
    const result=createSandboxCodeReview(state,{commit});
    emit({status:"PASS",preferred_language:lang,message:t(lang,"sandbox.review.created"),...result});
  }catch(error){
    emit({status:"ERROR",error_id:"SANDBOX-003",recoverable:true,preferred_language:lang,message:t(lang,"sandbox.review.failed"),details:String(error.message||error)},1);
  }
}

function smokeApproveCommand() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const commit=String(valueOf("--commit")||"").toLowerCase();
  const yes=argv.includes("--yes");
  if(!yes){
    return emit({status:"ERROR",error_id:"SANDBOX-004",recoverable:false,preferred_language:lang,message:t(lang,"sandbox.approval.required")},1);
  }
  try{
    const status=sandboxSmokeStatus(state);
    if(status.stage!=="MERGE_APPROVAL_REQUIRED"||status.commit!==commit){
      throw new Error("The requested commit is not the current independently reviewed sandbox commit");
    }
    const result=createSandboxMergeApproval(state,{commit});
    state.sandbox_merge_approved_commit=commit;
    saveState(state);
    emit({status:"PASS",preferred_language:lang,message:t(lang,"sandbox.approval.created"),...result,resume_command:"node src/cli.mjs resume --json"});
  }catch(error){
    emit({status:"ERROR",error_id:"SANDBOX-005",recoverable:true,preferred_language:lang,message:t(lang,"sandbox.approval.failed"),details:String(error.message||error)},1);
  }
}

function githubLogin() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const gh=commandExists("gh");
  if(!gh.ok) return emit({status:"ERROR",error_id:"SETUP-010",recoverable:true,preferred_language:lang,message:t(lang,"github_cli.missing")},1);

  const result=spawnSafeSync("gh",["auth","login","--hostname","github.com","--git-protocol","https","--web"],{
    stdio:"inherit",
  });
  if(result.status!==0){
    return emit({status:"ERROR",error_id:"AUTH-003",recoverable:true,preferred_language:lang,message:t(lang,"github_cli.login.failed")},1);
  }
  const verify=commandExists("gh",["auth","status"]);
  if(!verify.ok){
    return emit({status:"ERROR",error_id:"AUTH-003",recoverable:true,preferred_language:lang,message:t(lang,"github_cli.login.failed")},1);
  }
  emit({status:"PASS",preferred_language:lang,message:t(lang,"github_cli.login.success"),resume_command:"node src/cli.mjs resume --json"});
}

function runtimeChecks(state) {
  const pendingDir=path.join(os.homedir(),".chatgpt-codex-orchestrator","pending-wakes");
  const pendingCallbacks=fs.existsSync(pendingDir)
    ? fs.readdirSync(pendingDir).filter(x=>x.endsWith(".json")).length
    : 0;

  let runnerRunning=false;
  if(process.platform==="win32" && state.runner_path){
    const escaped=String(state.runner_path).replaceAll("'","''");
    const ps=spawnSafeSync("powershell.exe",["-NoProfile","-Command",
      "$root='"+escaped.replaceAll("\\","\\")+"'.TrimEnd('\\')+'\\'; "+
      "$p=@(Get-CimInstance Win32_Process -Filter \"Name='Runner.Listener.exe'\" -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase)}); "+
      "if($p.Count -gt 0){exit 0}else{exit 1}"
    ],{encoding:"utf8"});
    runnerRunning=ps.status===0;
  }

  let browserReady=false;
  const port=Number(state.browser_port||0);
  if(process.platform==="win32" && Number.isInteger(port) && port>0){
    const ps=spawnSafeSync("powershell.exe",["-NoProfile","-Command",
      "try { Invoke-RestMethod -Uri 'http://127.0.0.1:"+port+"/json/version' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
    ],{encoding:"utf8"});
    browserReady=ps.status===0;
  }

  return {
    control_repository:Boolean(state.control_repository),
    control_clone:Boolean(state.control_clone_path&&fs.existsSync(state.control_clone_path)),
    project_clone:Boolean(state.project_clone_path&&fs.existsSync(state.project_clone_path)),
    runner_configured:Boolean(state.runner_path&&fs.existsSync(path.join(state.runner_path,".runner"))),
    runner_running:runnerRunning,
    reviewer_browser:browserReady,
    codex_authenticated:commandExists("codex",["login","status"]).ok,
    pending_callbacks:pendingCallbacks
  };
}

function doctor() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const checks={
    git:commandExists("git").ok,
    node:commandExists("node").ok,
    gh:commandExists("gh").ok,
    github_cli_authenticated:commandExists("gh",["auth","status"]).ok,
    codex:commandExists("codex").ok,
    install_state:fs.existsSync(path.join(stateRoot(),"install-state.json")),
    github_plugin_configured:Boolean(state.github_plugin_authorized),
    github_repository_configured:Boolean(state.target_repository),
    reviewer_chat_configured:Boolean(state.reviewer_chat_url),
    ...runtimeChecks(state)
  };

  let preflight=true;
  let preflightDetails=null;
  if(state.control_environment_ready&&state.control_clone_path&&state.project_key&&process.platform==="win32"){
    const script=path.join(state.control_clone_path,"scripts","preflight.ps1");
    const r=spawnSafeSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",script,"-Project",state.project_key],{encoding:"utf8"});
    preflight=r.status===0;
    preflightDetails=(r.stdout||r.stderr||"").trim()||null;
  }
  checks.runtime_preflight=preflight;

  const booleanChecks=Object.fromEntries(Object.entries(checks).filter(([,v])=>typeof v==="boolean"));
  const healthy=Object.values(booleanChecks).every(Boolean);
  emit({status:healthy?"PASS":"ERROR",error_id:healthy?null:"DOCTOR-001",recoverable:true,preferred_language:lang,message:healthy?t(lang,"doctor.healthy"):t(lang,"doctor.attention"),checks,preflight_details:preflightDetails},healthy?0:1);
}

function status() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  emit({
    status:state.ready?"PASS":"NEEDS_USER_ACTION",
    preferred_language:lang,
    message:state.ready?t(lang,"status.ready"):t(lang,"status.not_ready"),
    current_step:state.current_step||"not_started",
    completed:state.completed||[],
    project_key:state.project_key||null,
    runtime:runtimeChecks(state)
  });
}

function repair() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  if(process.platform!=="win32"||!state.control_environment_ready||!state.control_clone_path||!state.project_key){
    return emit({status:"ERROR",error_id:"REPAIR-001",recoverable:true,preferred_language:lang,message:t(lang,"repair.not_ready"),runtime:runtimeChecks(state)},1);
  }

  const script=path.join(state.control_clone_path,"scripts","start-orchestrator-session.ps1");
  const r=spawnSafeSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",script,"-Project",state.project_key],{encoding:"utf8"});
  if(r.status!==0){
    state.last_error={error_id:"REPAIR-001",message:(r.stderr||r.stdout||"Repair failed").trim(),at:new Date().toISOString()};
    saveState(state);
    return emit({status:"ERROR",error_id:"REPAIR-001",recoverable:true,preferred_language:lang,message:t(lang,"repair.failed"),details:state.last_error.message,runtime:runtimeChecks(state)},1);
  }

  emit({status:"PASS",preferred_language:lang,message:t(lang,"repair.success"),repaired:["runner","reviewer_browser","pending_callbacks","preflight"],runtime:runtimeChecks(state)});
}

function reportProblem() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const report=sanitizeObject({generated_at:new Date().toISOString(),version:productConfig.version||"unknown",release_channel:productConfig.release_channel||null,platform:process.platform,os_release:os.release(),current_step:state.current_step||null,preferred_language:lang,last_error:state.last_error||null,environment:state.environment||null});
  const dir=path.join(stateRoot(),"diagnostics");
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,`diagnostic-${Date.now()}.json`);
  fs.writeFileSync(file,JSON.stringify(report,null,2));
  emit({status:"PASS",preferred_language:lang,message:t(lang,"report.prepared"),report_file:file,preview:report,uploaded:false,consent_required_before_upload:true});
}

function submitReport() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const file=valueOf("--file");
  const consent=/^(true|yes|y|1)$/i.test(String(valueOf("--consent")||""));
  const feedbackRepository=process.env.ORCHESTRATOR_FEEDBACK_REPOSITORY||productConfig.feedback_repository||"";
  if(!consent){
    return emit({status:"ERROR",error_id:"REPORT-001",recoverable:false,preferred_language:lang,message:t(lang,"report.consent.required"),uploaded:false},1);
  }
  if(!file||!fs.existsSync(file)){
    return emit({status:"ERROR",error_id:"REPORT-002",recoverable:true,preferred_language:lang,message:t(lang,"report.file.missing"),uploaded:false},1);
  }
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(feedbackRepository)){
    return emit({status:"ERROR",error_id:"REPORT-003",recoverable:true,preferred_language:lang,message:t(lang,"report.destination.missing"),uploaded:false},1);
  }
  try{
    const result=submitDiagnosticReport({file,repository:feedbackRepository});
    emit({status:"PASS",preferred_language:lang,message:t(lang,"report.submitted"),uploaded:true,url:result.url||null});
  }catch(error){
    emit({status:"ERROR",error_id:"REPORT-004",recoverable:true,preferred_language:lang,message:t(lang,"report.submit.failed"),details:String(error.message||error),uploaded:false},1);
  }
}

if (command==="dry-run") dryRun();
else if (command==="setup"||command==="resume") runSetup();
else if (command==="github-login") githubLogin();
else if (command==="codex-login") codexLogin();
else if (command==="codex-open") codexOpen();
else if (command==="smoke-status") smokeStatusCommand();
else if (command==="smoke-review") smokeReviewCommand();
else if (command==="smoke-approve") smokeApproveCommand();
else if (command==="doctor") doctor();
else if (command==="status") status();
else if (command==="repair") repair();
else if (command==="report-problem") reportProblem();
else if (command==="submit-report") submitReport();
else if (command==="answer") answer();
else if (command==="errors") emit({status:"PASS",errors:ERROR_CATALOG});
else emit({status:"PASS",message:"Commands: dry-run, setup, resume, answer, github-login, codex-login, codex-open, smoke-status, smoke-review, smoke-approve, doctor, status, repair, report-problem, submit-report, errors"});
