import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { callbackReceiptMatches, receiptDomSource } from "../runtime/scripts/callback-receipt.mjs";
import { validateCallbackState, assertSafeMutation, nextDeliveryState, sendGate, reconcileReceipt, createCallbackStateStore, deliverCallback } from "../runtime/scripts/callback-delivery.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

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

test("shipped sender helpers keep mutation and send gates fail closed", () => {
  const expected={callbackId:"x",chatUrl:"https://chatgpt.com/c/chat-27",message:"payload"};
  const persisted={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:expected.callbackId,chat_url:expected.chatUrl,message:expected.message};
  assert.equal(validateCallbackState(persisted,expected).delivery_state,"PENDING");
  assert.throws(()=>validateCallbackState({...persisted,callback_id:"other"},expected));
  assert.throws(()=>validateCallbackState({...persisted,chat_url:"https://chatgpt.com/c/other"},expected));
  assert.throws(()=>assertSafeMutation({destination:"https://chatgpt.com/c/other",expectedDestination:expected.chatUrl,draft:"",message:expected.message}));
  assert.throws(()=>assertSafeMutation({destination:expected.chatUrl,expectedDestination:expected.chatUrl,draft:"late draft",message:expected.message}));
  assert.equal(nextDeliveryState("PENDING","DRAFT_INSERTED"),"DRAFT_INSERTED");
  assert.throws(()=>nextDeliveryState("DELIVERED","DRAFT_INSERTED"));
  assert.equal(sendGate({state:"SUBMISSION_ATTEMPTED",destination:expected.chatUrl,expectedDestination:expected.chatUrl,draft:expected.message,message:expected.message}), true);
  assert.throws(()=>nextDeliveryState("PENDING","DELIVERED"));
  assert.equal(reconcileReceipt({state:"SUBMISSION_ATTEMPTED",receiptMatches:true}),"DELIVERED");
  assert.equal(reconcileReceipt({state:"DRAFT_INSERTED",receiptMatches:false}),"DRAFT_INSERTED");
  assert.throws(()=>reconcileReceipt({state:"BROKEN",receiptMatches:true}));
});

test("production callback state store persists legal transitions and rejects identity/state drift", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"callback-store-"));
  const file=path.join(dir,"state.json");
  const expected={callbackId:"x",chatUrl:"https://chatgpt.com/c/chat-27",message:"payload"};
  fs.writeFileSync(file,JSON.stringify({routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:expected.chatUrl,message:"payload"}));
  const store=createCallbackStateStore({file,expected:expected.chatUrl,callbackId:expected.callbackId,message:expected.message,fsModule:fs,pathModule:path,now:()=>"2026-01-01T00:00:00.000Z"});
  for (const state of ["PENDING","DRAFT_INSERTED","SUBMISSION_ATTEMPTED","DELIVERED"]) { if (state !== "PENDING") store.update(nextDeliveryState(store.read().delivery_state,state)); assert.equal(store.read().delivery_state,state); assert.equal(store.read().callback_id,"x"); }
  for (const bad of [{delivery_state:"BROKEN"},{callback_id:"other"},{chat_url:"https://chatgpt.com/c/other"}]) { fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file)),...bad})); assert.throws(()=>store.read(),/Invalid callback state/); fs.writeFileSync(file,JSON.stringify({routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:expected.chatUrl,message:"payload"})); }
});

test("production callback state store fails closed on disappearance, conflicts, writes, renames, and returns bound fingerprints", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"callback-store-")); const file=path.join(dir,"state.json"); const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; const expected={callbackId:"x",chatUrl:record.chat_url,message:record.message}; const write=()=>fs.writeFileSync(file,JSON.stringify(record)); write();
  const make=(overrides={}, expectedFingerprint="")=>createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",expectedFingerprint,fsModule:Object.assign(Object.create(fs),overrides),pathModule:path}); let store=make({},crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")); const before=fs.readFileSync(file,"utf8"); fs.writeFileSync(file,before+" "); assert.throws(()=>store.update("DRAFT_INSERTED"),/fingerprint changed/); assert.equal(fs.readFileSync(file,"utf8"),before+" "); write();
  for (const method of ["writeFileSync","renameSync"]) { store=make({[method](){throw new Error(method);}}); assert.throws(()=>store.update("DRAFT_INSERTED"),new RegExp(method)); assert.deepEqual(JSON.parse(fs.readFileSync(file)),record); }
  fs.unlinkSync(file); assert.throws(()=>store.read(),/Callback state disappeared/); assert.throws(()=>store.update("DRAFT_INSERTED"),/Callback state disappeared/); assert.equal(fs.existsSync(file),false); write(); const fp=make().update("DRAFT_INSERTED"); assert.equal(fp,crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
});

test("production delivery helper retries without blind resend and counts only irreversible submission", async () => {
  let state="PENDING", submissions=0, updates=[]; const read=()=>({delivery_state:state}); const update=next=>{state=next; updates.push(next);};
  await assert.rejects(()=>deliverCallback({read,hasReceipt:async()=>false,update,beforeSend:async()=>{},send:async()=>{const e=new Error("not ready"); e.code="PRE_SEND_NOT_READY"; throw e;}}),/not ready/); assert.equal(state,"PENDING"); assert.equal(submissions,0);
  const result=await deliverCallback({read,hasReceipt:async()=>false,update,beforeSend:async()=>{},send:async()=>{submissions++; return "sent";}}); assert.equal(result.action,"sent"); assert.equal(submissions,1); assert.deepEqual(updates.slice(-2),["DRAFT_INSERTED","SUBMISSION_ATTEMPTED"]);
  for (const prior of ["DRAFT_INSERTED","SUBMISSION_ATTEMPTED","DELIVERED"]) { state=prior; let called=0; assert.equal((await deliverCallback({read,hasReceipt:async()=>false,update,send:async()=>called++})).action,"reconcile"); assert.equal(called,0); state=prior; assert.equal((await deliverCallback({read,hasReceipt:async()=>true,update,send:async()=>called++})).state,"DELIVERED"); assert.equal(called,0); }
});

test("deliverCallback blocks send on production state-store faults", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"callback-delivery-store-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"};
  const write=()=>fs.writeFileSync(file,JSON.stringify(record)); const make=(overrides={}, expectedFingerprint="")=>createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:record.message,expectedFingerprint,fsModule:Object.assign(Object.create(fs),overrides),pathModule:path});
  const attempt=async (store, receipt=async()=>false) => { let sends=0, receipts=0; await assert.rejects(()=>deliverCallback({read:store.read,hasReceipt:async()=>{receipts++; return receipt();},update:store.update,send:async()=>{sends++;}})); assert.equal(sends,0); return receipts; };
  write(); const fp=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); fs.appendFileSync(file," "); assert.equal(await attempt(make({},fp)),0); write(); fs.unlinkSync(file); assert.equal(await attempt(make()),0); assert.equal(fs.existsSync(file),false);
  for (const method of ["writeFileSync","renameSync"]) { write(); const before=fs.readFileSync(file); await attempt(make({[method](){throw new Error(method);}})); assert.deepEqual(fs.readFileSync(file),before); }
  for (const bad of [{delivery_state:"BROKEN"},{callback_id:"other"}]) { write(); fs.writeFileSync(file,JSON.stringify({...record,...bad})); let receipts=0; await assert.rejects(()=>deliverCallback({read:make().read,hasReceipt:async()=>{receipts++; return true;},update:make().update,send:async()=>{}})); assert.equal(receipts,0); }
});
