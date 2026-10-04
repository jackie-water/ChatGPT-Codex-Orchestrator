import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { callbackReceiptMatches } from "../runtime/scripts/callback-receipt.mjs";

const wake=()=>fs.readFileSync(new URL("../runtime/scripts/wake-chat.mjs",import.meta.url),"utf8");


test("callback delivery requires a committed user-role message",()=>{
  const text=wake();
  assert.match(text,/data-message-author-role="user"/);
  assert.match(text,/\[data-testid\^="conversation-turn-"\]\[data-turn="user"\]/);
  assert.match(text,/\[data-turn-key\]:has\(\[data-user-message-bubble\]\)/);
  assert.doesNotMatch(text,/const roleNodes = \[\s*\.\.\.structuredNodes/);
  assert.match(text,/verifiedBy:\"committed-user-turn\"/);
  assert.match(text,/Only a newly committed user-role/);
  assert.doesNotMatch(text,/cleared-composer-and-rendered-text/);
});

test("existing callback id is considered delivered only in a user message",()=>{
  const text=wake();
  assert.match(text,/const committedUserTurnSelector = \[[\s\S]*data-message-author-role="user"/);
  assert.match(text,/const committedUserTurnSelector = \[[\s\S]*data-testid\^="conversation-turn-"\]\[data-turn="user"\]/);
  assert.match(text,/const committedUserTurnSelector = \[[\s\S]*data-turn-key\]:has\(\[data-user-message-bubble\]\)/);
  assert.match(text,/async function userMessageState[\s\S]*JSON\.stringify\(committedUserTurnSelector\)/);
  assert.match(text,/const alreadyDelivered = await hasReceipt\(send, callbackId, message\)/);
  assert.doesNotMatch(text,/document\.body\.innerText[^\n]*callbackId/);
});

test("receipt matcher is exact and whitespace tolerant",()=>{
  const payload="[CODEX-AUTO callback_id=abc] line one\nline two";
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=abc] line   one\nline two","abc",payload),true);
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=abc2] line one line two","abc",payload),false);
  assert.equal(callbackReceiptMatches("reference abc [CODEX-AUTO callback_id=abc] line one line two","abc",payload),false);
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=abc] other","abc",payload),false);
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=aXb] line one line two","a.b",payload.replace("abc","a.b")),false);
});

test("shipped serialized matcher runs in a separate browser-like realm", async ()=>{
  const {receiptMatcherSource}=await import("../runtime/scripts/callback-receipt.mjs");
  const context={}; vm.createContext(context);
  const matcher=vm.runInContext(`${receiptMatcherSource()}; callbackReceiptMatches`,context);
  assert.equal(matcher("[CODEX-AUTO callback_id=a.b] line one line two","a.b","[CODEX-AUTO callback_id=a.b] line one line two"),true);
  assert.equal(matcher("[CODEX-AUTO callback_id=aXb] line one line two","a.b","[CODEX-AUTO callback_id=a.b] line one line two"),false);
});

test("receipt and state paths are fail-closed and exact",()=>{
  const js=wake();
  const ps=fs.readFileSync(new URL("../runtime/scripts/wake-chat.ps1",import.meta.url),"utf8");
  assert.match(js,/const receiptDomExpression/);
  assert.match(js,/blockquote,pre,code/);
  assert.match(js,/existingComposer\?\.text === message/);
  assert.match(js,/delivery_state === "SUBMISSION_ATTEMPTED"/);
  assert.match(js,/location\.href !==/);
  assert.match(ps,/delivery_state -ne 'DELIVERED'/);
  assert.match(ps,/WaitOne/);
  assert.match(ps,/existing\.message -ne \$Message/);
  assert.match(ps,/ERROR callback_id=/);
  assert.match(ps,/previousReconcileOnly/);
});

test("queued callback delivery clears the native failure exit code",()=>{
  const text=fs.readFileSync(new URL("../runtime/scripts/wake-chat.ps1",import.meta.url),"utf8");
  assert.match(text,/if \(-not \$QueueOnFailure\)[\s\S]*?throw "Normal Chat wake failed with exit code \$wakeExit"/);
  assert.match(text,/CHAT_WAKE_QUEUED[\s\S]*?\$global:LASTEXITCODE = 0/);
});
