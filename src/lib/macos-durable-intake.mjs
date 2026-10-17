import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn as nativeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planMacosCodexRun, getValidatedMacosCodexPlan } from "./macos-codex-run-contract.mjs";

const MAX_LOG = 32768;
const MAX_TIMEOUT = 30 * 60 * 1000;
const ID = /^[a-f0-9]{64}$/;
const STATES = new Set(["ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN"]);
const WORKER = fileURLToPath(new URL("../../runtime/scripts/macos-durable-worker.mjs", import.meta.url));

const fail = (message, code = "DURABLE_INTAKE_REJECTED") => { throw Object.assign(new Error(message), { code }); };
const owned = st => typeof process.getuid !== "function" || st.uid === process.getuid();
const home = () => process.env.HOME || process.env.USERPROFILE || fail("HOME is required", "HOME_REQUIRED");
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
const digest = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

function secureDir(dir) {
  const absolute = path.resolve(dir); let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const st = fs.lstatSync(current); if ((st.isSymbolicLink() && !["/tmp", "/var"].includes(current)) || !st.isDirectory()) fail("Unsafe durable state path", "UNSAFE_STATE_PATH"); }
    catch (e) { if (e.code !== "ENOENT") throw e; fs.mkdirSync(current, { mode: 0o700 }); }
  }
  const st = fs.lstatSync(absolute); if (st.isSymbolicLink() || !st.isDirectory() || !owned(st)) fail("Unsafe durable state directory", "UNSAFE_STATE_PATH");
  fs.chmodSync(absolute, 0o700); return absolute;
}
function privateFile(file, allowMissing = false) {
  const absolute = path.resolve(file); let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const st = fs.lstatSync(current); if (st.isSymbolicLink() && !["/tmp", "/var"].includes(current)) fail("Symlinked durable state", "UNSAFE_STATE_PATH"); if (current !== absolute && !st.isDirectory()) fail("Unsafe durable state path", "UNSAFE_STATE_PATH"); }
    catch (e) { if (!(allowMissing && e.code === "ENOENT")) throw e; break; }
  }
  try { const st = fs.lstatSync(absolute); if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1 || !owned(st) || (st.mode & 0o077) !== 0) fail("Unsafe durable state file", "UNSAFE_STATE_FILE"); }
  catch (e) { if (!(allowMissing && e.code === "ENOENT")) throw e; }
  return absolute;
}
function syncDir(dir) { const fd = fs.openSync(dir, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function exclusiveJson(file, value) {
  privateFile(file, true); const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDir(path.dirname(file));
}
function replaceJson(file, value) {
  privateFile(file); const dir = path.dirname(file); const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  const fd = fs.openSync(temp, "wx", 0o600); try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file); fs.chmodSync(file, 0o600); syncDir(dir);
}
function processIsLive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}
function stateFilePaths(snapshot) {
  const dir = secureDir(path.join(snapshot.instance_root, "macos-durable-intake"));
  const key = digest({ instance_id: snapshot.instance_id, project: snapshot.identity.project, issue: snapshot.identity.issue,
    iteration: snapshot.identity.iteration, review_route: snapshot.identity.review_route,
    event_digest_sha256: snapshot.authorization_digest });
  return { dir, key, intentPath: path.join(dir, `${key}.intent.json`), receiptPath: path.join(dir, `${key}.receipt.json`) };
}
function validateRecord(value, key, kind) {
  if (!value || value.version !== 1 || value.key !== key || (kind === "receipt" && !STATES.has(value.status))) fail("Malformed or conflicting durable state", "UNCERTAIN_STATE");
  if (kind === "intent" && (!value.authorization_digest || value.authorized_snapshot?.authorization_digest !== value.authorization_digest
    || value.identity?.issue < 1 || value.identity?.iteration < 1 || !value.identity?.review_route)) fail("Malformed durable intent", "UNCERTAIN_STATE");
}
function safeReceipt(value, paths) {
  validateRecord(value, paths.key, "receipt");
  return { ...value, receipt_path: paths.receiptPath };
}

export function durablePaths(snapshot) { return stateFilePaths(snapshot); }

