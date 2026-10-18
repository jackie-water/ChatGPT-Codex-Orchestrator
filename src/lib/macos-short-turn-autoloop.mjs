import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// This module is deliberately a local ledger.  It has no browser, network,
// runner, git, or Codex integration.  The only externally visible work it can
// produce is a deterministic dispatch intent.
export const VERSION = 1;
export const DELIVERY_STATES = ["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"];
export const EXECUTION_STATES = ["ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN"];
export const CHAT_STATES = ["UNCLAIMED", "CLAIMED", "ACTION_RECORDED", "WAITING_HUMAN", "WAITING_SERVICE", "DONE"];
export const ACTION_KINDS = ["CHAT_CONTINUE", "WAIT_EXISTING_TASK", "WAITING_HUMAN", "DONE", "CODEX_RUN", "VALIDATE", "CODE_REVIEW"];
const SHA = /^[0-9a-f]{40,64}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const URL = /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9._~-]+$/;

function fail(code, message = code) { const e = new Error(message); e.code = code; throw e; }
function assert(condition, code, message) { if (!condition) fail(code, message); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }
function now() { return new Date().toISOString(); }
function safeDir(dir) { assert(typeof dir === "string" && path.isAbsolute(dir), "INVALID_STATE_DIRECTORY"); return dir; }
function privatePath(file) { assert(path.isAbsolute(file), "INVALID_STATE_PATH"); return file; }
function ensureDir(dir) { fs.mkdirSync(dir, {recursive:true, mode:0o700}); fs.chmodSync(dir, 0o700); }
function readJson(file) { privatePath(file); if (!fs.existsSync(file)) fail("STATE_MISSING"); const st = fs.lstatSync(file); assert(st.isFile() && !st.isSymbolicLink(), "UNTRUSTED_STATE_FILE"); return JSON.parse(fs.readFileSync(file, "utf8")); }
function atomicWrite(file, value, exclusive = false) {
  ensureDir(path.dirname(file)); privatePath(file);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    if (exclusive) { fs.linkSync(temp, file); fs.unlinkSync(temp); }
    else fs.renameSync(temp, file);
    const d = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function withLock(dir, fn) {
  ensureDir(path.dirname(dir));
  try { fs.mkdirSync(dir, {mode:0o700}); } catch (e) { if (e.code === "EEXIST") fail("STATE_CONTENTION"); throw e; }
  try { return fn(); } finally { try { fs.rmdirSync(dir); } catch { fail("STATE_UNCERTAIN"); } }
}
function paths(root, taskId) { const r = safeDir(root), base = path.join(r, "tasks", taskId); return {root:r, base, state:path.join(base,"state.json"), journal:path.join(base,"journal.jsonl"), outbox:path.join(base,"outbox.json"), receipt:path.join(base,"receipt.json"), lock:path.join(base,".lock")}; }
function identity(input) {
  const {instanceId, project, route, chatUrl, taskId, logicalIteration} = input;
  for (const [name, value] of Object.entries({instanceId, project, route, taskId})) assert(typeof value === "string" && ID.test(value), "INVALID_IDENTITY", name);
  assert(typeof logicalIteration === "number" && Number.isInteger(logicalIteration) && logicalIteration > 0, "INVALID_ITERATION");
  assert(typeof chatUrl === "string" && URL.test(chatUrl), "INVALID_CHAT_URL");
  assert(chatUrl.endsWith(`/c/${route}`), "ROUTE_URL_MISMATCH");
  return {instanceId, project, route, chatUrl, taskId, logicalIteration};
}
function action(input) {
  assert(input && ACTION_KINDS.includes(input.kind), "INVALID_ACTION");
  assert(input.logicalIteration > 0, "INVALID_ITERATION");
  if (["CODEX_RUN","VALIDATE","CODE_REVIEW"].includes(input.kind)) {
    assert(input.authorized === true, "ACTION_NOT_AUTHORIZED");
    assert(typeof input.descriptor === "object" && input.descriptor !== null, "ACTION_DESCRIPTOR_REQUIRED");
    assert(!input.descriptor.execute && !input.descriptor.liveBrowser && !input.descriptor.merge && !input.descriptor.deploy, "LIVE_ACTION_FORBIDDEN");
    if (input.descriptor.sourceSha !== undefined) assert(SHA.test(input.descriptor.sourceSha), "INVALID_SOURCE_SHA");
    if (input.descriptor.branch !== undefined) assert(!/^(main|master|develop|dev)$/i.test(input.descriptor.branch), "PROTECTED_BRANCH");
  }
  return {kind:input.kind, logicalIteration:input.logicalIteration, descriptor:input.descriptor || null};
}
function eventId(identityValue, kind, source) { return `${identityValue.taskId}:${identityValue.logicalIteration}:${kind}:${source || "none"}`; }
function appendJournal(p, entry) { ensureDir(p.base); fs.appendFileSync(p.journal, JSON.stringify({...entry, at_utc:entry.at_utc || now()}) + "\n", {mode:0o600}); const fd=fs.openSync(p.journal,"r"); try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);} }
function validateState(s) {
  assert(s?.version === VERSION && s.enabled === false, "INVALID_LEDGER_VERSION");
  identity(s.identity); assert(EXECUTION_STATES.includes(s.execution.state), "INVALID_EXECUTION_STATE"); assert(CHAT_STATES.includes(s.chat.state), "INVALID_CHAT_STATE");
  if (s.nextAction) action(s.nextAction);
  return s;
}
function load(p) { return validateState(readJson(p.state)); }
function saveTransition(p, current, next, journalEntry) { validateState(next); atomicWrite(p.state, next); appendJournal(p, journalEntry); return next; }
function immutableEvidence(e) {
  assert(e && ["SUCCESS","FAILURE","VALIDATION_FAILURE","TIMEOUT","UNKNOWN"].includes(e.kind), "INVALID_EVIDENCE");
  assert(typeof e.source === "string" && e.source.length > 0 && e.source.length < 512, "INVALID_EVIDENCE_SOURCE");
  if (e.sourceSha !== undefined) assert(SHA.test(e.sourceSha), "INVALID_SOURCE_SHA");
  if (e.reportPath !== undefined) { assert(typeof e.reportPath === "string" && path.isAbsolute(e.reportPath), "INVALID_REPORT_PATH"); assert(!e.reportPath.includes("\0"), "INVALID_REPORT_PATH"); }
  return {kind:e.kind, source:e.source, sourceSha:e.sourceSha || null, reportPath:e.reportPath || null, detail:e.detail || null};
}

