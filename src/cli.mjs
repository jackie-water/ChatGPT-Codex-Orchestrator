#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadState, saveState, stateRoot } from "./lib/state.mjs";
import { t, normalizeLanguage } from "./lib/i18n.mjs";
import { ERROR_CATALOG } from "./lib/errors.mjs";
import { sanitizeObject } from "./lib/sanitize.mjs";
import { submitDiagnosticReport } from "./lib/reporting.mjs";
import { prepareControlEnvironment } from "./lib/control-env.mjs";

const argv = process.argv.slice(2);
const command = argv[0] || "help";
const wantsJson = argv.includes("--json");

function valueOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function emit(payload, code = 0) {
  if (wantsJson) process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  else {
    console.log(payload.message || payload.status || "");
    if (payload.details) console.log(payload.details);
  }
  process.exitCode = code;
}

function commandExists(name, args = ["--version"]) {
  const result = spawnSync(name, args, { encoding: "utf8", shell: process.platform === "win32" });
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
  } else if (actionId === "codex_ready") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-002",recoverable:true,preferred_language:lang,message:t(lang,"answer.codex.invalid")},1);
    state.codex_ready = true;
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
        runner_path:control.runner_path,
        runner_label:control.runner_label,
        config_path:control.config_path,
        browser_port:control.browser_port,
        browser_profile:control.browser_profile
      });

      const setupClone=spawnSync("powershell.exe",[
        "-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(control.control_clone_path,"scripts","setup-project-clone.ps1"),
        "-Project",control.project_key
      ],{encoding:"utf8"});
      if(setupClone.status!==0) throw new Error((setupClone.stderr||setupClone.stdout||"Project clone/checkpoint setup failed").trim());

      const runnerInstall=spawnSync("powershell.exe",[
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

  const codexLogin=commandExists("codex",["login","status"]);
  if(!codexLogin.ok || !state.codex_ready) {
    return emit(action(state,"codex_ready","setup.codex.ready",{
      project_clone_path:state.project_clone_path,
      helper_instruction:t(lang,"setup.codex.helper")
    }));
  }
  if(!state.completed.includes("codex_ready")) state.completed.push("codex_ready");

  if(!state.reviewer_browser_ready) {
    return emit(action(state,"reviewer_browser_login","setup.browser.login",{
      helper_script:path.join(state.control_clone_path,"scripts","start-reviewer-browser.ps1"),
      reviewer_chat_url:state.reviewer_chat_url
    }));
  }
  if(!state.completed.includes("reviewer_browser_login")) state.completed.push("reviewer_browser_login");

  const generated = path.resolve(".generated");
  fs.mkdirSync(generated,{recursive:true});
  const templateName = lang === "zh-CN" ? "chatgpt-project-instructions.zh-CN.md" : "chatgpt-project-instructions.md";
  const template = fs.readFileSync(path.resolve("templates",templateName),"utf8");
  const projectKey = state.project_key || state.target_repository.split("/").pop().toLowerCase().replace(/[^a-z0-9-]+/g,"-");
  const rendered = template.replaceAll("{{PROJECT_KEY}}",projectKey).replaceAll("{{REPOSITORY}}",state.target_repository);
  fs.writeFileSync(path.join(generated,"chatgpt-project-instructions.md"),rendered);
  state.project_key = projectKey;
  if (!state.completed.includes("instructions_generated")) state.completed.push("instructions_generated");

  if (!state.instructions_added) {
    saveState(state);
    return emit(action(state,"chatgpt_project_instructions","setup.instructions.add",{generated_file:".generated/chatgpt-project-instructions.md"}));
  }

  if (!state.sandbox_verified) {
    saveState(state);
    return emit(action(state,"sandbox_verification","setup.sandbox.required"));
  }

  state.current_step="ready";
  state.ready=true;
  if (!state.completed.includes("ready")) state.completed.push("ready");
  saveState(state);
  emit({status:"PASS",preferred_language:lang,message:t(lang,"setup.ready"),project_key:state.project_key,repository:state.target_repository});
}

function githubLogin() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const gh=commandExists("gh");
  if(!gh.ok) return emit({status:"ERROR",error_id:"SETUP-010",recoverable:true,preferred_language:lang,message:t(lang,"github_cli.missing")},1);

  const result=spawnSync("gh",["auth","login","--hostname","github.com","--git-protocol","https","--web"],{
    stdio:"inherit",
    shell:process.platform==="win32"
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
    reviewer_chat_configured:Boolean(state.reviewer_chat_url)
  };
  const healthy=Object.values(checks).every(Boolean);
  emit({status:healthy?"PASS":"ERROR",error_id:healthy?null:"DOCTOR-001",recoverable:true,preferred_language:lang,message:healthy?t(lang,"doctor.healthy"):t(lang,"doctor.attention"),checks},healthy?0:1);
}

function status() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  emit({status:state.ready?"PASS":"NEEDS_USER_ACTION",preferred_language:lang,message:state.ready?t(lang,"status.ready"):t(lang,"status.not_ready"),current_step:state.current_step||"not_started",completed:state.completed||[],project_key:state.project_key||null});
}

function repair() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  emit({status:"PASS",preferred_language:lang,message:t(lang,"repair.baseline"),repaired:[],note:"Runtime callback/runner repair adapters are added in the next integration phase."});
}

function reportProblem() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const report=sanitizeObject({generated_at:new Date().toISOString(),version:"0.1.0-dev",platform:process.platform,os_release:os.release(),current_step:state.current_step||null,preferred_language:lang,last_error:state.last_error||null,environment:state.environment||null});
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
  const feedbackRepository=process.env.ORCHESTRATOR_FEEDBACK_REPOSITORY||"";
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

if (command==="setup"||command==="resume") runSetup();
else if (command==="github-login") githubLogin();
else if (command==="doctor") doctor();
else if (command==="status") status();
else if (command==="repair") repair();
else if (command==="report-problem") reportProblem();
else if (command==="submit-report") submitReport();
else if (command==="answer") answer();
else if (command==="errors") emit({status:"PASS",errors:ERROR_CATALOG});
else emit({status:"PASS",message:"Commands: setup, resume, answer, github-login, doctor, status, repair, report-problem, submit-report, errors"});
