import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync as realSpawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalInstallationId } from "./control-render.mjs";
import { readMacosNativeProcessIdentity } from "./macos-native-process-identity.mjs";

export const REVIEWED_SOURCE_PATH = fileURLToPath(new URL("../../runtime/native/macos/process_identity.c", import.meta.url));
export const REVIEWED_SOURCE_SHA256 = "59bbe3a8f5a0a456bc78b1067487ad72d067ad2d262abb66ea9004d28b205b3f";
export const REVIEWED_SOURCE_COMMIT = "7214cbf1aa5f75b55f4218e0f9d2dae5a8f4179e";
export const HELPER_RELATIVE_PATH = path.join("runtime", "native", "macos", "process-identity");
export const RECEIPT_NAME = "macos-native-helper-capability.json";
export const INSTALL_JOURNAL_NAME = "macos-native-helper-install.json";
const INSTALL_LOCK_NAME = ".macos-native-helper-install.lock";
const MAX_OUTPUT = 8192;
const owner = () => typeof process.getuid === "function" ? process.getuid() : null;
const defaultRunner = (command, args, options = {}) => { const r = realSpawnSync(command, args, { encoding: "utf8", shell: false, timeout: 5000, maxBuffer: MAX_OUTPUT, ...options }); return { status: r.status, ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error }; };
const sha256 = (file, fsImpl = fs) => crypto.createHash("sha256").update(fsImpl.readFileSync(file)).digest("hex");
const uidAllowed = (st, uid = owner()) => uid === null || st.uid === uid || st.uid === 0;
const modePrivate = st => (st.mode & 0o077) === 0;
const exactMode = (st, mode) => (st.mode & 0o777) === mode;
const trustedAncestor = st => uidAllowed(st) && ((st.mode & 0o022) === 0 || (st.uid === 0 && (st.mode & 0o1000) !== 0));
const ancestorAllowed = (st, strictAncestors) => uidAllowed(st) && (strictAncestors ? trustedAncestor(st) : (st.mode & 0o022) === 0);
const regularOwned = (st, { executable = false, privateFile = false } = {}) => st.isFile() && st.nlink === 1 && uidAllowed(st) && (privateFile ? modePrivate(st) : (st.mode & 0o022) === 0) && (!executable || (st.mode & 0o111) !== 0);

function safeExistingPath(file, { executable = false, privateFile = false, strictAncestors = false, fsImpl = fs } = {}) {
  const normalized = path.resolve(file); const root = path.parse(normalized).root; let current = root;
  for (const part of normalized.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); let st;
    try { st = fsImpl.lstatSync(current); } catch { return { ok: false, reason: "missing-or-unreadable", path: current }; }
    if (st.isSymbolicLink() && current === normalized) return { ok: false, reason: "symlink", path: current };
    if (st.isSymbolicLink() && current !== normalized) {
      let target;
      try { target = fsImpl.statSync(current); } catch { return { ok: false, reason: "unsafe-symlink-ancestor", path: current }; }
      if (!target.isDirectory() || !ancestorAllowed(target, strictAncestors)) return { ok: false, reason: "unsafe-symlink-ancestor", path: current };
    }
    const ancestorStat = st.isSymbolicLink() ? (() => { try { return fsImpl.statSync(current); } catch { return null; } })() : st;
    if (current !== normalized && (!ancestorStat?.isDirectory() || !ancestorAllowed(ancestorStat, strictAncestors))) return { ok: false, reason: "unsafe-ancestor", path: current };
    if (current === normalized && !regularOwned(st, { executable, privateFile })) return { ok: false, reason: executable ? "unsafe-executable" : "unsafe-file", path: current };
  }
  return { ok: true, path: normalized };
}
function safePrivateDirectory(dir, fsImpl = fs) {
  const normalized = path.resolve(dir); const root = path.parse(normalized).root; let current = root;
  for (const part of normalized.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); let st;
    try { st = fsImpl.lstatSync(current); } catch { return { ok: false, reason: "missing-or-unreadable", path: current }; }
    if (st.isSymbolicLink() && current === normalized) return { ok: false, reason: "symlink", path: current };
    const target = st.isSymbolicLink() ? (() => { try { return fsImpl.statSync(current); } catch { return null; } })() : st;
    if (!target?.isDirectory() || !trustedAncestor(target)) return { ok: false, reason: "unsafe-directory", path: current };
    if (current === normalized && !modePrivate(target)) return { ok: false, reason: "unsafe-directory-mode", path: current };
  }
  return { ok: true, path: normalized };
}
function privateInstanceRoot(home, installationId) { if (!installationId) throw new Error("installation_id is required"); return path.join(path.resolve(home), ".chatgpt-codex-orchestrator", "instances", canonicalInstallationId(installationId)); }
export function macosNativeHelperPaths({ home = os.homedir(), installationId } = {}) { const instanceRoot = privateInstanceRoot(home, installationId); return { instanceRoot, helperPath: path.join(instanceRoot, HELPER_RELATIVE_PATH), receiptPath: path.join(instanceRoot, RECEIPT_NAME), journalPath: path.join(instanceRoot, INSTALL_JOURNAL_NAME) }; }