export function registerTask(options) {
  const {stateDir, identity: rawIdentity, maxIterations = 5, enabled = false} = options || {};
  assert(enabled === false, "SHORT_TURN_DISABLED"); const id = identity(rawIdentity || {instanceId:options?.instanceId, project:options?.project, route:options?.route, chatUrl:options?.chatUrl, taskId:options?.taskId, logicalIteration:options?.logicalIteration}); assert(maxIterations >= id.logicalIteration && maxIterations <= 100, "INVALID_BUDGET"); const p=paths(stateDir,id.taskId);
  return withLock(p.lock, () => {
    if (fs.existsSync(p.state)) { const s=load(p); assert(stable(s.identity)===stable(id), "IDENTITY_CONFLICT"); return s; }
    const s={version:VERSION, enabled:false, identity:id, budget:{maxIterations}, versionNumber:0, execution:{state:"ACCEPTED", evidence:null}, chat:{state:"UNCLAIMED", callbackId:null, receiptDigest:null}, nextAction:null, outbox:null, terminalEvidence:null, reconciliationEvidence:[]};
    atomicWrite(p.state,s,true); appendJournal(p,{type:"TASK_REGISTERED", identity:id}); return s;
  });
}
export function casRegisterNextAction({stateDir, taskId, expectedVersion, nextAction}) {
  const p=paths(stateDir,taskId); return withLock(p.lock,()=>{ const s=load(p); assert(s.versionNumber===expectedVersion,"STALE_CAS"); const a=action({...nextAction, logicalIteration:nextAction.logicalIteration || s.identity.logicalIteration}); assert(a.logicalIteration>=s.identity.logicalIteration && a.logicalIteration<=s.budget.maxIterations,"ACTION_OUT_OF_BUDGET"); assert(!s.nextAction,"DUPLICATE_SUCCESSOR"); assert(s.chat.state !== "DONE" && s.chat.state !== "WAITING_HUMAN" && s.chat.state !== "WAITING_SERVICE","STATE_NOT_ADVANCEABLE"); const n={...s,versionNumber:s.versionNumber+1,nextAction:a}; return saveTransition(p,s,n,{type:"NEXT_ACTION_REGISTERED",action:a}); });
}
export function ingestEvidence({stateDir, taskId, expectedVersion, evidence}) {
  const p=paths(stateDir,taskId); return withLock(p.lock,()=>{ const s=load(p), e=immutableEvidence(evidence); assert(s.versionNumber===expectedVersion,"STALE_CAS"); assert(!s.terminalEvidence,"TERMINAL_EVIDENCE_IMMUTABLE"); const map={SUCCESS:"SUCCEEDED",FAILURE:"FAILED",VALIDATION_FAILURE:"FAILED",TIMEOUT:"UNKNOWN",UNKNOWN:"UNKNOWN"}; const n={...s,versionNumber:s.versionNumber+1,execution:{state:map[e.kind],evidence:e},terminalEvidence:e.kind==="SUCCESS"||e.kind==="FAILURE"||e.kind==="VALIDATION_FAILURE"||e.kind==="TIMEOUT"||e.kind==="UNKNOWN"?e:null}; appendJournal(p,{type:"EVIDENCE_INGESTED",evidence:e}); atomicWrite(p.state,n); return n; });
}
function callbackMessage(s, a) { return `[ORCHESTRATOR callback_id=${s.chat.callbackId}] Orchestrator provenance: action ${a.kind} recorded for task ${s.identity.taskId}, iteration ${s.identity.logicalIteration}. This is machine-generated coordination, not human approval; it does not authorize merge or deploy.`; }
export function claimCallbackReceipt({stateDir, taskId, callbackId, message, role = "user"}) {
  const p=paths(stateDir,taskId); return withLock(p.lock,()=>{ const s=load(p); assert(role==="user","RECEIPT_NOT_USER_ROLE"); assert(typeof callbackId==="string"&&ID.test(callbackId),"INVALID_CALLBACK_ID"); assert(s.nextAction,"NO_SUCCESSOR"); assert(callbackId===eventId(s.identity,s.nextAction.kind,s.nextAction.descriptor?.sourceSha || s.versionNumber),"SPOOFED_RECEIPT"); const expected=callbackMessage({...s,chat:{...s.chat,callbackId}},s.nextAction); assert(message===expected,"RECEIPT_IDENTITY_MISMATCH"); if(s.chat.state!=="UNCLAIMED") return s; const n={...s,versionNumber:s.versionNumber+1,chat:{...s.chat,state:"CLAIMED",callbackId,receiptDigest:digest({callbackId,message})}}; atomicWrite(p.state,n); appendJournal(p,{type:"CALLBACK_CLAIMED",callbackId}); return n; });
}
export function acknowledgeCallback({stateDir, taskId, expectedVersion, outcome, successor = null}) {
  const p=paths(stateDir,taskId); return withLock(p.lock,()=>{ const s=load(p); assert(s.versionNumber===expectedVersion,"STALE_CAS"); assert(s.chat.state==="CLAIMED","CALLBACK_NOT_CLAIMED"); assert(["ACTION_RECORDED","WAITING_HUMAN","DONE"].includes(outcome),"INVALID_ACK"); if(outcome==="DONE") assert(!successor,"DONE_HAS_SUCCESSOR"); if(outcome==="WAITING_HUMAN") assert(!successor,"HUMAN_GATE_HAS_SUCCESSOR"); if(outcome==="ACTION_RECORDED") assert(successor,"SUCCESSOR_REQUIRED"); let next=null; if(successor) { next=action(successor); assert(next.logicalIteration>=s.identity.logicalIteration && next.logicalIteration<=s.budget.maxIterations,"ACTION_OUT_OF_BUDGET"); assert(!s.nextAction || next.logicalIteration>s.nextAction.logicalIteration,"DUPLICATE_SUCCESSOR"); }
    const n={...s,versionNumber:s.versionNumber+1,chat:{...s.chat,state:outcome},nextAction:next}; atomicWrite(p.state,n); appendJournal(p,{type:"CALLBACK_ACKNOWLEDGED",outcome,successor:n.nextAction}); return n; });
}
export function dispatchIntent({stateDir, taskId}) { const p=paths(stateDir,taskId); const s=load(p); if(s.chat.state==="DONE"||s.chat.state==="WAITING_HUMAN"||s.chat.state==="WAITING_SERVICE"||!s.nextAction||["WAITING_HUMAN","DONE"].includes(s.nextAction.kind)) return {intents:[],state:s}; const a=s.nextAction, id=eventId(s.identity,a.kind,a.descriptor?.sourceSha||s.versionNumber); const intent={version:VERSION,intentId:id,kind:a.kind,identity:s.identity,action:a,execute:false}; if(s.outbox && s.outbox.intentId!==id) fail("OUTBOX_CONFLICT"); if(!s.outbox) { const outbox={intentId:id,state:"PENDING",deliveryState:"PENDING",intent}; const n={...s,outbox}; atomicWrite(p.outbox,outbox); atomicWrite(p.state,n); appendJournal(p,{type:"OUTBOX_CREATED",intentId:id}); return {intents:[intent],state:n}; } return {intents:[],state:s}; }
export function statusTask({stateDir,taskId}) { return load(paths(stateDir,taskId)); }
export function reconcileTask({stateDir,taskId,evidence}) { const p=paths(stateDir,taskId); return withLock(p.lock,()=>{const s=load(p); const e=immutableEvidence(evidence); const n={...s,reconciliationEvidence:[...s.reconciliationEvidence,e]}; atomicWrite(p.state,n); appendJournal(p,{type:"RECONCILIATION_EVIDENCE",evidence:e}); return n;}); }
export const register = registerTask;
export const registerNextAction = casRegisterNextAction;
export const ingest = ingestEvidence;
export const claimReceipt = claimCallbackReceipt;
export const acknowledge = acknowledgeCallback;
export const status = statusTask;
export const reconcile = reconcileTask;
