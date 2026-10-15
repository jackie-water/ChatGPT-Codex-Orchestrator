import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const FAILURE_STAGES = new Set(["preflight", "git", "codex", "validation", "publish", "timeout", "cancel", "unknown"]);
export const DELIVERY_STATES = new Set(["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"]);
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const IMMUTABLE = ["project", "issue", "iteration", "stage", "code", "source_commit", "exit_code", "callback_id", "chat_url", "message"];
const TRUSTED_DELIVERY = new Set(["committed-user-turn", "existing-user-message"]);

export function canonicalDeliveryState(state) {
  const value = state?.delivery_state;
  if (!DELIVERY_STATES.has(value)) throw new Error("Invalid failure delivery state");
  return value;
}

export function hasTrustedDeliveryProof(state) {
  return canonicalDeliveryState(state) === "DELIVERED" && TRUSTED_DELIVERY.has(state?.verified_by);
}

export function safeChatUrl(value) {
  try { const u = new URL(String(value)); if (u.origin !== "https://chatgpt.com" || !/^\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]+\/?$/.test(u.pathname)) throw 0; return `${u.origin}${u.pathname}`.replace(/\/$/, ""); } catch { throw new Error("Malformed Chat URL"); }
}
export function sanitizeCode(value) { if (typeof value !== "string" || !CODE.test(value)) throw new Error("Invalid safe error code"); return value; }
function safePath(p, allowMissing = false) { const a = path.resolve(p); let cur = path.parse(a).root; for (const part of a.slice(cur.length).split(path.sep).filter(Boolean)) { cur = path.join(cur, part); try { if (fs.lstatSync(cur).isSymbolicLink() && !["/tmp", "/var"].includes(cur)) throw new Error("Unsafe symlink path"); } catch (e) { if (e.code === "ENOENT" && allowMissing) break; throw e; } } return a; }
function json(file) { return JSON.parse(fs.readFileSync(safePath(file), "utf8").replace(/^\uFEFF/, "")); }
function mkdir(dir) { dir = safePath(dir, true); fs.mkdirSync(dir, {recursive:true, mode:0o700}); fs.chmodSync(dir, 0o700); }
export function atomicWrite(file, value) { file = safePath(file, true); mkdir(path.dirname(file)); const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; const fd = fs.openSync(tmp, "wx", 0o600); try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, file); }
function withLock(base, fn) { const lock = path.join(base, ".writer.lock"); mkdir(base); let fd; const deadline = Date.now() + 10000; while (true) { try { fd = fs.openSync(lock, "wx", 0o600); break; } catch (e) { if (e.code !== "EEXIST" || Date.now() >= deadline) throw new Error("Failure outbox is busy"); } } try { return fn(); } finally { fs.closeSync(fd); fs.rmSync(lock, {force:true}); } }
function identity(f) { return Object.fromEntries(IMMUTABLE.map(k => [k, f?.[k] ?? f?.callback?.[k] ?? null])); }
function sameIdentity(a, b) { return JSON.stringify(identity(a)) === JSON.stringify(identity(b)); }
export function callbackId(project, issue, iteration) { return `failure-${project}-${issue}-${iteration}`; }
export function messageFor(f) { const source = f.source_commit ? ` source commit ${f.source_commit}.` : " No source commit was obtained (unavailable)."; return `[ORCHESTRATOR-AUTO callback_id=${f.callback_id}] CODEX-RUN failed for project '${f.project}', issue #${f.issue}, iteration ${f.iteration}: stage=${f.stage}, code=${f.code}.${source} Action guidance: inspect the recorded failure, correct the issue, and reissue the same logical iteration only after confirming no replacement run exists.`; }

