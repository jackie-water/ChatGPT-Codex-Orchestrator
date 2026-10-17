import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { macosNativeHelperPreflight, prepareMacosNativeHelper, verifyMacosNativeCapability, macosNativeHelperPaths, REVIEWED_SOURCE_PATH, REVIEWED_SOURCE_SHA256 } from "../src/lib/macos-native-helper-install.mjs";

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
  let processGeneration = 0;
  const identityReader = pid => ({ status: "OK", pid, identity: `${100 + processGeneration}:${String(pid).padStart(6, "0")}`, start_sec: 100 + processGeneration, start_usec: pid });
  const state = { installation_id: "fixture-22A1", macos_setup_approved: true, parent_pid: 123 };
  const result = prepareMacosNativeHelper({ state, home, platform: "darwin", commandRunner, identityReader });
  assert.equal(result.status, "PASS"); assert.equal(result.mutations_performed, true); assert.equal(result.source_sha256, REVIEWED_SOURCE_SHA256); assert.equal(calls.find(x => x.args.includes("-o")).args.includes("clang"), true);
  assert.equal(verifyMacosNativeCapability({ state, home, platform: "darwin", identityReader, parentPid: 123 }).status, "PASS");
  processGeneration = 1;
  const resumed = prepareMacosNativeHelper({ state, home, platform: "darwin", commandRunner, identityReader });
  assert.equal(resumed.status, "PASS"); assert.equal(resumed.idempotent, true); assert.equal(resumed.mutations_performed, false);
  const receiptText = fs.readFileSync(result.receipt_path, "utf8");
  fs.unlinkSync(result.receipt_path);
  assert.equal(verifyMacosNativeCapability({ state, home, platform: "darwin", identityReader, parentPid: 123 }).status, "ERROR");
  const tampered = JSON.parse(receiptText); tampered.source_review_commit = "tampered";
  fs.writeFileSync(result.receipt_path, JSON.stringify(tampered), { mode: 0o600 });
  assert.equal(verifyMacosNativeCapability({ state, home, platform: "darwin", identityReader, parentPid: 123 }).status, "ERROR");
  fs.writeFileSync(result.receipt_path, receiptText, { mode: 0o600 });
  fs.writeFileSync(result.helper_path, "replacement\n", { mode: 0o700 });
  assert.equal(verifyMacosNativeCapability({ state, home, platform: "darwin", identityReader, parentPid: 123 }).status, "ERROR");
});

test("snapshot trust accepts a normal fixture home and rejects writable user ancestors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-native-ancestor-"));
  const home = path.join(root, "home"); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const sdk = toolchain(home);
  const commandRunner = (command, args) => {
    if (args[0] === "--find") return { ok: true, status: 0, stdout: "/usr/bin/clang\n" };
    if (args[2] === "--show-sdk-path") return { ok: true, status: 0, stdout: sdk + "\n" };
    fs.writeFileSync(args[args.indexOf("-o") + 1], "isolated-helper\n", { mode: 0o700 }); return { ok: true, status: 0, stdout: "", stderr: "" };
  };
  const identityReader = pid => ({ status: "OK", pid, identity: `100:${String(pid).padStart(6, "0")}`, start_sec: 100, start_usec: pid });
  const state = { installation_id: "fixture-ancestor", macos_setup_approved: true, parent_pid: 123 };
  assert.equal(prepareMacosNativeHelper({ state, home, platform: "darwin", commandRunner, identityReader }).status, "PASS");
  const unsafeHome = path.join(root, "unsafe-home"); fs.mkdirSync(unsafeHome, { recursive: true, mode: 0o777 }); fs.chmodSync(unsafeHome, 0o777);
  assert.notEqual(fs.lstatSync(unsafeHome).mode & 0o022, 0);
  const unsafeResult = prepareMacosNativeHelper({ state: { ...state, installation_id: "fixture-unsafe" }, home: unsafeHome, platform: "darwin", commandRunner, identityReader });
  assert.equal(unsafeResult.status, "ERROR"); assert.equal(unsafeResult.mutations_performed, false); assert.equal(unsafeResult.instance.private_root, false);
});

test("unauthorized prepare and non-Darwin paths never mutate", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orch-native-gate-")); const before = fs.readdirSync(home);
  const result = prepareMacosNativeHelper({ state: { installation_id: "fixture", macos_setup_approved: false }, home, platform: "darwin" });
  assert.equal(result.status, "NEEDS_USER_ACTION"); assert.equal(result.mutations_performed, false); assert.deepEqual(fs.readdirSync(home), before);
  assert.equal(macosNativeHelperPreflight({ platform: "linux", home }).status, "UNSUPPORTED");
});

test("helper-only resume requires the exact journal and returns the canonical receipt path", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orch-native-recovery-")); const sdk = toolchain(home); const calls = [];
  const commandRunner = (command, args) => { calls.push(args); if (args[0] === "--find") return { ok: true, stdout: "/usr/bin/clang" }; if (args[2] === "--show-sdk-path") return { ok: true, stdout: `${sdk}\n` }; fs.writeFileSync(args[args.indexOf("-o") + 1], "isolated-helper\n", { mode: 0o700 }); return { ok: true, stdout: "" }; };
  const identityReader = pid => ({ status: "OK", pid, identity: `1:${pid}`, start_sec: 1, start_usec: pid });
  const state = { installation_id: "recovery-1", macos_setup_approved: true, parent_pid: 123 }; const first = prepareMacosNativeHelper({ state, home, platform: "darwin", commandRunner, identityReader }); const paths = macosNativeHelperPaths({ home, installationId: state.installation_id });
  assert.equal(first.status, "PASS"); fs.unlinkSync(paths.receiptPath); const journal = JSON.parse(fs.readFileSync(paths.journalPath, "utf8")); journal.phase = "HELPER_PUBLISHED"; fs.writeFileSync(paths.journalPath, JSON.stringify(journal), { mode: 0o600 });
  const resumed = prepareMacosNativeHelper({ state, home, platform: "darwin", commandRunner: () => { throw new Error("resume rebuilt unexpectedly"); }, identityReader });
  assert.equal(resumed.status, "PASS"); assert.equal(resumed.receipt_path, paths.receiptPath); assert.equal(resumed.helper_path, paths.helperPath); assert.equal(resumed.binary_sha256, first.binary_sha256); assert.equal(calls.filter(args => args.includes("-o")).length, 1);
  fs.unlinkSync(paths.receiptPath); journal.installation_id = "foreign"; fs.writeFileSync(paths.journalPath, JSON.stringify(journal), { mode: 0o600 });
  const foreign = prepareMacosNativeHelper({ state, home, platform: "darwin", commandRunner: () => { throw new Error("foreign artifact rebuilt unexpectedly"); }, identityReader });
  assert.equal(foreign.status, "ERROR"); assert.equal(foreign.recovery_status, "MANUAL_RECOVERY_REQUIRED"); assert.equal(fs.existsSync(paths.helperPath), true);
});
