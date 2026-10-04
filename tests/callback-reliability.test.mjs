import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { callbackReceiptMatches, receiptDomSource } from "../runtime/scripts/callback-receipt.mjs";

const extract = (root) => vm.runInNewContext(`(${receiptDomSource()})`, {}).call(null, root);
const node = (attrs, text = "", parentElement = null, children = []) => ({
  parentElement, innerText: text, textContent: text,
  getAttribute: key => attrs[key] ?? null,
  matches: selector => selector.split(",").some(x => x.includes("[data-user-message-bubble]") && attrs.bubble === "1"),
  closest: () => null,
  querySelector: selector => children.find(child => selector.includes("data-user-message-bubble") && child.attrs?.bubble === "1") || null,
  querySelectorAll: () => [],
  cloneNode: () => ({ innerText: text, textContent: text, querySelectorAll: () => [] })
});

test("receipt matcher requires literal callback id and complete normalized payload", () => {
  const payload = "[CODEX-AUTO callback_id=a.b] line one\nline two";
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=a.b] line   one line two", "a.b", payload), true);
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=aXb] line one line two", "a.b", payload), false);
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=a.b] line one", "a.b", payload), false);
});

test("extractor accepts message id and bubble-only user turns, deduplicates one identity", () => {
  const root = { querySelectorAll: () => [message, bubble, duplicate] };
  const message = node({ "data-message-id": "m1", "data-message-author-role": "user" }, "[CODEX-AUTO callback_id=x] ok");
  const bubble = node({ bubble: "1", "data-user-message-bubble": "", "data-turn-key": "turn-1" }, "[CODEX-AUTO callback_id=x] ok");
  const duplicate = node({ bubble: "1", "data-user-message-bubble": "", "data-turn-key": "turn-1" }, "[CODEX-AUTO callback_id=x] ok");
  assert.deepEqual(JSON.parse(JSON.stringify(extract(root))), [
    { text: "[CODEX-AUTO callback_id=x] ok", key: "m1" },
    { text: "[CODEX-AUTO callback_id=x] ok", key: "turn-1" }
  ]);
});