export function loadContext(controlRoot, trusted) {
  const root = safePath(controlRoot); const instance = json(path.join(root, "instance.json"));
  if (!ID.test(String(instance.instance_id || ""))) throw new Error("Invalid instance metadata");
  const projects = json(path.join(root, "projects.json")); if (!projects.projects || typeof projects.projects !== "object") throw new Error("Malformed project registry");
  return {root, instance, projects, trusted};
}
export function prepareFailure({event, controlRoot, trustedGithubUsername, stage, code, exitCode, sourceCommit}) {
  const c = loadContext(controlRoot, trustedGithubUsername); const author = event?.issue?.user?.login; if (typeof author !== "string" || !c.trusted.includes(author)) throw new Error("Untrusted issue author");
  const issue = Number(event?.issue?.number); if (!Number.isInteger(issue) || issue < 1) throw new Error("Invalid issue number");
  let req; try { req = JSON.parse(String(event.issue.body)); } catch { throw new Error("Malformed issue body"); }
  const project = String(req.project || "").toLowerCase(); if (!ID.test(project) || !c.projects.projects[project] || c.projects.projects[project].enabled === false) throw new Error("Disabled or unknown project");
  const configuredRepo = c.projects.projects[project].repository; const eventRepo = event?.repository?.full_name || event?.repository?.name; if (eventRepo && eventRepo !== configuredRepo) throw new Error("Repository does not match project");
  const route = String(req.review_route || ""); if (!ID.test(route)) throw new Error("Missing or unknown review_route"); const iteration = Number(req.iteration); if (!Number.isInteger(iteration) || iteration < 1) throw new Error("Invalid iteration");
  const routeFile = path.join(osHome(), ".chatgpt-codex-orchestrator", "instances", c.instance.instance_id, "chat-routes.json"); const registry = json(routeFile); const record = (registry.routes || []).find(x => x.project === project && x.route === route && x.status === "active"); if (!record) throw new Error("Missing or inactive review_route"); const chatUrl = safeChatUrl(record.chat_url);
  if (sourceCommit !== undefined && !SHA.test(sourceCommit)) throw new Error("Invalid source commit"); const safeCode = sanitizeCode(code); if (!FAILURE_STAGES.has(stage)) throw new Error("Invalid failure stage");
  const normalizedExit = exitCode === undefined ? null : Number(exitCode); if (normalizedExit !== null && (!Number.isInteger(normalizedExit) || normalizedExit < 0 || normalizedExit > 255)) throw new Error("Invalid exit code");
  const id = callbackId(project, issue, iteration); const f = {version:1, execution_state:"TERMINAL_FAILURE", project, issue, iteration, repository:configuredRepo, stage, code:safeCode, exit_code:normalizedExit, source_commit:sourceCommit || null, source_commit_available:Boolean(sourceCommit), callback_id:id, created_at_utc:new Date().toISOString()};
  f.callback = {version:1, delivery_state:"PENDING", callback_id:id, chat_url:chatUrl, message:messageFor({...f, chat_url:chatUrl}), queued_at_utc:f.created_at_utc}; f.delivery_state="PENDING"; f.chat_url=chatUrl; f.message=f.callback.message; f.chat_decision = {state:"unhandled"}; return {context:c, failure:f};
}
function osHome() { return process.env.HOME || process.env.USERPROFILE || "/tmp"; }
export function persistFailure({context, failure}) { const base = path.join(osHome(), ".chatgpt-codex-orchestrator", "instances", context.instance.instance_id, "failure-outbox"); return withLock(base, () => { const file = path.join(base, `${failure.callback_id}.json`); if (fs.existsSync(file)) { const old=json(file); if (!sameIdentity(old, failure)) throw new Error("Conflicting failure payload"); return {file, state:old, reused:true}; } const journal={version:1, phase:"prepared", callback_id:failure.callback_id, failure}; atomicWrite(path.join(base, `${failure.callback_id}.journal.json`), journal); atomicWrite(file, failure); fs.rmSync(path.join(base, `${failure.callback_id}.journal.json`), {force:true}); return {file, state:failure, reused:false}; }); }
export function recoverFailureOutbox(controlRoot) { const c=loadContext(controlRoot, []); const base=path.join(osHome(), ".chatgpt-codex-orchestrator", "instances", c.instance.instance_id, "failure-outbox"); if (!fs.existsSync(base)) return []; return withLock(base, () => fs.readdirSync(base).filter(x=>x.endsWith(".journal.json")).map(x=>{const journalFile=path.join(base,x), j=json(journalFile), file=path.join(base,x.replace(".journal.json",".json")); if (fs.existsSync(file)) { const existing=json(file); if (!sameIdentity(existing,j.failure)) throw new Error("Conflicting failure journal"); fs.rmSync(journalFile); return j.callback_id; } atomicWrite(file,j.failure); fs.rmSync(journalFile); return j.callback_id;})); }
