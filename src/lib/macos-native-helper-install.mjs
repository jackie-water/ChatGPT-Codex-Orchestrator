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
export const HELPER_RELATIVE_PATH = path.join("runtime", "native", "macos", "process-identity");
export const RECEIPT_NAME = "macos-native-helper-capability.json";
const MAX_OUTPUT = 8192;
const owner = () => typeof process.getuid === "function" ? process.getuid() : null;
const defaultRunner = (command, args, options = {}) => { const r = realSpawnSync(command, args, { encoding: "utf8", shell: false, timeout: 5000, maxBuffer: MAX_OUTPUT, ...options }); return { status: r.status, ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error }; };
const sha256 = (file, fsImpl = fs) => crypto.createHash("sha256").update(fsImpl.readFileSync(file)).digest("hex");
const uidAllowed = (st, uid = owner()) => uid === null || st.uid === uid || st.uid === 0;
const modePrivate = st => (st.mode & 0o077) === 0;
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
      if (!target.isDirectory() || !uidAllowed(target) || (strictAncestors ? !modePrivate(target) : (target.mode & 0o022) !== 0)) return { ok: false, reason: "unsafe-symlink-ancestor", path: current };
    }
    const ancestorStat = st.isSymbolicLink() ? (() => { try { return fsImpl.statSync(current); } catch { return null; } })() : st;
    if (current !== normalized && (!ancestorStat?.isDirectory() || !uidAllowed(ancestorStat) || (strictAncestors ? !modePrivate(ancestorStat) : (ancestorStat.mode & 0o022) !== 0))) return { ok: false, reason: "unsafe-ancestor", path: current };
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
    if (!target?.isDirectory() || !uidAllowed(target) || (target.mode & 0o022) !== 0) return { ok: false, reason: "unsafe-directory", path: current };
    if (current === normalized && !modePrivate(target)) return { ok: false, reason: "unsafe-directory-mode", path: current };
  }
  return { ok: true, path: normalized };
}
function privateInstanceRoot(home, installationId) { if (!installationId) throw new Error("installation_id is required"); return path.join(path.resolve(home), ".chatgpt-codex-orchestrator", "instances", canonicalInstallationId(installationId)); }
export function macosNativeHelperPaths({ home = os.homedir(), installationId } = {}) { const instanceRoot = privateInstanceRoot(home, installationId); return { instanceRoot, helperPath: path.join(instanceRoot, HELPER_RELATIVE_PATH), receiptPath: path.join(instanceRoot, RECEIPT_NAME) }; }

