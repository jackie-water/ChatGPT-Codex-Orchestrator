#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CALLBACK = /^[A-Za-z0-9._-]{1,160}$/;
const TRUSTED_TERMINAL_PROOFS = new Set(["committed-user-turn", "existing-user-message"]);
const usage = "Usage: register-chat.mjs (--event-path FILE | --recover) --control-root DIR --trusted-github-username USER[,USER...] [--deliver]";
function fail(message) { throw new Error(message); }
function args() {
  const out = {trusted: []};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--deliver") out.deliver = true;
    else if (a === "--recover") out.recover = true;
    else if (["--event-path", "--control-root", "--trusted-github-username"].includes(a)) {
      const v = process.argv[++i]; if (!v) fail(usage); if (a === "--trusted-github-username") out.trusted.push(...v.split(",")); else out[a.slice(2).replaceAll("-", "_")] = v;
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
function mkdirSafe(dir) { safePath(dir, {allowMissing:true}); fs.mkdirSync(dir, {recursive:true, mode:0o700}); fs.chmodSync(dir, 0o700); }
function atomic(file, value) { const dir = path.dirname(file); mkdirSafe(dir); const tmp = `${file}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`; const fd = fs.openSync(tmp, "wx", 0o600); try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, file); const d = fs.openSync(dir, "r"); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } }
function withLock(file, fn) { const lock = `${file}.lock`; mkdirSafe(path.dirname(lock)); let fd; try { fd = fs.openSync(lock, "wx", 0o600); } catch (e) { if (e.code === "EEXIST") fail(`Chat registration lock is occupied: ${lock}; inspect and remove it only after deterministic crash recovery`); throw e; } try { return fn(); } finally { fs.closeSync(fd); fs.rmSync(lock); } }
function main() {
  const a = args(); const control = safePath(a.control_root);
  const instance = readJson(path.join(control, "instance.json")); if (!ID.test(instance.instance_id)) fail("Invalid orchestrator instance_id");
  const base = path.join(os.homedir(), ".chatgpt-codex-orchestrator", "instances", instance.instance_id); safePath(base, {allowMissing:true});
  const routesFile = path.join(base, "chat-routes.json"); const pending = path.join(base, "pending-wakes"); const intents = path.join(base, "registration-intents");
  function replayIntent(file) {
    const intent = readJson(file); if (intent.version !== 1 || !ID.test(intent.project) || !ID.test(intent.route) || !CALLBACK.test(intent.callback_id)) fail("Malformed registration intent");
    const registry = fs.existsSync(routesFile) ? readJson(routesFile) : {version:1, routes:[]}; if (registry.version !== 1 || !Array.isArray(registry.routes)) fail("Malformed chat route registry");
    const collision = registry.routes.find(x => x.route === intent.route); if (collision && (String(collision.project).toLowerCase() !== intent.project || collision.chat_url !== intent.chat_url)) fail(`Chat route collision for ${intent.route}`);
    if (!collision) { registry.routes.push(intent.route_record); atomic(routesFile, {version:1, routes:registry.routes}); }
    const outbox = path.join(pending, `${intent.callback_id}.json`);
    if (fs.existsSync(outbox)) { const state = readJson(outbox); if (state.callback_id !== intent.callback_id || state.chat_url !== intent.chat_url || state.message !== intent.message || state.routing_version !== "explicit-route-v1") fail("Callback outbox conflict"); }
    else atomic(outbox, intent.outbox);
    fs.rmSync(file); return readJson(outbox);
  }
  if (a.recover) { const report = []; withLock(routesFile, () => { mkdirSafe(intents); for (const name of fs.readdirSync(intents)) if (name.endsWith(".json")) report.push(replayIntent(path.join(intents, name))); }); for (const state of report) console.log(`CHAT_ROUTE_RECOVERED callback_id=${state.callback_id} delivery_state=${state.delivery_state}`); return; }
  const event = readJson(a.event_path);
  const projects = readJson(path.join(control, "projects.json")); if (!projects.projects || typeof projects.projects !== "object") fail("Malformed project registry");
  const author = event?.issue?.user?.login; if (typeof author !== "string" || !a.trusted.includes(author)) fail("Untrusted chat registration author");
  const number = Number(event?.issue?.number); if (!Number.isInteger(number) || number < 1) fail("Registration issue number is invalid");
  let req; try { req = JSON.parse(String(event.issue.body)); } catch { fail("Chat registration body must be valid JSON"); }
  const project = String(req?.project || "").toLowerCase(); if (!project) fail("project is required"); if (!Object.prototype.hasOwnProperty.call(projects.projects, project)) fail(`Unknown project: ${project}`);
  const normalized = chatUrl(req.chat_url);
  let result;
  withLock(routesFile, () => { let registry = {version:1, routes:[]}; if (fs.existsSync(routesFile)) registry = readJson(routesFile); if (registry.version !== 1 || !Array.isArray(registry.routes)) fail("Malformed chat route registry");
    let record = registry.routes.find(x => String(x.project).toLowerCase() === project && x.chat_url === normalized && x.status === "active");
    const route = `chat-${number}`; const collision = registry.routes.find(x => x.route === route); if (collision && (String(collision.project).toLowerCase() !== project || collision.chat_url !== normalized)) fail(`Chat route collision for ${route}`); record = record || collision || {route, project, chat_url:normalized, status:"active", registration_issue:number, registered_at_utc:new Date().toISOString().replace(/\.\d{3}Z$/, "Z")};
    const callbackId = `chat-register-${project}-${number}`; if (!CALLBACK.test(callbackId)) fail("Invalid callback ID"); const message = `[CHAT-ROUTE-REGISTERED callback_id=${callbackId}] Registration complete for project '${project}'. This Chat's review_route is '${record.route}'. Use this exact route for every future CODEX-RUN, CODE-REVIEW, and MERGE-APPROVE created from this conversation. Do not substitute another Chat route. If work moves to another Chat, register that Chat separately.`;
    const file = path.join(pending, `${callbackId}.json`); let state; if (fs.existsSync(file)) { state = readJson(file); if (state.callback_id !== callbackId || state.chat_url !== normalized || state.message !== message || state.routing_version !== "explicit-route-v1") fail("Callback outbox conflict"); } else { state = {routing_version:"explicit-route-v1", delivery_state:"PENDING", callback_id:callbackId, chat_url:normalized, message, queued_at_utc:new Date().toISOString()}; const intent = path.join(intents, `${callbackId}.json`); atomic(intent, {version:1, project, route:record.route, chat_url:normalized, callback_id:callbackId, message, route_record:record, outbox:state}); state = replayIntent(intent); }
    result = {project, route:record.route, callbackId, file, state};
  });
  if (a.deliver) {
    if (result.state.delivery_state === "DELIVERED" && TRUSTED_TERMINAL_PROOFS.has(result.state.verified_by)) {
      console.log(`CHAT_ROUTE_ALREADY_DELIVERED callback_id=${result.callbackId} verified_by=${result.state.verified_by}`);
    } else {
      const fingerprint = crypto.createHash("sha256").update(fs.readFileSync(result.file)).digest("hex"); const env = {...process.env, ORCHESTRATOR_CHAT_URL:normalized, CODEX_CALLBACK_ID:result.callbackId, CODEX_CALLBACK_STATE_FILE:result.file, CODEX_CALLBACK_EXPECTED_FINGERPRINT:fingerprint}; if (["DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"].includes(result.state.delivery_state)) env.CODEX_RECONCILE_ONLY = "1"; else delete env.CODEX_RECONCILE_ONLY; const wake = path.join(import.meta.dirname, "wake-chat.mjs"); const r = spawnSync(process.execPath, [wake, result.state.message], {env, encoding:"utf8", timeout:150000, killSignal:"SIGTERM"}); const final = readJson(result.file); if (r.error?.code === "ETIMEDOUT") fail("Registration queued but delivery reconciliation timed out"); if (r.status !== 0 || final.delivery_state !== "DELIVERED" || !TRUSTED_TERMINAL_PROOFS.has(final.verified_by)) fail(`Registration queued but delivery was not verified${r.stderr ? `: ${r.stderr.trim()}` : ""}`); result.state = final;
    }
  }
  console.log(`CHAT_ROUTE_REGISTERED project=${result.project} route=${result.route} callback_id=${result.callbackId} delivery_state=${result.state.delivery_state}`);
}
try { main(); } catch (e) { console.error(`REGISTER_CHAT_FAILED: ${e.message}`); process.exitCode = 1; }
