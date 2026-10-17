import test from "node:test";
import assert from "node:assert/strict";
import { parseMacosNativeProcessIdentity, readMacosNativeProcessIdentity, nativeProcessStartIdentity } from "../src/lib/macos-native-process-identity.mjs";

const record = (pid, sec, usec) => JSON.stringify({ status: "OK", pid, start_sec: sec, start_usec: usec }) + "\n";

test("same-second PID reuse is distinguished by microseconds while the original owner is stable", () => {
  const original = parseMacosNativeProcessIdentity(record(42, 1792231843, 243316), 42);
  const reused = parseMacosNativeProcessIdentity(record(42, 1792231843, 243317), 42);
  const again = parseMacosNativeProcessIdentity(record(42, 1792231843, 243316), 42);
  assert.equal(original.status, "OK"); assert.equal(original.identity, again.identity); assert.notEqual(original.identity, reused.identity);
});

test("dead owner and permission denial are observable without claiming liveness", () => {
  assert.equal(parseMacosNativeProcessIdentity(JSON.stringify({ status: "MISSING", pid: 42, errno: 3 }) + "\n", 42).status, "MISSING");
  assert.equal(parseMacosNativeProcessIdentity(JSON.stringify({ status: "PERMISSION_DENIED", pid: 42, errno: 1 }) + "\n", 42).status, "PERMISSION_DENIED");
  assert.equal(nativeProcessStartIdentity(42, { helperPath: "/bin/sh", spawnSync: () => ({ status: 0, stdout: JSON.stringify({ status: "MISSING", pid: 42, errno: 3 }) + "\n", signal: null }) }), null);
});

test("strict parser rejects malformed, extra, truncated, and invalid timestamp output", () => {
  for (const output of ["", "{}\n", "{}\ntrailing\n", JSON.stringify({ status: "OK", pid: 42, start_sec: 1, start_usec: 1000000 }) + "\n", JSON.stringify({ status: "OK", pid: 43, start_sec: 1, start_usec: 1 }) + "\n"]) {
    assert.equal(parseMacosNativeProcessIdentity(output, 42).status, "MALFORMED_OUTPUT");
  }
});

test("unsupported operating systems fail before helper invocation", () => {
  let called = false;
  assert.equal(readMacosNativeProcessIdentity(42, { platform: "win32", helperPath: "/bin/sh", spawnSync: () => { called = true; } }).status, "UNSUPPORTED_OS");
  assert.equal(called, false);
});

test("malicious PID text cannot alter argv and runner is shell-free with bounded private environment", () => {
  let invocation;
  const observed = readMacosNativeProcessIdentity(42, {
    platform: "darwin",
    helperPath: "/bin/sh",
    spawnSync: (file, argv, options) => { invocation = { file, argv, options }; return { status: 0, signal: null, stdout: record(42, 9, 8) }; }
  });
  assert.equal(observed.status, "OK"); assert.deepEqual(invocation.argv, ["42"]); assert.equal(invocation.options.shell, false); assert.equal(invocation.options.cwd, "/"); assert.deepEqual(invocation.options.env, { PATH: "/usr/bin:/bin", LC_ALL: "C" });
  assert.equal(parseMacosNativeProcessIdentity(record(42, 9, 8), 42).status, "OK");
});

test("missing native helper is actionable and never falls back to ps", () => {
  const observed = readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: "/private/tmp/no-such-process-identity-helper" });
  assert.equal(observed.status, "HELPER_UNAVAILABLE"); assert.match(observed.actionable, /Install/);
});