function sourceCheck(sourcePath, fsImpl) {
  const safe = safeExistingPath(sourcePath, { fsImpl });
  if (!safe.ok) return { status: "ERROR", error_id: "MACOS-NATIVE-SOURCE-UNSAFE", reason: safe.reason, source_path: sourcePath };
  let digest; try { digest = sha256(sourcePath, fsImpl); } catch (error) { return { status: "ERROR", error_id: "MACOS-NATIVE-SOURCE-UNREADABLE", details: String(error.message || error) }; }
  if (digest !== REVIEWED_SOURCE_SHA256) return { status: "ERROR", error_id: "MACOS-NATIVE-SOURCE-MISMATCH", source_sha256: digest, expected_source_sha256: REVIEWED_SOURCE_SHA256 };
  return { status: "PASS", source_path: path.resolve(sourcePath), source_sha256: digest };
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
function ensurePrivateTree(dir, fsImpl) { fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 }); const check = safePrivateDirectory(dir, fsImpl); if (!check.ok) throw new Error(`Unsafe private instance path: ${check.reason}`); fsImpl.chmodSync(dir, 0o700); }
function atomicReceipt(file, value, fsImpl) { const dir = path.dirname(file); const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`; const fd = fsImpl.openSync(temp, "wx", 0o600); try { fsImpl.writeFileSync(fd, JSON.stringify(value, null, 2)); fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); } fsImpl.renameSync(temp, file); const dfd = fsImpl.openSync(dir, "r"); try { fsImpl.fsyncSync(dfd); } finally { fsImpl.closeSync(dfd); } fsImpl.chmodSync(file, 0o600); }
function proofIdentity(helperPath, { platform, identityReader = readMacosNativeProcessIdentity, selfPid = process.pid, parentPid = process.ppid } = {}) { if (!Number.isInteger(parentPid) || parentPid <= 0) return { status: "ERROR", error_id: "MACOS-NATIVE-PARENT-PID-UNAVAILABLE", mutations_performed: false }; const read = pid => identityReader(pid, { helperPath, platform }); const self = [read(selfPid), read(selfPid)]; const parent = [read(parentPid), read(parentPid)]; const stable = values => values.every(x => x?.status === "OK") && values[0].identity === values[1].identity; if (!stable(self) || !stable(parent)) return { status: "ERROR", error_id: "MACOS-NATIVE-PID-PROOF-FAILED", proof: { self, parent }, mutations_performed: false }; return { status: "PASS", proof: { self: self[0], parent: parent[0] }, mutations_performed: false }; }

export function prepareMacosNativeHelper({ state = {}, home = os.homedir(), sourcePath = REVIEWED_SOURCE_PATH, platform = process.platform, commandRunner = defaultRunner, fsImpl = fs, identityReader, approved = state.macos_setup_approved === true } = {}) {
  if (platform !== "darwin") return { status: "UNSUPPORTED", mutations_performed: false, error_id: "MACOS-NATIVE-UNSUPPORTED" }; if (!approved) return { status: "NEEDS_USER_ACTION", mutations_performed: false, error_id: "MACOS-NATIVE-APPROVAL", action_id: "macos_setup_approval" }; const installationId = String(state.installation_id || ""); if (!installationId || state.macos_native_installation_id && state.macos_native_installation_id !== installationId) return { status: "ERROR", mutations_performed: false, error_id: "MACOS-NATIVE-INSTALLATION-MISMATCH" };
  const paths = macosNativeHelperPaths({ home, installationId }); const preflight = macosNativeHelperPreflight({ platform, home, installationId, sourcePath, commandRunner, fsImpl }); if (preflight.status === "ERROR" || preflight.toolchain?.xcrun !== true || preflight.toolchain?.headers !== true) return { ...preflight, mutations_performed: false }; ensurePrivateTree(paths.instanceRoot, fsImpl); ensurePrivateTree(path.dirname(paths.helperPath), fsImpl); const source = sourceCheck(sourcePath, fsImpl); const sdk = String(commandResult(commandRunner, "xcrun", ["--sdk", "macosx", "--show-sdk-path"]).stdout || "").trim(); const temp = path.join(paths.instanceRoot, `.process-identity.${process.pid}.${crypto.randomUUID()}.tmp`); const args = ["--sdk", "macosx", "clang", "-std=c11", "-Wall", "-Wextra", "-Werror", "-isysroot", sdk, sourcePath, "-o", temp]; const built = commandResult(commandRunner, "xcrun", args); if (!built.ok) return { status: "ERROR", error_id: "MACOS-NATIVE-BUILD-FAILED", mutations_performed: true, details: String(built.stderr || built.stdout || "compile failed").slice(0, MAX_OUTPUT) }; const binary = safeExistingPath(temp, { executable: true, fsImpl }); if (!binary.ok) return { status: "ERROR", error_id: "MACOS-NATIVE-BINARY-UNSAFE", mutations_performed: true, details: binary.reason }; const binarySha256 = sha256(temp, fsImpl); const proof = proofIdentity(temp, { platform, identityReader, parentPid: state.parent_pid ?? process.ppid }); if (proof.status !== "PASS") return { ...proof, error_id: proof.error_id, mutations_performed: true, source_sha256: source.source_sha256, binary_sha256: binarySha256 }; const targetSafe = fsImpl.existsSync(paths.helperPath) ? safeExistingPath(paths.helperPath, { executable: true, fsImpl }) : { ok: true }; if (!targetSafe.ok) return { status: "ERROR", error_id: "MACOS-NATIVE-TARGET-COLLISION", mutations_performed: true, details: targetSafe.reason }; if (fsImpl.existsSync(paths.helperPath) && sha256(paths.helperPath, fsImpl) !== binarySha256) return { status: "ERROR", error_id: "MACOS-NATIVE-TARGET-MISMATCH", mutations_performed: true }; if (!fsImpl.existsSync(paths.helperPath)) fsImpl.renameSync(temp, paths.helperPath); else { try { fsImpl.unlinkSync(temp); } catch {} } fsImpl.chmodSync(paths.helperPath, 0o700); const receipt = { schema_version: 1, status: "VERIFIED", installation_id: installationId, instance_path: paths.instanceRoot, helper_path: paths.helperPath, source_sha256: source.source_sha256, binary_sha256: binarySha256, architecture: os.arch(), proof: proof.proof, timestamp: new Date().toISOString() }; atomicReceipt(paths.receiptPath, receipt, fsImpl); return { ...receipt, status: "PASS", mutations_performed: true, receipt_path: paths.receiptPath };
}

export function verifyMacosNativeCapability({ state = {}, home = os.homedir(), platform = process.platform, fsImpl = fs } = {}) { if (platform !== "darwin") return { status: "UNSUPPORTED", mutations_performed: false }; try { const paths = macosNativeHelperPaths({ home, installationId: state.installation_id }); const receipt = JSON.parse(fsImpl.readFileSync(paths.receiptPath, "utf8")); const helper = safeExistingPath(paths.helperPath, { executable: true, fsImpl }); if (!helper.ok || receipt.status !== "VERIFIED" || receipt.installation_id !== state.installation_id || receipt.helper_path !== paths.helperPath || receipt.instance_path !== paths.instanceRoot || receipt.source_sha256 !== REVIEWED_SOURCE_SHA256 || sha256(paths.helperPath, fsImpl) !== receipt.binary_sha256) return { status: "ERROR", error_id: "MACOS-NATIVE-CAPABILITY-CORRUPT", mutations_performed: false }; return { ...receipt, status: "PASS", mutations_performed: false }; } catch (error) { return { status: "ERROR", error_id: "MACOS-NATIVE-CAPABILITY-MISSING", mutations_performed: false, details: String(error.message || error) }; } }
