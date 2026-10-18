import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  assert.equal(nativeProcessStartIdentity(42, { helperPath: "/bin/sh", spawnSync: () => ({ status: 66, stdout: JSON.stringify({ status: "MISSING", pid: 42, errno: 3 }) + "\n", signal: null }) }), null);
});

test("non-OK records require the exact errno and native exit contract", () => {
  assert.equal(parseMacosNativeProcessIdentity(JSON.stringify({ status: "MISSING", pid: 42 }) + "\n", 42).status, "MALFORMED_OUTPUT");
  assert.equal(parseMacosNativeProcessIdentity(JSON.stringify({ status: "PERMISSION_DENIED", pid: 42, errno: 13 }) + "\n", 42).status, "PERMISSION_DENIED");
  assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: "/bin/sh", spawnSync: () => ({ status: 0, signal: null, stdout: JSON.stringify({ status: "MISSING", pid: 42, errno: 3 }) + "\n" }) }).status, "NATIVE_FAILURE");
  assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: "/bin/sh", spawnSync: () => ({ status: 66, signal: null, stdout: JSON.stringify({ status: "MISSING", pid: 42, errno: 3 }) + "\n" }) }).status, "MISSING");
  assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: "/bin/sh", spawnSync: () => ({ status: 77, signal: null, stdout: JSON.stringify({ status: "PERMISSION_DENIED", pid: 42, errno: 1 }) + "\n" }) }).status, "PERMISSION_DENIED");
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

test("native observation uses one bounded privileged invocation and preserves strict identity parsing", () => {
  const invocations = [];
  const observed = readMacosNativeProcessIdentity(42, {
    platform: "darwin",
    helperPath: "/bin/sh",
    spawnSync: (file, argv, options) => {
      invocations.push({ file, argv, options });
      return { status: 0, signal: null, stdout: record(42, 1792231843, 243316) };
    }
  });
  assert.equal(observed.status, "OK");
  assert.equal(observed.identity, "1792231843:243316");
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].file, "/bin/sh");
  assert.deepEqual(invocations[0].argv, ["42"]);
  assert.deepEqual(invocations[0].options, {
    cwd: "/",
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
    shell: false,
    timeout: 500,
    maxBuffer: 4096,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
});

test("native timeout and signal outcomes fail closed without retry or identity claim", () => {
  for (const child of [
    { error: { code: "ETIMEDOUT" }, status: null, signal: null, stdout: "" },
    { status: null, signal: "SIGTERM", stdout: "" }
  ]) {
    let calls = 0;
    const observed = readMacosNativeProcessIdentity(42, {
      platform: "darwin",
      helperPath: "/bin/sh",
      spawnSync: () => { calls += 1; return child; }
    });
    assert.equal(observed.status, "RUNNER_TIMEOUT");
    assert.equal(calls, 1);
    assert.throws(
      () => nativeProcessStartIdentity(42, { platform: "darwin", helperPath: "/bin/sh", spawnSync: () => child }),
      error => error.code === "NATIVE_PROCESS_IDENTITY_RUNNER_TIMEOUT"
    );
  }
});

test("unexpected native execution errors and malformed output remain fail-closed", () => {
  assert.equal(readMacosNativeProcessIdentity(42, {
    platform: "darwin", helperPath: "/bin/sh", spawnSync: () => { throw Object.assign(new Error("I/O failure"), { code: "EIO" }); }
  }).status, "RUNNER_ERROR");
  assert.equal(readMacosNativeProcessIdentity(42, {
    platform: "darwin", helperPath: "/bin/sh", spawnSync: () => ({ status: 70, signal: null, stdout: JSON.stringify({ status: "UNEXPECTED_ERROR", pid: 42, errno: 5 }) + "\n" })
  }).status, "UNEXPECTED_ERROR");
  assert.equal(readMacosNativeProcessIdentity(42, {
    platform: "darwin", helperPath: "/private/tmp/no-such-process-identity-helper", spawnSync: () => { throw new Error("must not run"); }
  }).status, "HELPER_UNAVAILABLE");
});

test("trusted helper accepts normalized absolute paths while checking lexical ancestors", () => {
  const observed = readMacosNativeProcessIdentity(42, {
    platform: "darwin", helperPath: "/bin/../bin/sh",
    spawnSync: () => ({ status: 0, signal: null, stdout: record(42, 9, 8) })
  });
  assert.equal(observed.status, "OK");
});

test("missing native helper is actionable and never falls back to ps", () => {
  const observed = readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: "/private/tmp/no-such-process-identity-helper" });
  assert.equal(observed.status, "HELPER_UNAVAILABLE"); assert.match(observed.actionable, /Install/);
});

test("helper trust covers private ancestors, symlink targets, and target replacement", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".native-identity-test-"));
  const safe = path.join(root, "safe"), unsafe = path.join(root, "unsafe");
  fs.mkdirSync(safe, { mode: 0o700 }); fs.mkdirSync(unsafe, { mode: 0o700 });
  const helper = path.join(safe, "helper"), link = path.join(safe, "helper-link"), replacement = path.join(safe, "replacement");
  try {
    fs.writeFileSync(helper, "placeholder", { mode: 0o700 });
    fs.symlinkSync(helper, link);
    const spawn = () => ({ status: 0, signal: null, stdout: record(42, 9, 8) });
    assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: link, spawnSync: spawn }).status, "OK");
    fs.chmodSync(safe, 0o777);
    assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: link, spawnSync: spawn }).status, "HELPER_UNAVAILABLE");
    fs.chmodSync(safe, 0o700);
    fs.unlinkSync(helper); fs.writeFileSync(replacement, "replacement", { mode: 0o777 }); fs.chmodSync(replacement, 0o777); fs.unlinkSync(link); fs.symlinkSync(replacement, link);
    assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: link, spawnSync: spawn }).status, "HELPER_UNAVAILABLE");
    fs.writeFileSync(helper, "#!/bin/sh\n", { mode: 0o700 }); fs.chmodSync(helper, 0o700);
    fs.chmodSync(unsafe, 0o777);
    assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: path.join(safe, "helper"), spawnSync: spawn }).status, "OK");
    assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: `${unsafe}/../safe/helper`, spawnSync: spawn }).status, "HELPER_UNAVAILABLE");
    fs.chmodSync(unsafe, 0o700);
    assert.equal(readMacosNativeProcessIdentity(42, { platform: "darwin", helperPath: `${unsafe}/../safe/helper`, spawnSync: spawn }).status, "OK");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
