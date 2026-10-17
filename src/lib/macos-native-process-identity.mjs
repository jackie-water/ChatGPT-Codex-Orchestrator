import fs from "node:fs";
import path from "node:path";
import { spawnSync as nativeSpawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT = 4096;
const TIMEOUT_MS = 250;
const PID_TEXT = /^[1-9][0-9]{0,9}$/;
const DEFAULT_HELPER = fileURLToPath(new URL("../../runtime/native/macos/process-identity", import.meta.url));
const ERRNO = Object.freeze({ EINVAL: 22, EPERM: 1, EACCES: 13, ESRCH: 3 });
const EXIT = Object.freeze({ INVALID_PID: 64, SHORT_READ: 65, MISSING: 66, INVALID_TIMESTAMP: 69, UNEXPECTED_ERROR: 70, PERMISSION_DENIED: 77 });

const result = (status, details = {}) => ({ status, ...details });

export function parseMacosNativeProcessIdentity(output, expectedPid) {
  if (!Number.isInteger(expectedPid) || expectedPid <= 0 || expectedPid > 2147483647) return result("INVALID_PID");
  if (typeof output !== "string" || output.length === 0 || output.length > MAX_OUTPUT || !output.endsWith("\n") || output.slice(0, -1).includes("\n")) {
    return result("MALFORMED_OUTPUT");
  }
  let value;
  try { value = JSON.parse(output); } catch { return result("MALFORMED_OUTPUT"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return result("MALFORMED_OUTPUT");
  if (value.status !== "OK") {
    const allowed = new Set(["INVALID_PID", "MISSING", "PERMISSION_DENIED", "SHORT_READ", "UNEXPECTED_ERROR", "INVALID_TIMESTAMP"]);
    if (!allowed.has(value.status) || value.pid !== expectedPid) return result("MALFORMED_OUTPUT");
    const keys = Object.keys(value).sort().join(",");
    const errno = value.errno;
    const expectedErrno = value.status === "INVALID_PID" ? ERRNO.EINVAL
      : value.status === "MISSING" ? ERRNO.ESRCH
        : value.status === "PERMISSION_DENIED" ? [ERRNO.EPERM, ERRNO.EACCES] : null;
    const errnoValid = expectedErrno
      ? (!Number.isInteger(errno) || (Array.isArray(expectedErrno) ? !expectedErrno.includes(errno) : errno !== expectedErrno))
      : value.status === "UNEXPECTED_ERROR"
        ? (!Number.isInteger(errno) || errno <= 0)
        : (keys === "errno,pid,status" && errno !== 0);
    if (keys !== "pid,status" && keys !== "errno,pid,status") return result("MALFORMED_OUTPUT");
    if (errnoValid) return result("MALFORMED_OUTPUT");
    return result(value.status, { errno: errno ?? 0 });
  }
  if (Object.keys(value).sort().join(",") !== "pid,start_sec,start_usec,status" || value.pid !== expectedPid
    || !Number.isSafeInteger(value.start_sec) || value.start_sec < 0
    || !Number.isSafeInteger(value.start_usec) || value.start_usec < 0 || value.start_usec >= 1000000) return result("MALFORMED_OUTPUT");
  return result("OK", { identity: `${value.start_sec}:${String(value.start_usec).padStart(6, "0")}`, pid: value.pid, start_sec: value.start_sec, start_usec: value.start_usec });
}

function trustedHelper(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) return null;
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const trustedOwner = st => uid === null || st.uid === uid || st.uid === 0;
  const validateChain = (start, resolved) => {
    let current = path.parse(start).root;
    for (const part of start.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let st;
      try { st = fs.lstatSync(current); } catch { return false; }
      if (!trustedOwner(st) || (st.isDirectory() && (st.mode & 0o022) !== 0)) return false;
      if (st.isSymbolicLink()) {
        let target;
        try { target = fs.realpathSync(current); } catch { return false; }
        if (!validateChain(target, target)) return false;
      } else if (current !== start && !st.isDirectory()) return false;
    }
    return true;
  };
  let resolved;
  try { resolved = fs.realpathSync(file); } catch { return null; }
  if (!validateChain(file, resolved) || !validateChain(resolved, resolved)) return null;
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { return null; }
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0 || !trustedOwner(stat)) return null;
  return resolved;
}

export function readMacosNativeProcessIdentity(pid, { helperPath = process.env.ORCHESTRATOR_MACOS_NATIVE_HELPER || DEFAULT_HELPER, spawnSync = nativeSpawnSync, platform = process.platform } = {}) {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647 || !PID_TEXT.test(String(pid))) return result("INVALID_PID");
  if (platform !== "darwin") return result("UNSUPPORTED_OS");
  const helper = trustedHelper(helperPath);
  if (!helper) return result("HELPER_UNAVAILABLE", { actionable: "Install the signed/private Darwin libproc helper and configure ORCHESTRATOR_MACOS_NATIVE_HELPER." });
  let child;
  try {
    child = spawnSync(helper, [String(pid)], {
      cwd: "/",
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      shell: false,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return result("RUNNER_ERROR", { error_code: error?.code || "SPAWN_FAILED" });
  }
  if (!child || child.error?.code === "ETIMEDOUT" || child.signal) return result("RUNNER_TIMEOUT");
  if (typeof child.stdout !== "string" || child.stdout.length > MAX_OUTPUT) return result("MALFORMED_OUTPUT");
  const parsed = parseMacosNativeProcessIdentity(child.stdout, pid);
  if (parsed.status === "MALFORMED_OUTPUT") return result("NATIVE_FAILURE", { exit_code: child.status });
  const expectedExit = parsed.status === "OK" ? 0 : EXIT[parsed.status];
  if (!Number.isInteger(child.status) || child.status !== expectedExit) return result("NATIVE_FAILURE", { native_status: parsed.status, errno: parsed.errno, exit_code: child.status });
  return parsed;
}

export function macosNativeProcessIdentityEnabled() {
  return process.platform === "darwin" && process.env.ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY === "1";
}

export function nativeProcessStartIdentity(pid, options) {
  const observed = readMacosNativeProcessIdentity(pid, options);
  if (observed.status === "OK") return observed.identity;
  if (observed.status === "MISSING") return null;
  const error = new Error(`Darwin native process identity unavailable: ${observed.status}${observed.actionable ? `; ${observed.actionable}` : ""}`);
  error.code = `NATIVE_PROCESS_IDENTITY_${observed.status}`;
  throw error;
}
