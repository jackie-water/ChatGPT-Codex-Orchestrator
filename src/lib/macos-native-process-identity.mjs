import fs from "node:fs";
import path from "node:path";
import { spawnSync as nativeSpawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT = 4096;
const TIMEOUT_MS = 250;
const PID_TEXT = /^[1-9][0-9]{0,9}$/;
const DEFAULT_HELPER = fileURLToPath(new URL("../../runtime/native/macos/process-identity", import.meta.url));

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
    return allowed.has(value.status) && value.pid === expectedPid ? result(value.status, { errno: value.errno }) : result("MALFORMED_OUTPUT");
  }
  if (Object.keys(value).sort().join(",") !== "pid,start_sec,start_usec,status" || value.pid !== expectedPid
    || !Number.isSafeInteger(value.start_sec) || value.start_sec < 0
    || !Number.isSafeInteger(value.start_usec) || value.start_usec < 0 || value.start_usec >= 1000000) return result("MALFORMED_OUTPUT");
  return result("OK", { identity: `${value.start_sec}:${String(value.start_usec).padStart(6, "0")}`, pid: value.pid, start_sec: value.start_sec, start_usec: value.start_usec });
}

function trustedHelper(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) return null;
  let resolved;
  try { resolved = fs.realpathSync(file); } catch { return null; }
  let stat;
  try { stat = fs.statSync(resolved); } catch { return null; }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!stat.isFile() || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0 || (uid !== null && stat.uid !== uid && stat.uid !== 0)) return null;
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
  if (parsed.status === "MALFORMED_OUTPUT" && child.status !== 0) return result("NATIVE_FAILURE", { exit_code: child.status });
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
