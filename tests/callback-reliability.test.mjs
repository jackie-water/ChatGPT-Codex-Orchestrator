import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { callbackReceiptMatches, receiptDomSource } from "../runtime/scripts/callback-receipt.mjs";

const extract = root => vm.runInNewContext(`(${receiptDomSource()})`, {}).call(null, root);
class Element {
  constructor(attrs={}, text="", children=[]) { this.attrs=attrs; this.innerText=text; this.textContent=text; this.children=children; this.parentElement=null; for (const child of children) child.parentElement=this; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  matches(selector) { return selector.split(",").some(x => (x.includes("[data-user-message-bubble]") && this.attrs.bubble === "1") || (x.includes("blockquote") && this.attrs.tag === "blockquote") || (x.includes("pre") && this.attrs.tag === "pre") || (x.includes("code") && this.attrs.tag === "code") || (x.includes("contenteditable") && this.attrs.contenteditable === "true") || (x.includes("data-orchestrator-composer") && this.attrs.composer === "true")); }
  closest(selector) { for (let x=this; x; x=x.parentElement) if (x.matches(selector)) return x; return null; }
  querySelector(selector) { return this.children.flatMap(x => [x, ...x.children]).find(x => x.matches(selector)) ?? null; }
  querySelectorAll(selector) { return this.children.flatMap(x => [x, ...x.children]).filter(x => x.matches(selector)); }
  remove() {}
  cloneNode() { return new Element({...this.attrs}, this.innerText, this.children.map(x => x.cloneNode(true))); }
}
const node = (attrs, text="", children=[]) => new Element(attrs, text, children);

test("matcher requires literal callback id and complete normalized payload", () => {
  const payload = "[CODEX-AUTO callback_id=a.b] line one\nline two";
  assert.equal(callbackReceiptMatches("[CODEX-AUTO callback_id=a.b] line   one line two", "a.b", payload), true);
  for (const value of ["", "> "+payload, "[CODEX-AUTO callback_id=aXb] line one line two", "[CODEX-AUTO callback_id=a.b] line one", payload+" extra"]) assert.equal(callbackReceiptMatches(value, "a.b", payload), false);
});

test("shipped extractor accepts both user layouts and canonicalizes one message once", () => {
  const message=node({"data-message-id":"m1","data-message-author-role":"user"},"[CODEX-AUTO callback_id=x] ok",[node({"data-message-id":"m1"},"[CODEX-AUTO callback_id=x] ok")]);
  const bubble=node({bubble:"1","data-user-message-bubble":"","data-turn-key":"turn-1"},"[CODEX-AUTO callback_id=x] ok",[node({bubble:"1","data-user-message-bubble":""},"[CODEX-AUTO callback_id=x] ok")]);
  const unrelated=node({bubble:"1","data-user-message-bubble":"","data-turn-key":"turn-2"},"[CODEX-AUTO callback_id=x] ok");
  assert.deepEqual(JSON.parse(JSON.stringify(extract({querySelectorAll:()=>[message,...message.children,bubble,...bubble.children,unrelated]}))),[
    {text:"[CODEX-AUTO callback_id=x] ok",key:"m1"},{text:"[CODEX-AUTO callback_id=x] ok",key:"turn-1"},{text:"[CODEX-AUTO callback_id=x] ok",key:"turn-2"}
  ]);
});

test("quoted, code, assistant, editable, and composer ancestry are rejected", () => {
  const rejected=["blockquote","pre","code"].map(tag=>node({bubble:"1","data-user-message-bubble":"","data-turn-key":tag,tag},"[CODEX-AUTO callback_id=x] bad"));
  rejected.push(node({bubble:"1","data-user-message-bubble":"","data-turn-key":"edit",contenteditable:"true"},"[CODEX-AUTO callback_id=x] bad"));
  rejected.push(node({bubble:"1","data-user-message-bubble":"","data-turn-key":"compose",composer:"true"},"[CODEX-AUTO callback_id=x] bad"));
  rejected.push(node({"data-message-id":"a1","data-message-author-role":"assistant"},"[CODEX-AUTO callback_id=x] bad"));
  assert.deepEqual(JSON.parse(JSON.stringify(extract({querySelectorAll:()=>rejected}))),[]);
});

test("wrapper labels cannot claim a canonical receipt key before the payload", () => {
  const label=node({"data-message-id":"m1","data-message-author-role":"user"},"User callback_id=x");
  const payload=node({"data-message-id":"m2","data-message-author-role":"user"},"[CODEX-AUTO callback_id=x] payload");
  assert.equal(callbackReceiptMatches(label.innerText,"x",payload.innerText),false);
  assert.deepEqual(JSON.parse(JSON.stringify(extract({querySelectorAll:()=>[label,payload]}))),[{text:label.innerText,key:"m1"},{text:payload.innerText,key:"m2"}]);
});

test("receipt recognition is independent of DOM count and traversal order", () => {
  const make = (key, text) => node({"data-message-id":key,"data-message-author-role":"user"}, text);
  const payload = "[CODEX-AUTO callback_id=x] payload";
  const first = make("first", payload);
  const duplicate = make("first", payload);
  const second = make("second", "unrelated");
  const one = extract({querySelectorAll:()=>[first,duplicate,second]});
  const many = extract({querySelectorAll:()=>[second,duplicate,first,make("third",payload)]});
  assert.equal(one.filter(x => callbackReceiptMatches(x.text, "x", payload)).length, 1);
  assert.equal(many.filter(x => callbackReceiptMatches(x.text, "x", payload)).length, 2);
});

test("receipt recognition fails closed for changed navigation, late drafts, and invalid state", () => {
  const payload = "[CODEX-AUTO callback_id=x] payload";
  assert.equal(callbackReceiptMatches(payload, "x", payload), true);
  for (const value of [
    "[CODEX-AUTO callback_id=x] payload late draft",
    "[CODEX-AUTO callback_id=x] payload changed navigation",
    "[CODEX-AUTO callback_id=x] payload\n[CODEX-AUTO callback_id=x] payload"
  ]) assert.equal(callbackReceiptMatches(value, "x", payload), false);
  for (const value of ["", "not-json", "{\"delivery_state\":\"DELIVERED\"}"]) {
    assert.equal(callbackReceiptMatches(value, "x", payload), false);
  }
});

test("shipped sender state machine keeps the mutation and send gates fail closed", () => {
  const source=fs.readFileSync(new URL("../runtime/scripts/wake-chat.mjs", import.meta.url),"utf8");
  assert.match(source,/beforeInputUrl[\s\S]*destination changed before input[\s\S]*insertText/);
  assert.match(source,/verifyDestination[\s\S]*destination changed before submission[\s\S]*updateDeliveryState\("SUBMISSION_ATTEMPTED"\)/);
  assert.match(source,/error\.code === "PRE_SEND_NOT_READY"\) updateDeliveryState\("PENDING"\)/);
  assert.match(source,/stored\?\.delivery_state === "SUBMISSION_ATTEMPTED" \|\| stored\?\.delivery_state === "DRAFT_INSERTED"/);
  assert.match(source,/stored\?\.delivery_state === "DELIVERED"/);
  assert.match(source,/if \(stored && stored\.delivery_state !== "PENDING"\) throw new Error\("Invalid callback delivery state"\)/);
  assert.match(source,/Callback state disappeared/);
  assert.match(source,/Callback state fingerprint changed/);
  assert.match(source,/fs\.renameSync\(temp,callbackStateFile\)/);
  assert.match(source,/const alreadyDelivered = await hasReceipt\(send, callbackId, message\)/);
  assert.match(source,/callbackReceiptMatches\(x\.text, \$\{JSON\.stringify\(callbackId\)\}, \$\{JSON\.stringify\(payload\)\}\)/);
});
