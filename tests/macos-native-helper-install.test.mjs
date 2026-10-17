import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { macosNativeHelperPreflight, prepareMacosNativeHelper, verifyMacosNativeCapability, REVIEWED_SOURCE_PATH, REVIEWED_SOURCE_SHA256 } from "../src/lib/macos-native-helper-install.mjs";

function toolchain(home) {
  const sdk = path.join(home, "sdk");
  fs.mkdirSync(path.join(sdk, "usr", "include", "sys"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(sdk, "usr", "include", "libproc.h"), "fixture\n", { mode: 0o600 });
  fs.writeFileSync(path.join(sdk, "usr", "include", "sys", "proc_info.h"), "fixture\n", { mode: 0o600 });
  return sdk;
}

test("macOS native preflight is read-only and reports reviewed source digest", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orch-native-preflight-"));
  const sdk = toolchain(home); const before = fs.readdirSync(home);
  const commandRunner = (command, args) => command === "xcrun" && args[0] === "--find" ? { ok: true, status: 0, stdout: "/usr/bin/clang\n" } : { ok: true, status: 0, stdout: sdk + "\n" };
  const result = macosNativeHelperPreflight({ platform: "darwin", home, commandRunner });
  assert.equal(result.mutations_performed, false); assert.equal(result.source.source_sha256, REVIEWED_SOURCE_SHA256); assert.deepEqual(fs.readdirSync(home), before);
});

test("preflight fails closed for an unreviewed source and missing compiler", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orch-native-negative-")); const source = path.join(home, "source.c"); fs.writeFileSync(source, "unsafe\n", { mode: 0o600 });
  const result = macosNativeHelperPreflight({ platform: "darwin", home, installationId: "wrong-id", sourcePath: source, commandRunner: () => ({ ok: false, status: 127, stdout: "", stderr: "missing" }) });
  assert.equal(result.status, "ERROR"); assert.equal(result.error_id, "MACOS-NATIVE-SOURCE-MISMATCH"); assert.equal(result.mutations_performed, false);
});

test("approved isolated prepare builds, proves, receipts, and verifies one instance", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orch-native-build-")); const sdk = toolchain(home); const calls = [];
  const commandRunner = (command, args) => {
    calls.push({ command, args });
    if (args[0] === "--find") return { ok: true, status: 0, stdout: "/usr/bin/clang\n" };
    if (args[2] === "--show-sdk-path") return { ok: true, status: 0, stdout: sdk + "\n" };
    const output = args[args.indexOf("-o") + 1]; fs.writeFileSync(output, "isolated-helper\n", { mode: 0o700 }); return { ok: true, status: 0, stdout: "", stderr: "" };
  };
  const identityReader = pid => ({ status: "OK", pid, identity: `100:${String(pid).padStart(6, "0")}`, start_sec: 100, start_usec: pid });
  const state = { installation_id: "fixture-22A1", macos_setup_approved: true, parent_pid: 123 };
  const result = prepareMacosNativeHelper({ state, home, platform: "darwin", commandRunner, identityReader });
  assert.equal(result.status, "PASS"); assert.equal(result.mutations_performed, true); assert.equal(result.source_sha256, REVIEWED_SOURCE_SHA256); assert.equal(calls.find(x => x.args.includes("-o")).args.includes("clang"), true);
  assert.equal(verifyMacosNativeCapability({ state, home, platform: "darwin" }).status, "PASS");
  fs.writeFileSync(result.helper_path, "replacement\n", { mode: 0o700 });
  assert.equal(verifyMacosNativeCapability({ state, home, platform: "darwin" }).status, "ERROR");
});

test("unauthorized prepare and non-Darwin paths never mutate", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orch-native-gate-")); const before = fs.readdirSync(home);
  const result = prepareMacosNativeHelper({ state: { installation_id: "fixture", macos_setup_approved: false }, home, platform: "darwin" });
  assert.equal(result.status, "NEEDS_USER_ACTION"); assert.equal(result.mutations_performed, false); assert.deepEqual(fs.readdirSync(home), before);
  assert.equal(macosNativeHelperPreflight({ platform: "linux", home }).status, "UNSUPPORTED");
});