export function readMacosDurableStatus({ snapshot, paths = stateFilePaths(snapshot) }) {
  let intent, receipt;
  try { intent = read(privateFile(paths.intentPath)); receipt = read(privateFile(paths.receiptPath)); }
  catch (e) { if (e.code === "ENOENT") fail("Durable intent is partial or missing", "UNCERTAIN_STATE"); throw e; }
  validateRecord(intent, paths.key, "intent");
  if (intent.authorization_digest !== snapshot.authorization_digest || canonical(intent.identity) !== canonical(snapshot.identity)) fail("Durable intent authorization conflict", "AUTHORIZATION_CONFLICT");
  return safeReceipt(reconcileMacosDurableWorker({ receiptPath: paths.receiptPath, key: paths.key }), paths);
}

export function updateMacosDurableStatus({ receiptPath, expected = ["ACCEPTED", "RUNNING"], patch }) {
  const lockPath = `${receiptPath}.lock`; privateFile(lockPath, true);
  let fd;
  try { fd = fs.openSync(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let lock;
    try { lock = JSON.parse(fs.readFileSync(privateFile(lockPath), "utf8")); }
    catch { throw Object.assign(new Error("Receipt lock is active or uncertain"), { code: "RECEIPT_LOCK_CONTENTION" }); }
    if (lock?.version !== 1 || !processIsLive(lock.pid)) {
      try { fs.rmSync(lockPath); } catch (removeError) { if (removeError.code !== "ENOENT") throw removeError; }
      return updateMacosDurableStatus({ receiptPath, expected, patch: { status: "UNKNOWN", failure_code: "RECEIPT_LOCK_ORPHANED" } });
    }
    throw Object.assign(new Error("Receipt lock is held by a live writer"), { code: "RECEIPT_LOCK_CONTENTION" });
  }
  try { fs.writeFileSync(fd, JSON.stringify({ version: 1, pid: process.pid, locked_at_utc: new Date().toISOString() }) + "\n"); fs.fsyncSync(fd); }
  catch (error) { try { fs.closeSync(fd); } catch {} try { fs.rmSync(lockPath, { force: true }); } catch {} throw error; }
  try {
    const current = read(privateFile(receiptPath)); if (!STATES.has(current.status) || !expected.includes(current.status)) return current;
    const rank = { ACCEPTED: 0, RUNNING: 1, SUCCEEDED: 2, FAILED: 2, UNKNOWN: 2 };
    const next = { ...current, ...patch, updated_at_utc: new Date().toISOString() };
    if (!STATES.has(next.status) || rank[current.status] === 2 || rank[next.status] < rank[current.status]) return current;
    replaceJson(receiptPath, next); return next;
  } finally { fs.closeSync(fd); fs.rmSync(lockPath, { force: true }); }
}

export function reconcileMacosDurableWorker({ receiptPath, key }) {
  const claimPath = `${receiptPath.replace(/\.receipt\.json$/, "")}.worker-claim`;
  let receipt;
  try { receipt = read(privateFile(receiptPath)); }
  catch (error) { if (error.code === "ENOENT") fail("Durable receipt is missing", "UNCERTAIN_STATE"); throw error; }
  if (receipt.key !== key || !STATES.has(receipt.status)) fail("Malformed or conflicting durable receipt", "UNCERTAIN_STATE");
  if (["SUCCEEDED", "FAILED", "UNKNOWN"].includes(receipt.status)) return receipt;
  let claim;
  try { claim = read(privateFile(claimPath)); }
  catch (error) { if (error.code === "ENOENT") return receipt; throw error; }
  if (claim?.version !== 1 || claim.key !== key || !Number.isInteger(claim.pid) || claim.pid <= 0) fail("Malformed durable worker claim", "UNCERTAIN_STATE");
  if (processIsLive(claim.pid)) return receipt;
  return updateMacosDurableStatus({ receiptPath, expected: ["ACCEPTED", "RUNNING"], patch: { status: "UNKNOWN", failure_code: "WORKER_ORPHANED" } });
}

export function claimMacosDurableWorker({ receiptPath, key }) {
  const claimPath = `${receiptPath.replace(/\.receipt\.json$/, "")}.worker-claim`;
  privateFile(claimPath, true);
  try { exclusiveJson(claimPath, { version: 1, key, pid: process.pid, claimed_at_utc: new Date().toISOString() }); return true; }
  catch (error) { if (error.code === "EEXIST") { reconcileMacosDurableWorker({ receiptPath, key }); return false; } throw error; }
}

export function submitMacosDurableIntent({ event, controlRoot, controlRepository, trustedGithubUsername, timeoutMs = 300000, workerPath = WORKER, spawnWorker = nativeSpawn }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT) fail("Invalid bounded execution timeout", "INVALID_TIMEOUT");
  const planned = planMacosCodexRun({ event, controlRoot, controlRepository, trustedGithubUsername });
  const snapshot = getValidatedMacosCodexPlan(planned);
  const paths = stateFilePaths(snapshot);
  for (const name of fs.readdirSync(paths.dir)) {
    if (!name.endsWith(".intent.json")) continue;
    const candidate = read(privateFile(path.join(paths.dir, name)));
    if (!candidate || candidate.version !== 1 || !ID.test(candidate.key) || !candidate.identity) fail("Unknown durable intent state", "UNCERTAIN_STATE");
    if (candidate.identity.project === snapshot.identity.project && candidate.identity.issue === snapshot.identity.issue
      && candidate.identity.iteration === snapshot.identity.iteration && candidate.identity.review_route === snapshot.identity.review_route
      && candidate.key !== paths.key) fail("Conflicting durable intent exists", "AUTHORIZATION_CONFLICT");
  }
  const intent = { version: 1, key: paths.key, kind: "MACOS_DURABLE_INTENT", created_at_utc: new Date().toISOString(),
    authorization_digest: snapshot.authorization_digest, authorized_snapshot: snapshot, identity: snapshot.identity, event,
    control_root: snapshot.controlRoot, control_repository: controlRepository, trusted_github_username: snapshot.trustedGithubUsername,
    timeout_ms: timeoutMs };
  try {
    exclusiveJson(paths.intentPath, intent);
    exclusiveJson(paths.receiptPath, { version: 1, key: paths.key, status: "ACCEPTED", accepted_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString(), pid: null });
  } catch (e) {
    if (e.code !== "EEXIST") throw Object.assign(e, { code: "DURABILITY_FAILED" });
    reconcileMacosDurableWorker({ receiptPath: paths.receiptPath, key: paths.key });
    return readMacosDurableStatus({ snapshot, paths });
  }
  let child;
  try {
    child = spawnWorker(process.execPath, [workerPath, "--intent-path", paths.intentPath], { detached: true, stdio: "ignore", shell: false, windowsHide: true });
    if (!child || !Number.isInteger(child.pid) || child.pid <= 0) fail("Worker spawn was not accepted", "SPAWN_FAILED");
    let settled = false;
    const uncertain = error => { if (settled) return; settled = true; try { updateMacosDurableStatus({ receiptPath: paths.receiptPath, expected: ["ACCEPTED", "RUNNING"], patch: { status: "UNKNOWN", failure_code: error?.code === "ENOENT" ? "DISPATCH_UNAVAILABLE" : "DISPATCH_SPAWN_FAILED" } }); } catch {} };
    child.once?.("error", uncertain); child.once?.("close", () => { settled = true; });
    child.unref?.();
  } catch (e) {
    updateMacosDurableStatus({ receiptPath: paths.receiptPath, patch: { status: "UNKNOWN", failure_code: "SPAWN_FAILED" } });
    throw Object.assign(new Error("Durable worker spawn failed"), { code: "SPAWN_FAILED", cause: e });
  }
  return { status: "ACCEPTED", task_id: paths.key, receipt_path: paths.receiptPath, pid: child.pid };
}

export const redactLog = value => String(value || "").slice(0, MAX_LOG)
  .replace(/\b(?:github_pat_|gh[opusr]_)[A-Za-z0-9_]+/gi, "[REDACTED]")
  .replace(/((?:authorization\s*:\s*)?(?:bearer|token)\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
  .replace(/((?:api[_-]?key|secret|token|password|prompt)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,}\]]+?)(?=(?:\r\n|\n|\r|\s+(?:api[_-]?key|secret|token|password|prompt)\s*[:=]|[,}\]]|$))/gi, "$1[REDACTED]")
  .slice(0, MAX_LOG);
