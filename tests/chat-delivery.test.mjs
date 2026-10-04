import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { callbackReceiptMatches, receiptDomSource } from "../runtime/scripts/callback-receipt.mjs";

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
  assert.match(text,/async function userMessageState[\s\S]*const roleNodes = \$\{receiptDomExpression\}\(document\)/);
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
  const matcher=vm.runInContext(receiptMatcherSource(),context);
  assert.equal(matcher("[CODEX-AUTO callback_id=a.b] line one line two","a.b","[CODEX-AUTO callback_id=a.b] line one line two"),true);
  assert.equal(matcher("[CODEX-AUTO callback_id=aXb] line one line two","a.b","[CODEX-AUTO callback_id=a.b] line one line two"),false);
});

test("receipt and state paths are fail-closed and exact",()=>{
  const js=wake();
  const ps=fs.readFileSync(new URL("../runtime/scripts/wake-chat.ps1",import.meta.url),"utf8");
  assert.match(js,/const receiptDomExpression/);
  assert.match(js,/blockquote,pre,code/);
  assert.match(js,/before\.text === text/);
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

test("shipped receipt extractor accepts only canonical user-owned turns",()=>{
  const make=(attrs,text,parent=null)=>({parentElement:parent,innerText:text,textContent:text,getAttribute:k=>attrs[k]||null,matches:s=>s.includes('[data-user-message-bubble]')&&attrs.bubble==='1',querySelector:s=>null,cloneNode:()=>({innerText:text,textContent:text,querySelectorAll:()=>[]})});
  const root={};
  const userParent=make({'data-testid':'conversation-turn-a','data-turn':'user'},'');
  const user=make({bubble:'1'},'[CODEX-AUTO callback_id=a] ok',userParent);
  const assistantParent=make({'data-testid':'conversation-turn-b','data-turn':'assistant'},'');
  const assistantBubble=make({bubble:'1'},'[CODEX-AUTO callback_id=a] ok',assistantParent);
  const noCanonical=make({'data-message-author-role':'user','data-message-id':'m'},'[CODEX-AUTO callback_id=a] ok');
  root.querySelectorAll=()=>[user,assistantBubble,noCanonical];
  const context={}; vm.createContext(context);
  const extract=vm.runInContext(`(${receiptDomSource()})`,context);
  assert.deepEqual(extract(root),[{text:'[CODEX-AUTO callback_id=a] ok',key:'conversation-turn-a'}]);
});

test("shipped wake path guards the mutation and state transitions",()=>{
  const js=wake();
  assert.match(js,/actual !== \$\{JSON\.stringify\(message\)\}/);
  assert.match(js,/if \(busy\) return \{ok:false, reason:'chat-busy-generating'\}/);
  assert.match(js,/updateDeliveryState\("SUBMISSION_ATTEMPTED"\);[\s\S]*?sendMessage/);
  assert.match(js,/state\.text === text/);
  assert.match(js,/Callback state disappeared/);
});

test("PowerShell lifecycle uses separator-safe identity and full-file protection",()=>{
  const ps=fs.readFileSync(new URL("../runtime/scripts/wake-chat.ps1",import.meta.url),"utf8");
  assert.match(ps,/CodexCallback-\$mutexIdentity/);
  assert.doesNotMatch(ps,/CodexCallback-\$instanceId-\$pendingRoot/);
  assert.match(ps,/Get-FileHash -LiteralPath \$Path -Algorithm SHA256/);
  assert.match(ps,/try \{[\s\S]*?finally \{[\s\S]*?mutexOwned/);
});
