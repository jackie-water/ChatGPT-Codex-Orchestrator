#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CALLBACK = /^[A-Za-z0-9._-]{1,160}$/;
const TRUSTED_TERMINAL_PROOFS = new Set(["committed-user-turn", "existing-user-message"]);
const DELIVERY_TIMEOUT_MS = 130000;
const DELIVERY_CLEANUP_CUSHION_MS = 10000;
const DELIVERY_SPAWN_TIMEOUT_MS = DELIVERY_TIMEOUT_MS + DELIVERY_CLEANUP_CUSHION_MS;
const usage = "Usage: register-chat.mjs (--event-path FILE | --recover) --control-root DIR --trusted-github-username USER[,USER...] [--deliver]";
function fail(message) { throw new Error(message); }
function args(argv) {
  const out = {trusted: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--deliver") out.deliver = true;
    else if (a === "--recover") out.recover = true;
    else if (["--event-path", "--control-root", "--trusted-github-username"].includes(a)) {
      const v = argv[++i]; if (!v) fail(usage); if (a === "--trusted-github-username") out.trusted.push(...v.split(",")); else out[a.slice(2).replaceAll("-", "_")] = v;
    } else fail(usage);
  }
  if ((!out.event_path && !out.recover) || (out.event_path && out.recover) || !out.control_root || !out.trusted.length) fail(usage);
  return out;
}
function safePath(p, {allowMissing = false} = {}) {
  const absolute = path.resolve(p);
  const parts = absolute.split(path.sep); let current = parts[0] || path.sep;
  for (const part of parts.slice(1)) {
    if (!part) continue; current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail(`Unsafe symlink path: ${current}`); }
    catch (e) { if (e.code === "ENOENT" && allowMissing) break; throw e; }
  }
  return absolute;
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(safePath(file), "utf8").replace(/^\uFEFF/, "")); } catch { fail(`Unreadable JSON: ${file}`); } }
function chatUrl(value) {
  try { const u = new URL(String(value)); if (u.origin !== "https://chatgpt.com" || !/^\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]+\/?$/.test(u.pathname)) fail("chat_url must be a full ChatGPT conversation URL"); return `${u.origin}${u.pathname}`.replace(/\/$/, ""); }
  catch { fail("chat_url must be a full ChatGPT conversation URL"); }
}
function mkdirSafe(dir) { safePath(dir, {allowMissing:true}); fs.mkdirSync(dir, {recursive:true, mode:0o700}); }
function atomic(file, value) { const dir = path.dirname(file); mkdirSafe(dir); safePath(file, {allowMissing:true}); if (fs.existsSync(file)) { const s = fs.lstatSync(file); if (!s.isFile() || s.nlink !== 1) fail(`Unsafe registration file: ${file}`); } const tmp = `${file}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`; const fd = fs.openSync(tmp, "wx", 0o600); try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, file); const d = fs.openSync(dir, "r"); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } }
function withLock(file, fn) { const lock = `${file}.lock`; mkdirSafe(path.dirname(lock)); let fd; try { fd = fs.openSync(lock, "wx", 0o600); } catch (e) { if (e.code === "EEXIST") fail(`Chat registration lock is occupied: ${lock}; inspect and remove it only after deterministic crash recovery`); throw e; } try { return fn(); } finally { fs.closeSync(fd); fs.rmSync(lock); } }
function privatePath(file, {directory = false} = {}) {
  safePath(file);
  const stat = fs.lstatSync(file);
  if (stat.uid !== process.getuid() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) fail(`Untrusted registration path: ${file}`);
}
function ownedMetadata(file) {
  safePath(file); const stat = fs.lstatSync(file);
  // actions/checkout materializes tracked metadata as 0644. It contains no
  // secrets; reject writable or aliased metadata without chmodding the clone.
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o022)) fail(`Untrusted Control metadata: ${file}`);
}
function privateTree(base, home) {
  const resolvedHome = safePath(home); let cursor = safePath(base);
  if (!cursor.startsWith(resolvedHome + path.sep)) fail("Registration instance must be below HOME");
  while (cursor !== resolvedHome) { privatePath(cursor, {directory:true}); cursor = path.dirname(cursor); }
  const stat = fs.lstatSync(resolvedHome);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o022)) fail("Registration HOME is unsafe");
}
function digest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function callbackMatches(state, {callbackId, chat, message}, strict) {
  if (state.callback_id !== callbackId || state.chat_url !== chat || state.message !== message || state.routing_version !== "explicit-route-v1" ||
      !["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"].includes(state.delivery_state) ||
      (strict && state.delivery_owner !== "register-chat.mjs")) fail("Callback outbox conflict");
}
export function registerChat({argv = process.argv.slice(2), home = os.homedir(), env = process.env, spawn = spawnSync, log = console.log} = {}) {
  const a = args(argv); const control = safePath(a.control_root);
  const instance = readJson(path.join(control, "instance.json")); if (!ID.test(instance.instance_id)) fail("Invalid orchestrator instance_id");
  const base = path.join(home, ".chatgpt-codex-orchestrator", "instances", instance.instance_id); safePath(base, {allowMissing:true});
  const routesFile = path.join(base, "chat-routes.json"); const pending = path.join(base, "pending-wakes"); const intents = path.join(base, "registration-intents");
  const delivery = path.join(base, "registration-delivery");
  const mac = instance.platform === "darwin" || env.RUNNER_OS === "macOS";
  if (!["darwin", "win32"].includes(instance.platform)) fail("Registration instance platform is missing or unsupported");
  if (mac) {
    if (!a.recover && !a.deliver) fail("macOS CHAT-REGISTER requires its canonical --deliver owner; a queued draft is not registration success");
    // Public Control metadata pins only the selected private instance. Never
    // enumerate, chmod, adopt or recover an historical instance directory.
    if (instance.platform !== "darwin" || instance.arch !== "arm64" || !ID.test(instance.installation_id) || instance.instance_root !== base ||
        instance.chat_route_file !== routesFile || instance.pending_wake_outbox !== pending ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(instance.control_repository || "")) ||
        !/^[1-9][0-9]*$/.test(String(instance.control_repository_id || "")) ||
        !ID.test(instance.runner_label) || instance.browser_profile !== path.join(base,"browser-profile") ||
        !Number.isInteger(instance.browser_port) || instance.browser_port < 1024 || instance.browser_port > 65535) fail("Pinned macOS registration identity is incomplete");
    if (env.RUNNER_OS !== "macOS" || env.RUNNER_ARCH !== "ARM64" || env.RUNNER_NAME !== instance.runner_label) fail("CHAT-REGISTER requires the matching named macOS ARM64 self-hosted Runner");
    privateTree(base, home); privatePath(instance.browser_profile, {directory:true}); ownedMetadata(path.join(control, "instance.json"));
    if (fs.existsSync(routesFile)) privatePath(routesFile);
    for (const dir of [pending, intents, delivery]) { mkdirSafe(dir); privatePath(dir, {directory:true}); }
  }
  function replayIntent(file) {
    const intent = readJson(file); if (intent.version !== 1 || !ID.test(intent.project) || !ID.test(intent.route) || !CALLBACK.test(intent.callback_id)) fail("Malformed registration intent");
    if (intent.route_record?.route !== intent.route || intent.route_record?.project !== intent.project || intent.route_record?.chat_url !== chatUrl(intent.chat_url)) fail("Registration intent route identity mismatch");
    callbackMatches(intent.outbox, {callbackId:intent.callback_id, chat:intent.chat_url, message:intent.message}, mac);
    if (mac) {
      privatePath(file);
      if (intent.installation_id !== instance.installation_id || intent.control_repository_id !== String(instance.control_repository_id) ||
          intent.route_record?.registration_issue === 409 && (intent.project === "orchestrator-dev" || intent.route_record?.installation_id !== instance.installation_id) ||
          intent.outbox?.delivery_owner !== "register-chat.mjs") fail("Historical or foreign registration intent is not authority");
    }
    const registry = fs.existsSync(routesFile) ? readJson(routesFile) : {version:1, routes:[]}; if (registry.version !== 1 || !Array.isArray(registry.routes)) fail("Malformed chat route registry");
    const collision = registry.routes.find(x => x.route === intent.route); if (collision && (String(collision.project).toLowerCase() !== intent.project || collision.chat_url !== intent.chat_url)) fail(`Chat route collision for ${intent.route}`);
    if (!collision) { registry.routes.push(intent.route_record); atomic(routesFile, {version:1, routes:registry.routes}); }
    const outbox = path.join(pending, `${intent.callback_id}.json`);
    if (fs.existsSync(outbox)) { const state = readJson(outbox); if (state.callback_id !== intent.callback_id || state.chat_url !== intent.chat_url || state.message !== intent.message || state.routing_version !== "explicit-route-v1") fail("Callback outbox conflict"); }
    else atomic(outbox, intent.outbox);
    fs.rmSync(file); return readJson(outbox);
  }
  if (a.recover) { const report = []; withLock(routesFile, () => { mkdirSafe(intents); for (const name of fs.readdirSync(intents)) if (name.endsWith(".json")) report.push(replayIntent(path.join(intents, name))); }); for (const state of report) log(`CHAT_ROUTE_RECOVERED callback_id=${state.callback_id} delivery_state=${state.delivery_state}`); return; }
  const event = readJson(a.event_path);
  const projects = readJson(path.join(control, "projects.json")); if (!projects.projects || typeof projects.projects !== "object") fail("Malformed project registry");
  const author = event?.issue?.user?.login; if (typeof author !== "string" || !a.trusted.includes(author)) fail("Untrusted chat registration author");
  const number = Number(event?.issue?.number); if (!Number.isInteger(number) || number < 1) fail("Registration issue number is invalid");
  let req; try { req = JSON.parse(String(event.issue.body)); } catch { fail("Chat registration body must be valid JSON"); }
  const project = String(req?.project || "").toLowerCase(); if (!project) fail("project is required"); if (!Object.prototype.hasOwnProperty.call(projects.projects, project)) fail(`Unknown project: ${project}`);
  if (mac) {
    if (number === 409 && project === "orchestrator-dev") fail("Obsolete manual registration #409 cannot be replayed; a new Chat must register separately");
    if (event.action !== "opened" || event.issue.state !== "open" || !String(event.issue.title || "").startsWith("[CHAT-REGISTER]") ||
        req.installation_id !== instance.installation_id || event.repository?.full_name !== instance.control_repository ||
        String(event.repository?.id || "") !== String(instance.control_repository_id) || !a.trusted.includes(instance.trusted_github_username) || author !== instance.trusted_github_username) fail("macOS registration event identity is not an authorized open installation request");
  }
  const normalized = chatUrl(req.chat_url);
  let result;
  withLock(routesFile, () => { let registry = {version:1, routes:[]}; if (fs.existsSync(routesFile)) registry = readJson(routesFile); if (registry.version !== 1 || !Array.isArray(registry.routes)) fail("Malformed chat route registry");
    let record = registry.routes.find(x => String(x.project).toLowerCase() === project && x.chat_url === normalized && x.status === "active");
    const route = `chat-${number}`; const collision = registry.routes.find(x => x.route === route); if (collision && (String(collision.project).toLowerCase() !== project || collision.chat_url !== normalized)) fail(`Chat route collision for ${route}`); record = record || collision || {route, project, chat_url:normalized, status:"active", registration_issue:number, ...(mac ? {installation_id:instance.installation_id} : {}), registered_at_utc:new Date().toISOString().replace(/\.\d{3}Z$/, "Z")};
    if (mac && (record.installation_id !== instance.installation_id || record.registration_issue !== number)) fail("Historical registration route is not authority for this request");
    const callbackId = `chat-register-${project}-${number}`; if (!CALLBACK.test(callbackId)) fail("Invalid callback ID"); const message = `[CHAT-ROUTE-REGISTERED callback_id=${callbackId}] Registration complete for project '${project}'. This Chat's review_route is '${record.route}'. Use this exact route for every future CODEX-RUN, CODE-REVIEW, and MERGE-APPROVE created from this conversation. Do not substitute another Chat route. If work moves to another Chat, register that Chat separately.`;
    const file = path.join(pending, `${callbackId}.json`); let state;
    if (fs.existsSync(file)) {
      if (mac) privatePath(file);
      state = readJson(file); callbackMatches(state, {callbackId, chat:normalized, message}, mac);
    } else {
      state = {routing_version:"explicit-route-v1", delivery_state:"PENDING", callback_id:callbackId, chat_url:normalized, message, ...(mac ? {delivery_owner:"register-chat.mjs"} : {}), queued_at_utc:new Date().toISOString()};
      const intent = path.join(intents, `${callbackId}.json`);
      atomic(intent, {version:1, project, route:record.route, chat_url:normalized, callback_id:callbackId, message, ...(mac ? {installation_id:instance.installation_id, control_repository_id:String(instance.control_repository_id)} : {}), route_record:record, outbox:state});
      state = replayIntent(intent);
    }
    result = {project, route:record.route, callbackId, file, state, message};
  });
  if (a.deliver) {
    withLock(`${result.file}.delivery`, () => {
      result.state = readJson(result.file);
      callbackMatches(result.state, {callbackId:result.callbackId, chat:normalized, message:result.message}, mac);
      const journalFile = path.join(delivery, `${result.callbackId}.json`);
      let prior = null;
      if (mac && fs.existsSync(journalFile)) {
        privatePath(journalFile); prior = readJson(journalFile);
        if (prior.callback_id !== result.callbackId || prior.chat_url !== normalized || prior.message_sha256 !== crypto.createHash("sha256").update(result.state.message).digest("hex")) fail("Registration delivery journal conflict");
      }
      const terminal = result.state.delivery_state === "DELIVERED" && TRUSTED_TERMINAL_PROOFS.has(result.state.verified_by);
      if (terminal && !mac) {
        log(`CHAT_ROUTE_ALREADY_DELIVERED callback_id=${result.callbackId} verified_by=${result.state.verified_by}`); return;
      }
      const reconcile = Boolean(prior) || ["DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"].includes(result.state.delivery_state);
      const journal = {schema_version:1, callback_id:result.callbackId, chat_url:normalized, message_sha256:crypto.createHash("sha256").update(result.state.message).digest("hex"), delivery_owner:"register-chat.mjs", status:"ATTEMPTING", reconcile_only:reconcile, attempted_at_utc:new Date().toISOString()};
      // Journal BEFORE calling the only delivery owner. A crash or timeout
      // leaves reconciliation-only authority; it can never authorize Send twice.
      if (mac) atomic(journalFile, journal);
      const childEnv = {...env, ORCHESTRATOR_CHAT_URL:normalized, CODEX_CALLBACK_ID:result.callbackId, CODEX_CALLBACK_STATE_FILE:result.file, CODEX_CALLBACK_EXPECTED_FINGERPRINT:digest(result.file), CODEX_WAKE_DEADLINE_MS:String(DELIVERY_TIMEOUT_MS)};
      if (mac) childEnv.ORCHESTRATOR_BROWSER_DEBUG_PORT = String(instance.browser_port);
      if (reconcile) childEnv.CODEX_RECONCILE_ONLY = "1"; else delete childEnv.CODEX_RECONCILE_ONLY;
      const wake = path.join(import.meta.dirname, "wake-chat.mjs");
      const previousUmask = process.umask(0o077);
      let r;
      try { r = spawn(process.execPath, [wake, result.state.message], {env:childEnv, encoding:"utf8", timeout:DELIVERY_SPAWN_TIMEOUT_MS, killSignal:"SIGKILL"}); }
      catch (error) { r = {status:null, error}; }
      finally { process.umask(previousUmask); }
      let failure;
      try {
        if (mac) privatePath(result.file);
        const final = readJson(result.file);
        callbackMatches(final, {callbackId:result.callbackId, chat:normalized, message:result.state.message}, mac);
        if (r.error?.code === "ETIMEDOUT") fail("Registration queued but delivery reconciliation timed out");
        if (r.status !== 0 || final.delivery_state !== "DELIVERED" || !TRUSTED_TERMINAL_PROOFS.has(final.verified_by) ||
            mac && !/(?:CHAT_WAKE_ALREADY_DELIVERED:|CHAT_WAKE_CONFIRMED:)/.test(String(r.stdout || ""))) fail("Registration queued but real user-role delivery was not verified");
        result.state = final;
        if (mac) atomic(journalFile, {...journal, status:"DELIVERED", verified_role:"user", verified_by:final.verified_by, callback_state_sha256:digest(result.file), verified_at_utc:new Date().toISOString()});
      } catch (error) { failure = error; }
      if (failure) {
        if (mac) atomic(journalFile, {...journal, status:"ERROR", reconcile_only:true, error:failure.message, failed_at_utc:new Date().toISOString()});
        throw failure;
      }
    });
  }
  log(`CHAT_ROUTE_REGISTERED project=${result.project} route=${result.route} callback_id=${result.callbackId} delivery_state=${result.state.delivery_state}`);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { registerChat(); } catch (e) { console.error(`REGISTER_CHAT_FAILED: ${e.message}`); process.exitCode = 1; }
}
