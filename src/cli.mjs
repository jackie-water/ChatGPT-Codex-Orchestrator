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

  if (actionId === "github_authorization") {
    if (!bool(value)) return emit({status:"ERROR",error_id:"AUTH-001",recoverable:true,preferred_language:lang,message:t(lang,"answer.github.invalid")},1);
    state.github_authorized = true;
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
  const codex = commandExists("codex");
  state.environment = { platform:process.platform, release:os.release(), git:git.output||null, node:node.output||null, codex:codex.output||null };

  if (!git.ok || !node.ok || !codex.ok) {
    saveState(state);
    return emit({
      status:"ERROR", error_id:"SETUP-004", recoverable:true, preferred_language:lang,
      message:t(lang,"setup.prerequisites.failed"),
      missing:{git:!git.ok,node:!node.ok,codex:!codex.ok}
    },1);
  }
  if (!state.completed.includes("environment_check")) state.completed.push("environment_check");

  if (!state.github_authorized) return emit(action(state,"github_authorization","setup.github.connect"));
  if (!state.completed.includes("github_authorization")) state.completed.push("github_authorization");

  if (!state.target_repository) return emit(action(state,"target_repository","setup.repository.ask"));
  if (!state.completed.includes("target_repository")) state.completed.push("target_repository");

  if (!state.reviewer_chat_url) return emit(action(state,"reviewer_chat_url","setup.chat.ask"));
  if (!state.completed.includes("reviewer_chat_url")) state.completed.push("reviewer_chat_url");

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

function doctor() {
  const state=loadState();
  const lang=ensureStateLanguage(state);
  const checks={
    git:commandExists("git").ok,
    node:commandExists("node").ok,
    codex:commandExists("codex").ok,
    install_state:fs.existsSync(path.join(stateRoot(),"install-state.json")),
    github_configured:Boolean(state.github_authorized&&state.target_repository),
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
  emit({status:"PASS",preferred_language:lang,message:t(lang,"report.prepared"),report_file:file,uploaded:false,consent_required_before_upload:true});
}

if (command==="setup"||command==="resume") runSetup();
else if (command==="doctor") doctor();
else if (command==="status") status();
else if (command==="repair") repair();
else if (command==="report-problem") reportProblem();
else if (command==="answer") answer();
else if (command==="errors") emit({status:"PASS",errors:ERROR_CATALOG});
else emit({status:"PASS",message:"Commands: setup, resume, answer, doctor, status, repair, report-problem, errors"});
