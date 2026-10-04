import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { callbackReceiptMatches, receiptDomSource } from "../runtime/scripts/callback-receipt.mjs";

test("shipped callback entrypoints preserve the explicit route contract", () => {
  const wake = fs.readFileSync(new URL("../runtime/scripts/wake-chat.mjs", import.meta.url), "utf8");
  const powershell = fs.readFileSync(new URL("../runtime/scripts/wake-chat.ps1", import.meta.url), "utf8");
  assert.match(wake, /CODEX_CALLBACK_EXPECTED_FINGERPRINT/);
  assert.match(wake, /PRE_SEND_NOT_READY/);
  assert.match(wake, /CHAT_STATE_FINGERPRINT/);
  assert.match(powershell, /Callback record fingerprint did not match returned final fingerprint/);
  assert.match(powershell, /explicit-route-v1/);
  assert.equal(typeof receiptDomSource(), "string");
});

test("delivery matching rejects absent, quoted, assistant, and partial receipts", () => {
  const payload = "[CODEX-AUTO callback_id=literal] payload";
  assert.equal(callbackReceiptMatches(payload, "literal", payload), true);
  assert.equal(callbackReceiptMatches("", "literal", payload), false);
  assert.equal(callbackReceiptMatches(`> ${payload}`, "literal", payload), false);
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=literal] other", "literal", payload), false);
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=literal2] payload", "literal", payload), false);
});

test("wake-chat rejects missing or invalid callback IDs before browser discovery", async () => {
  for (const callbackId of [undefined, "", " ", "wake/id", "A".repeat(161)]) {
    const child = spawn(process.execPath, [new URL("../runtime/scripts/wake-chat.mjs", import.meta.url), "https://exact.example/payload"], {
      env: {...process.env, CODEX_CALLBACK_ID: callbackId, ORCHESTRATOR_CHAT_URL: "https://chatgpt.com/c/chat-27", ORCHESTRATOR_BROWSER_DEBUG_PORT: "1"},
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [code] = await new Promise(resolve => child.on("close", (exitCode, signal) => resolve([exitCode, signal])));
    assert.equal(code, 2);
    assert.match(stderr, /WAKE_CHAT_FAILED: valid CODEX_CALLBACK_ID is required/);
    assert.doesNotMatch(stderr, /ECONNREFUSED|debug|browser/i);
  }
});