function sourceCheck(sourcePath, fsImpl) {
  const safe = safeExistingPath(sourcePath, { fsImpl });
  if (!safe.ok) return { status: "ERROR", error_id: "MACOS-NATIVE-SOURCE-UNSAFE", reason: safe.reason, source_path: sourcePath };
  let digest; try { digest = sha256(sourcePath, fsImpl); } catch (error) { return { status: "ERROR", error_id: "MACOS-NATIVE-SOURCE-UNREADABLE", details: String(error.message || error) }; }
  if (digest !== REVIEWED_SOURCE_SHA256) return { status: "ERROR", error_id: "MACOS-NATIVE-SOURCE-MISMATCH", source_sha256: digest, expected_source_sha256: REVIEWED_SOURCE_SHA256 };
  return { status: "PASS", source_path: path.resolve(sourcePath), source_sha256: digest };
}
function snapshotReviewedSource(sourcePath, destination, fsImpl) {
  const checked = sourceCheck(sourcePath, fsImpl);
  if (checked.status !== "PASS") return checked;
  const bytes = fsImpl.readFileSync(sourcePath);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== REVIEWED_SOURCE_SHA256) return { status: "ERROR", error_id: "MACOS-NATIVE-SOURCE-MISMATCH", source_sha256: digest, expected_source_sha256: REVIEWED_SOURCE_SHA256 };
  const fd = fsImpl.openSync(destination, "wx", 0o600);
  try { fsImpl.writeFileSync(fd, bytes); fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
  fsImpl.chmodSync(destination, 0o600);
  const safe = safeExistingPath(destination, { privateFile: true, strictAncestors: true, fsImpl });
  if (!safe.ok || sha256(destination, fsImpl) !== REVIEWED_SOURCE_SHA256) return { status: "ERROR", error_id: "MACOS-NATIVE-SOURCE-SNAPSHOT-UNSAFE", reason: safe.reason };
  return { ...checked, snapshot_path: destination };
}
function commandResult(commandRunner, command, args) { try { const executable = command === "xcrun" && process.env.NODE_TEST_CONTEXT && process.env.ORCHESTRATOR_TEST_XCRUN ? process.env.ORCHESTRATOR_TEST_XCRUN : command; return commandRunner(executable, args, { shell: false, timeout: 5000, maxBuffer: MAX_OUTPUT, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" } }); } catch (error) { return { ok: false, status: null, stdout: "", stderr: String(error.message || error), error }; } }

export function macosNativeHelperPreflight({ platform = process.platform, home = os.homedir(), installationId, sourcePath = REVIEWED_SOURCE_PATH, commandRunner = defaultRunner, fsImpl = fs } = {}) {
  const result = { status: "PASS", mutations_performed: false, platform, source: null, toolchain: null, instance: null, capability: null };
  if (platform !== "darwin") return { ...result, status: "UNSUPPORTED", error_id: "MACOS-NATIVE-UNSUPPORTED" };
  const clang = commandResult(commandRunner, "xcrun", ["--find", "clang"]); const sdk = commandResult(commandRunner, "xcrun", ["--sdk", "macosx", "--show-sdk-path"]); const sdkPath = String(sdk.stdout || "").trim();
  const headers = sdk.ok && sdkPath && ["usr/include/libproc.h", "usr/include/sys/proc_info.h"].every(p => { try { return fsImpl.statSync(path.join(sdkPath, p)).isFile(); } catch { return false; } });
  result.toolchain = { xcrun: clang.ok && sdk.ok, clang: clang.ok, sdk: sdk.ok, sdk_path: sdkPath || null, headers, mutations_performed: false }; result.source = sourceCheck(sourcePath, fsImpl);
  if (!installationId) { result.instance = { status: "UNBOUND", private_root: false }; result.capability = { status: "UNBOUND" }; }
  else try { const paths = macosNativeHelperPaths({ home, installationId }); result.instance = { instance_root: paths.instanceRoot, helper_path: paths.helperPath, private_root: safePrivateDirectory(paths.instanceRoot, fsImpl).ok || !fsImpl.existsSync(paths.instanceRoot) }; if (fsImpl.existsSync(paths.receiptPath)) { const receiptSafe = safeExistingPath(paths.receiptPath, { privateFile: true, strictAncestors: true, fsImpl }); result.capability = receiptSafe.ok ? JSON.parse(fsImpl.readFileSync(paths.receiptPath, "utf8")) : { status: "ERROR", error_id: "MACOS-NATIVE-RECEIPT-UNSAFE" }; } else result.capability = { status: "MISSING" }; } catch (error) { result.instance = { private_root: false }; result.capability = { status: "ERROR", error_id: "MACOS-NATIVE-INSTANCE-INVALID", details: String(error.message || error) }; }
  if (!clang.ok || !sdk.ok || !headers) { result.status = "NEEDS_USER_ACTION"; result.error_id = "MACOS-NATIVE-TOOLCHAIN"; } if (result.source.status !== "PASS" || (installationId && result.instance?.private_root !== true)) result.status = "ERROR"; if (result.source.error_id) result.error_id = result.source.error_id; return result;
}
function existingPrivateAncestors(dir, fsImpl) {
  const normalized = path.resolve(dir); const root = path.parse(normalized).root; let current = root;
  for (const part of normalized.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); let st;
    try { st = fsImpl.lstatSync(current); } catch { return { ok: true }; }
    const target = st.isSymbolicLink() ? (() => { try { return fsImpl.statSync(current); } catch { return null; } })() : st;
    if (!target?.isDirectory() || !trustedAncestor(target)) return { ok: false, reason: "unsafe-ancestor" };
  }
  return { ok: true };
}
function ensurePrivateTree(dir, fsImpl) {
  const ancestors = existingPrivateAncestors(dir, fsImpl);
  if (!ancestors.ok) throw new Error(`Unsafe private instance path: ${ancestors.reason}`);
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 }); const check = safePrivateDirectory(dir, fsImpl);
  if (!check.ok) throw new Error(`Unsafe private instance path: ${check.reason}`); fsImpl.chmodSync(dir, 0o700);
}
function atomicPrivateJson(file, value, fsImpl, { replace = true } = {}) { const dir = path.dirname(file); const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`; const fd = fsImpl.openSync(temp, "wx", 0o600); try { fsImpl.writeFileSync(fd, JSON.stringify(value, null, 2)); fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); } try { if (replace) fsImpl.renameSync(temp, file); else { fsImpl.linkSync(temp, file); fsImpl.unlinkSync(temp); } } catch (error) { try { fsImpl.unlinkSync(temp); } catch {} throw error; } const dfd = fsImpl.openSync(dir, "r"); try { fsImpl.fsyncSync(dfd); } finally { fsImpl.closeSync(dfd); } fsImpl.chmodSync(file, 0o600); }
const atomicReceipt = atomicPrivateJson;
function validIdentity(value, pid) { return value && Object.keys(value).sort().join(",") === "identity,pid,start_sec,start_usec,status" && value.status === "OK" && value.pid === pid && Number.isSafeInteger(value.start_sec) && value.start_sec >= 0 && Number.isSafeInteger(value.start_usec) && value.start_usec >= 0 && value.start_usec < 1000000 && typeof value.identity === "string" && value.identity.length > 0; }
function proofIdentity(helperPath, { platform, identityReader = readMacosNativeProcessIdentity, selfPid = process.pid, parentPid = process.ppid } = {}) { if (!Number.isSafeInteger(selfPid) || selfPid <= 0 || !Number.isSafeInteger(parentPid) || parentPid <= 0) return { status: "ERROR", error_id: "MACOS-NATIVE-PID-UNAVAILABLE", mutations_performed: false }; const read = pid => identityReader(pid, { helperPath, platform }); const self = [read(selfPid), read(selfPid)]; const parent = [read(parentPid), read(parentPid)]; const stable = (values, pid) => values.every(x => validIdentity(x, pid)) && values[0].identity === values[1].identity && values[0].start_sec === values[1].start_sec && values[0].start_usec === values[1].start_usec; if (!stable(self, selfPid) || !stable(parent, parentPid)) return { status: "ERROR", error_id: "MACOS-NATIVE-PID-PROOF-FAILED", proof: { self, parent }, mutations_performed: false }; return { status: "PASS", proof: { self: self[0], parent: parent[0] }, mutations_performed: false }; }

function verifyReceiptShape(receipt, paths, state) {
  if (!receipt || receipt.schema_version !== 1 || receipt.status !== "VERIFIED" || receipt.installation_id !== state.installation_id || receipt.instance_path !== paths.instanceRoot || receipt.helper_path !== paths.helperPath || receipt.source_review_commit !== REVIEWED_SOURCE_COMMIT || receipt.source_sha256 !== REVIEWED_SOURCE_SHA256 || receipt.architecture !== os.arch() || typeof receipt.binary_sha256 !== "string" || !/^([a-f0-9]{64})$/.test(receipt.binary_sha256) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ$/.test(String(receipt.timestamp || ""))) return false;
  const proof = receipt.proof;
  return validIdentity(proof?.self, proof?.self?.pid) && validIdentity(proof?.parent, proof?.parent?.pid) && proof.self.status === "OK" && proof.parent.status === "OK";
}

function journalShape(journal, paths, state) {
  return journal && journal.schema_version === 1 && ["PREPARED", "HELPER_PUBLISHED", "COMPLETE"].includes(journal.phase) && journal.installation_id === state.installation_id && journal.instance_path === paths.instanceRoot && journal.helper_path === paths.helperPath && journal.receipt_path === paths.receiptPath && journal.source_review_commit === REVIEWED_SOURCE_COMMIT && journal.source_sha256 === REVIEWED_SOURCE_SHA256 && typeof journal.binary_sha256 === "string" && /^[a-f0-9]{64}$/.test(journal.binary_sha256) && journal.architecture === os.arch() && journal.proof && validIdentity(journal.proof.self, journal.proof.self.pid) && validIdentity(journal.proof.parent, journal.proof.parent.pid);
}
function readTrustedJournal(paths, state, fsImpl) {
  const safe = safeExistingPath(paths.journalPath, { privateFile: true, strictAncestors: true, fsImpl });
  if (!safe.ok) return { ok: false, error_id: fsImpl.existsSync(paths.journalPath) ? "MACOS-NATIVE-JOURNAL-UNTRUSTED" : "MACOS-NATIVE-RECOVERY-JOURNAL-MISSING", reason: safe.reason };
  try { const journal = JSON.parse(fsImpl.readFileSync(paths.journalPath, "utf8")); return journalShape(journal, paths, state) ? { ok: true, journal } : { ok: false, error_id: "MACOS-NATIVE-JOURNAL-MISMATCH", reason: "journal identity or phase is not exact" }; } catch (error) { return { ok: false, error_id: "MACOS-NATIVE-JOURNAL-CORRUPT", reason: String(error.message || error) }; }
}
function recoveryFailure(paths, error_id, reason) { return { status: "ERROR", error_id, recovery_status: "MANUAL_RECOVERY_REQUIRED", action: "Do not delete or replace the helper or receipt automatically; preserve evidence and perform installation-specific manual recovery.", instance_path: paths.instanceRoot, helper_path: paths.helperPath, receipt_path: paths.receiptPath, journal_path: paths.journalPath, reason, mutations_performed: false }; }
function writerId(state) { return String(state.macos_native_writer_id || `pid:${process.pid}`); }
function writerClaim(paths, state, fsImpl) {
  const lockPath = path.join(paths.instanceRoot, INSTALL_LOCK_NAME); const id = writerId(state);
  const claim = { schema_version: 1, owner_id: id, pid: process.pid, installation_id: state.installation_id, instance_path: paths.instanceRoot, created_at: new Date().toISOString() };
  try { atomicPrivateJson(lockPath, claim, fsImpl, { replace: false }); return { status: "OWNED", lockPath, owner_id: id }; }
  catch (error) {
    if (error?.code !== "EEXIST") return { status: "UNKNOWN", lockPath, reason: String(error.message || error) };
    try {
      const safe = safeExistingPath(lockPath, { privateFile: true, strictAncestors: true, fsImpl });
      if (!safe.ok) return { status: "UNKNOWN", lockPath, reason: safe.reason };
      const existing = JSON.parse(fsImpl.readFileSync(lockPath, "utf8"));
      if (existing.schema_version !== 1 || existing.installation_id !== state.installation_id || existing.instance_path !== paths.instanceRoot || typeof existing.owner_id !== "string" || !Number.isSafeInteger(existing.pid) || existing.pid <= 0) return { status: "UNKNOWN", lockPath, reason: "existing writer claim is invalid or ambiguous" };
      if (existing.owner_id === id) return { status: "OWNED", lockPath, owner_id: id, resumed: true };
      let active = false; try { process.kill(existing.pid, 0); active = true; } catch (probe) { active = probe?.code === "EPERM"; }
      return { status: active ? "BUSY" : "UNKNOWN", lockPath, owner_id: existing.owner_id, pid: existing.pid, reason: active ? "another writer owns this installation" : "writer claim may be stale; refusing reclamation" };
    } catch (readError) { return { status: "UNKNOWN", lockPath, reason: String(readError.message || readError) }; }
  }
}
function writerClaimFailure(paths, claim) { return { status: "ERROR", error_id: claim.status === "BUSY" ? "MACOS-NATIVE-INSTALL-BUSY" : "MACOS-NATIVE-INSTALL-OWNERSHIP-UNKNOWN", recovery_status: "MANUAL_RECOVERY_REQUIRED", action: "Retry only with the verified same writer owner, or resolve the existing writer claim manually; do not delete or replace the helper, receipt, journal, or claim.", instance_path: paths.instanceRoot, helper_path: paths.helperPath, receipt_path: paths.receiptPath, journal_path: paths.journalPath, lock_path: claim.lockPath, reason: claim.reason, mutations_performed: false }; }

export function prepareMacosNativeHelper({ state = {}, home = os.homedir(), sourcePath = REVIEWED_SOURCE_PATH, platform = process.platform, commandRunner = defaultRunner, fsImpl = fs, identityReader, approved = state.macos_setup_approved === true } = {}) {
  if (platform !== "darwin") return { status: "UNSUPPORTED", mutations_performed: false, error_id: "MACOS-NATIVE-UNSUPPORTED" }; if (!approved) return { status: "NEEDS_USER_ACTION", mutations_performed: false, error_id: "MACOS-NATIVE-APPROVAL", action_id: "macos_setup_approval" }; const installationId = String(state.installation_id || ""); if (!installationId || state.macos_native_installation_id && state.macos_native_installation_id !== installationId) return { status: "ERROR", mutations_performed: false, error_id: "MACOS-NATIVE-INSTALLATION-MISMATCH" };
  const paths = macosNativeHelperPaths({ home, installationId });
  const hasReceipt = fsImpl.existsSync(paths.receiptPath), hasHelper = fsImpl.existsSync(paths.helperPath);
  if (hasReceipt || hasHelper) {
    if (hasHelper && !hasReceipt) {
      const trusted = readTrustedJournal(paths, state, fsImpl);
      if (!trusted.ok) return recoveryFailure(paths, trusted.error_id, trusted.reason);
      const claim = writerClaim(paths, state, fsImpl); if (claim.status !== "OWNED") return writerClaimFailure(paths, claim);
      const helper = safeExistingPath(paths.helperPath, { executable: true, fsImpl });
      if (!helper.ok || !exactMode(fsImpl.lstatSync(paths.helperPath), 0o700) || sha256(paths.helperPath, fsImpl) !== trusted.journal.binary_sha256) return recoveryFailure(paths, "MACOS-NATIVE-RECOVERY-BINARY-MISMATCH", "helper permissions or digest do not match the exact durable journal");
      const sourceNow = sourceCheck(sourcePath, fsImpl); if (sourceNow.status !== "PASS" || sourceNow.source_sha256 !== trusted.journal.source_sha256) return recoveryFailure(paths, "MACOS-NATIVE-RECOVERY-SOURCE-MISMATCH", "reviewed source no longer matches the journal");
      const proof = proofIdentity(paths.helperPath, { platform, identityReader, parentPid: state.parent_pid ?? process.ppid });
      if (proof.status !== "PASS") return { ...proof, recovery_status: "MANUAL_RECOVERY_REQUIRED", journal_path: paths.journalPath, mutations_performed: false };
      const receipt = { schema_version: 1, status: "VERIFIED", installation_id: installationId, instance_path: paths.instanceRoot, helper_path: paths.helperPath, source_review_commit: REVIEWED_SOURCE_COMMIT, source_sha256: trusted.journal.source_sha256, binary_sha256: trusted.journal.binary_sha256, architecture: os.arch(), proof: proof.proof, timestamp: new Date().toISOString() };
      try { atomicReceipt(paths.receiptPath, receipt, fsImpl); atomicPrivateJson(paths.journalPath, { ...trusted.journal, phase: "COMPLETE", receipt_timestamp: receipt.timestamp }, fsImpl); } catch (error) { return { ...recoveryFailure(paths, "MACOS-NATIVE-RECOVERY-COMMIT-FAILED", String(error.message || error)), mutations_performed: true, pending_receipt: receipt }; }
      return { ...receipt, status: "PASS", mutations_performed: true, receipt_path: paths.receiptPath, idempotent: true, recovered: true };
    }
    const existing = verifyMacosNativeCapability({ state, home, platform, fsImpl, identityReader, parentPid: state.parent_pid ?? process.ppid });
    if (existing.status === "PASS") return { ...existing, mutations_performed: false, idempotent: true };
    return { ...existing, mutations_performed: false, error_id: existing.error_id || "MACOS-NATIVE-CAPABILITY-CORRUPT" };
  }
  const preflight = macosNativeHelperPreflight({ platform, home, installationId, sourcePath, commandRunner, fsImpl }); if (preflight.status === "ERROR" || preflight.toolchain?.xcrun !== true || preflight.toolchain?.headers !== true) return { ...preflight, mutations_performed: false };
  const secondSource = sourceCheck(sourcePath, fsImpl); if (secondSource.status !== "PASS") return { ...secondSource, mutations_performed: false };
  let mutationStage = "none";
  try { const rootAncestors = existingPrivateAncestors(paths.instanceRoot, fsImpl); if (!rootAncestors.ok) throw new Error(`Unsafe private instance path: ${rootAncestors.reason}`); mutationStage = "directories_pending"; ensurePrivateTree(paths.instanceRoot, fsImpl); ensurePrivateTree(path.dirname(paths.helperPath), fsImpl); mutationStage = "directories"; }
  catch (error) { const message = String(error.message || error); const reason = message.includes("Unsafe private instance path:") ? message.replace(/^.*Unsafe private instance path: /, "") : "private directory filesystem operation failed"; return { status: "ERROR", error_id: "MACOS-NATIVE-INSTANCE-UNSAFE", mutations_performed: mutationStage === "none" ? false : "UNKNOWN", instance: { instance_root: paths.instanceRoot, private_root: false }, details: `Unable to prepare the private native instance directory: ${reason}` }; }
  const claim = writerClaim(paths, state, fsImpl); if (claim.status !== "OWNED") return writerClaimFailure(paths, claim);
  const temp = path.join(paths.instanceRoot, `.process-identity.${process.pid}.${crypto.randomUUID()}.tmp`);
  const snapshot = path.join(paths.instanceRoot, `.reviewed-source.${process.pid}.${crypto.randomUUID()}.c`);
  const source = snapshotReviewedSource(sourcePath, snapshot, fsImpl); if (source.status !== "PASS") return { ...source, mutations_performed: mutationStage !== "none" ? "UNKNOWN" : false };
  const sdk = String(commandResult(commandRunner, "xcrun", ["--sdk", "macosx", "--show-sdk-path"]).stdout || "").trim();
  const beforeCompile = sourceCheck(sourcePath, fsImpl); if (beforeCompile.status !== "PASS") { try { fsImpl.unlinkSync(snapshot); } catch {} return { ...beforeCompile, mutations_performed: "UNKNOWN" }; }
  const args = ["--sdk", "macosx", "clang", "-std=c11", "-Wall", "-Wextra", "-Werror", "-isysroot", sdk, snapshot, "-o", temp];
  const built = commandResult(commandRunner, "xcrun", args); try { fsImpl.unlinkSync(snapshot); } catch {}
  if (!built.ok) return { status: "ERROR", error_id: "MACOS-NATIVE-BUILD-FAILED", mutations_performed: true, details: String(built.stderr || built.stdout || "compile failed").slice(0, MAX_OUTPUT) };
  const binary = safeExistingPath(temp, { executable: true, fsImpl }); if (!binary.ok) return { status: "ERROR", error_id: "MACOS-NATIVE-BINARY-UNSAFE", mutations_performed: true, details: binary.reason };
  const binarySha256 = sha256(temp, fsImpl); const proof = proofIdentity(temp, { platform, identityReader, parentPid: state.parent_pid ?? process.ppid });
  if (proof.status !== "PASS") return { ...proof, error_id: proof.error_id, mutations_performed: true, source_sha256: source.source_sha256, binary_sha256: binarySha256 };
  const targetSafe = fsImpl.existsSync(paths.helperPath) ? safeExistingPath(paths.helperPath, { executable: true, fsImpl }) : { ok: true }; if (!targetSafe.ok) return { status: "ERROR", error_id: "MACOS-NATIVE-TARGET-COLLISION", mutations_performed: true, details: targetSafe.reason };
  const journal = { schema_version: 1, phase: "PREPARED", installation_id: installationId, instance_path: paths.instanceRoot, helper_path: paths.helperPath, receipt_path: paths.receiptPath, source_review_commit: REVIEWED_SOURCE_COMMIT, source_sha256: source.source_sha256, binary_sha256: binarySha256, architecture: os.arch(), proof: proof.proof, created_at: new Date().toISOString() };
  try { atomicPrivateJson(paths.journalPath, journal, fsImpl, { replace: false }); mutationStage = "journal"; if (!fsImpl.existsSync(paths.helperPath)) fsImpl.renameSync(temp, paths.helperPath); else return { status: "ERROR", error_id: "MACOS-NATIVE-TARGET-COLLISION", mutations_performed: true, journal_path: paths.journalPath }; fsImpl.chmodSync(paths.helperPath, 0o700); const helperDirFd = fsImpl.openSync(path.dirname(paths.helperPath), "r"); try { fsImpl.fsyncSync(helperDirFd); } finally { fsImpl.closeSync(helperDirFd); } mutationStage = "helper_published"; atomicPrivateJson(paths.journalPath, { ...journal, phase: "HELPER_PUBLISHED" }, fsImpl); const receipt = { schema_version: 1, status: "VERIFIED", installation_id: installationId, instance_path: paths.instanceRoot, helper_path: paths.helperPath, source_review_commit: REVIEWED_SOURCE_COMMIT, source_sha256: source.source_sha256, binary_sha256: binarySha256, architecture: os.arch(), proof: proof.proof, timestamp: new Date().toISOString() }; atomicReceipt(paths.receiptPath, receipt, fsImpl); atomicPrivateJson(paths.journalPath, { ...journal, phase: "COMPLETE", receipt_timestamp: receipt.timestamp }, fsImpl); return { ...receipt, status: "PASS", mutations_performed: true, receipt_path: paths.receiptPath, journal_path: paths.journalPath }; }
  catch (error) { return { status: "ERROR", error_id: mutationStage === "helper_published" ? "MACOS-NATIVE-RECEIPT-WRITE" : "MACOS-NATIVE-PUBLISH", recovery_status: "RESUME_ALLOWED_ONLY_WITH_EXACT_JOURNAL", journal_path: paths.journalPath, helper_path: paths.helperPath, receipt_path: paths.receiptPath, details: String(error.message || error), mutations_performed: mutationStage === "helper_published" ? true : "UNKNOWN" }; }
}

export function verifyMacosNativeCapability({ state = {}, home = os.homedir(), platform = process.platform, fsImpl = fs, identityReader, parentPid = state.parent_pid ?? process.ppid } = {}) { if (platform !== "darwin") return { status: "UNSUPPORTED", mutations_performed: false }; try { const paths = macosNativeHelperPaths({ home, installationId: state.installation_id }); const root = safePrivateDirectory(paths.instanceRoot, fsImpl); const journal = readTrustedJournal(paths, state, fsImpl); const receiptSafe = safeExistingPath(paths.receiptPath, { privateFile: true, strictAncestors: true, fsImpl }); const helper = safeExistingPath(paths.helperPath, { executable: true, fsImpl }); const receipt = JSON.parse(fsImpl.readFileSync(paths.receiptPath, "utf8")); const receiptStat = fsImpl.lstatSync(paths.receiptPath), helperStat = fsImpl.lstatSync(paths.helperPath); if (!root.ok || !journal.ok || !receiptSafe.ok || !helper.ok || !exactMode(receiptStat, 0o600) || !exactMode(helperStat, 0o700) || !verifyReceiptShape(receipt, paths, state) || receipt.binary_sha256 !== journal.journal.binary_sha256 || sha256(paths.helperPath, fsImpl) !== receipt.binary_sha256) return { status: "ERROR", error_id: journal.ok ? "MACOS-NATIVE-CAPABILITY-CORRUPT" : journal.error_id, mutations_performed: false, recovery_status: "MANUAL_RECOVERY_REQUIRED" }; const live = proofIdentity(paths.helperPath, { platform, identityReader, parentPid }); if (live.status !== "PASS") return { status: "ERROR", error_id: "MACOS-NATIVE-PID-PROOF-FAILED", mutations_performed: false }; return { ...receipt, status: "PASS", mutations_performed: false, receipt_path: paths.receiptPath, journal_path: paths.journalPath, live_proof: live.proof }; } catch (error) { return { status: "ERROR", error_id: "MACOS-NATIVE-CAPABILITY-MISSING", mutations_performed: false, details: String(error.message || error) }; } }
