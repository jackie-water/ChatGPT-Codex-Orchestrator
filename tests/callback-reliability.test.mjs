import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { callbackReceiptMatches, receiptDomSource } from "../runtime/scripts/callback-receipt.mjs";
import { validateCallbackState, assertSafeMutation, nextDeliveryState, sendGate, reconcileReceipt, createCallbackStateStore, deliverCallback, isValidCallbackId } from "../runtime/scripts/callback-delivery.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const callbackTempRoot = fs.realpathSync(os.tmpdir());

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

test("callback ID contract accepts safe IDs and rejects unsafe IDs", () => {
  for (const value of ["wake-abc_123.4", "A".repeat(160)]) assert.equal(isValidCallbackId(value), true);
  for (const value of ["", "   ", "wake/id", "A".repeat(161)]) assert.equal(isValidCallbackId(value), false);
});

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

test("wake-chat receipt and send destination guards use normalized conversation identity", () => {
  const wake = fs.readFileSync(new URL("../runtime/scripts/wake-chat.mjs", import.meta.url), "utf8");
  const normalizeConversationUrl = value => { const url = new URL(value); return url.origin + url.pathname; };
  const expected = "https://chatgpt.com/c/chat-27";
  const receiptGuard = wake.match(/if \(\(location\.origin \+ location\.pathname\) !== (.+?)\) return false;/)?.[1];
  const sendGuard = wake.match(/if \(\(location\.origin \+ location\.pathname\) !== (.+?)\) return \{ok:false, reason:'destination-changed'\};/)?.[1];
  assert.match(receiptGuard, /normalizeConversationUrl\(expected\)/);
  assert.match(sendGuard, /normalizeConversationUrl\(expected\)/);
  const accepts = href => normalizeConversationUrl(href) === normalizeConversationUrl(expected);
  for (const href of [expected, `${expected}?query=1`, `${expected}#hash`]) assert.equal(accepts(href), true);
  for (const href of ["https://chatgpt.com/c/other", "https://chat.openai.com/c/chat-27"]) assert.equal(accepts(href), false);
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
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-store-"));
  const file=path.join(dir,"state.json");
  const expected={callbackId:"x",chatUrl:"https://chatgpt.com/c/chat-27",message:"payload"};
  fs.writeFileSync(file,JSON.stringify({routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:expected.chatUrl,message:"payload"}));
  const store=createCallbackStateStore({file,expected:expected.chatUrl,callbackId:expected.callbackId,message:expected.message,fsModule:fs,pathModule:path,now:()=>"2026-01-01T00:00:00.000Z"});
  for (const state of ["PENDING","DRAFT_INSERTED","SUBMISSION_ATTEMPTED","DELIVERED"]) { if (state !== "PENDING") store.update(nextDeliveryState(store.read().delivery_state,state)); assert.equal(store.read().delivery_state,state); assert.equal(store.read().callback_id,"x"); }
  for (const bad of [{delivery_state:"BROKEN"},{callback_id:"other"},{chat_url:"https://chatgpt.com/c/other"}]) { const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:expected.chatUrl,message:"payload",...bad}; fs.writeFileSync(file,JSON.stringify(record)); const fingerprint=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); const fresh=createCallbackStateStore({file,expected:expected.chatUrl,callbackId:expected.callbackId,message:expected.message,expectedFingerprint:fingerprint,fsModule:fs,pathModule:path,now:()=>"2026-01-01T00:00:00.000Z"}); assert.throws(()=>fresh.read(),/Invalid callback state/); }
});

test("production callback state store fails closed on disappearance, conflicts, writes, renames, and returns bound fingerprints", () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-store-")); const file=path.join(dir,"state.json"); const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; const expected={callbackId:"x",chatUrl:record.chat_url,message:record.message}; const write=()=>fs.writeFileSync(file,JSON.stringify(record)); write();
  const make=(overrides={}, expectedFingerprint="")=>createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",expectedFingerprint,fsModule:Object.assign(Object.create(fs),overrides),pathModule:path}); let store=make({},crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")); const before=fs.readFileSync(file,"utf8"); fs.writeFileSync(file,before+" "); assert.throws(()=>store.read(),/fingerprint changed/); assert.throws(()=>store.update("DRAFT_INSERTED"),/fingerprint changed/); assert.equal(fs.readFileSync(file,"utf8"),before+" "); write();
  for (const method of ["writeFileSync","fsyncSync","renameSync"]) { store=make({[method](){throw new Error(method);}}); assert.throws(()=>store.update("DRAFT_INSERTED"),new RegExp(method)); assert.deepEqual(JSON.parse(fs.readFileSync(file)),record); }
  fs.unlinkSync(file); assert.throws(()=>store.read(),/Callback state disappeared/); assert.throws(()=>store.update("DRAFT_INSERTED"),/Callback state disappeared/); assert.equal(fs.existsSync(file),false); write(); const fp=make().update("DRAFT_INSERTED"); assert.equal(fp,crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
});

test("Windows-style callback persistence keeps file fsync and atomic rename without opening the directory", () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-win32-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; fs.writeFileSync(file,JSON.stringify(record));
  let fsyncs=0, renames=0, directoryOpens=0;
  const fake=Object.assign(Object.create(fs),{
    fsyncSync(fd){fsyncs++; return fs.fsyncSync(fd);},
    renameSync(from,to){renames++; return fs.renameSync(from,to);},
    openSync(target,...args){if(target===dir) directoryOpens++; return fs.openSync(target,...args);}
  });
  const store=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:record.message,fsModule:fake,pathModule:path,platform:"win32"});
  store.update("DRAFT_INSERTED");
  assert.equal(directoryOpens,0); assert.equal(renames,1); assert.ok(fsyncs>=1); assert.equal(store.read().delivery_state,"DRAFT_INSERTED");
});

test("production delivery helper retries without blind resend and counts only irreversible submission", async () => {
  let state="PENDING", submissions=0, updates=[]; const read=()=>({delivery_state:state}); const update=next=>{state=next; updates.push(next);};
  await assert.rejects(()=>deliverCallback({read,hasReceipt:async()=>false,update,beforeSend:async()=>{},send:async()=>{const e=new Error("not ready"); e.code="PRE_SEND_NOT_READY"; throw e;}}),/not ready/); assert.equal(state,"PENDING"); assert.equal(submissions,0);
  const result=await deliverCallback({read,hasReceipt:async()=>false,update,beforeSend:async()=>{},send:async()=>{submissions++; return "sent";}}); assert.equal(result.action,"sent"); assert.equal(submissions,1); assert.deepEqual(updates.slice(-2),["DRAFT_INSERTED","SUBMISSION_ATTEMPTED"]);
  for (const prior of ["DRAFT_INSERTED","SUBMISSION_ATTEMPTED","DELIVERED"]) { state=prior; let called=0; assert.equal((await deliverCallback({read,hasReceipt:async()=>false,update,send:async()=>called++})).action,"reconcile"); assert.equal(called,0); state=prior; assert.equal((await deliverCallback({read,hasReceipt:async()=>true,update,send:async()=>called++})).state,"DELIVERED"); assert.equal(called,0); }
});

test("callback mutex serializes independent owners and rejects foreign or symlink locks", async () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-lock-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; fs.writeFileSync(file,JSON.stringify(record));
  const make=()=>createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:record.message,fsModule:fs,pathModule:path}); const one=make(), two=make();
  let release; const held=new Promise(resolve=>{release=resolve;}); let entered=false;
  let firstError; const first=one.withLock(async()=>{entered=true; await held;}).catch(error=>{firstError=error; throw error;}); first.catch(()=>{}); const deadline=Date.now()+2000; while(!entered){ if(firstError){ release(); throw firstError; } if(Date.now()>=deadline){ release(); throw new Error("mutex precondition timed out"); } await new Promise(resolve=>setTimeout(resolve,10)); }
  await assert.rejects(()=>two.withLock(async()=>{}),/lock is occupied/); release(); await first;
  const lock=file+".delivery.lock"; fs.symlinkSync(file,lock); await assert.rejects(()=>one.withLock(async()=>{}),/lock is occupied|symlink/); fs.unlinkSync(lock);
});

test("callback mutex refuses to unlink a lock whose inode changed", async () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-lock-replacement-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; fs.writeFileSync(file,JSON.stringify(record));
  let altered=false;
  const fake=Object.assign(Object.create(fs),{fstatSync(fd){const stat=fs.fstatSync(fd); return altered ? {...stat,ino:stat.ino+1} : stat;}});
  const store=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:fake,pathModule:path});
  const lock=file+".delivery.lock"; await assert.rejects(()=>store.withLock(async()=>{altered=true;}),/lock was replaced/); assert.equal(fs.existsSync(lock),true);
});

test("callback mutex cleans only its own failed initial acquisition", async () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-lock-faults-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; fs.writeFileSync(file,JSON.stringify(record));
  const lock=file+".delivery.lock"; let sends=0;
  for (const failedMethod of ["writeFileSync","fsyncSync"]) {
    let failed=true;
    const fake=Object.assign(Object.create(fs),{[failedMethod](...args){if(failed && (failedMethod!=="writeFileSync" || typeof args[0]==="number")){failed=false; const error=new Error("EIO"); error.code="EIO"; throw error;} return fs[failedMethod](...args);}});
    const store=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:fake,pathModule:path});
    await assert.rejects(()=>store.withLock(async()=>{sends++;}),/EIO/); assert.equal(fs.existsSync(lock),false);
    await store.withLock(async()=>{sends++;}); assert.equal(fs.existsSync(lock),false);
  }
  assert.equal(sends,2);
  let directoryOpens=0;
  const win32=Object.assign(Object.create(fs),{openSync(target,...args){if(target===dir) directoryOpens++; return fs.openSync(target,...args);}});
  const windowsStore=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:win32,pathModule:path,platform:"win32"});
  await windowsStore.withLock(async()=>{}); assert.equal(directoryOpens,0);
});

test("callback mutex cleans an own partial owner write but retains foreign partial bytes", async () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-lock-partial-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; fs.writeFileSync(file,JSON.stringify(record));
  const lock=file+".delivery.lock";
  let ownPartialFailed=false;
  const ownPartial=Object.assign(Object.create(fs),{writeFileSync(fd,owner,...args){if(!ownPartialFailed){ownPartialFailed=true; fs.writeSync(fd,owner.slice(0,Math.min(20,owner.length))); const error=new Error("EIO"); error.code="EIO"; throw error;} return fs.writeFileSync(fd,owner,...args);}});
  const store=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:ownPartial,pathModule:path});
  await assert.rejects(()=>store.withLock(async()=>{}),/EIO/); assert.equal(fs.existsSync(lock),false);
  await store.withLock(async()=>{}); assert.equal(fs.existsSync(lock),false);

  const foreign=Object.assign(Object.create(fs),{writeFileSync(fd){fs.writeSync(fd,"FOREIGN-PARTIAL"); const error=new Error("EIO"); error.code="EIO"; throw error;}});
  const foreignStore=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:foreign,pathModule:path});
  await assert.rejects(()=>foreignStore.withLock(async()=>{}),/EIO/); assert.equal(fs.readFileSync(lock,"utf8"),"FOREIGN-PARTIAL"); fs.unlinkSync(lock);
});

test("callback mutex retains uncertain or foreign failed-acquisition paths", async () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-lock-foreign-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; fs.writeFileSync(file,JSON.stringify(record));
  const lock=file+".delivery.lock";
  for (const replacement of ["inode", "symlink", "preexisting"]) {
    let fake;
    if (replacement === "preexisting") {
      fs.writeFileSync(lock,JSON.stringify({version:1,callback_id:"foreign",token:"foreign"}));
      fake=Object.assign(Object.create(fs),{fsyncSync(fd){const error=new Error("EIO"); error.code="EIO"; throw error;}});
    } else if (replacement === "symlink") {
      fake=Object.assign(Object.create(fs),{writeFileSync(fd,...args){fs.unlinkSync(lock); fs.symlinkSync(file,lock); const error=new Error("EIO"); error.code="EIO"; throw error;}});
    } else {
      fake=Object.assign(Object.create(fs),{writeFileSync(fd,...args){fs.unlinkSync(lock); fs.writeFileSync(lock,"foreign"); const error=new Error("EIO"); error.code="EIO"; throw error;}});
    }
    const store=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:fake,pathModule:path});
    await assert.rejects(()=>store.withLock(async()=>{}),/EIO|occupied/); assert.equal(fs.existsSync(lock),true);
    if (replacement === "symlink") fs.unlinkSync(lock); else fs.unlinkSync(lock);
  }
});

test("callback mutex preserves a same-path foreign replacement after content verification", async () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-lock-toctou-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; fs.writeFileSync(file,JSON.stringify(record));
  const lock=file+".delivery.lock"; const backup=lock+".own"; let sends=0;
  const foreignBytes="{\"version\":1,\"callback_id\":\"foreign\",\"token\":\"foreign\"}\n";
  const fake=Object.assign(Object.create(fs),{
    fsyncSync(fd){const error=new Error("EIO"); error.code="EIO"; throw error;},
    readFileSync(target,...args){
      if (target===lock) {
        const own=fs.readFileSync(lock,"utf8");
        fs.renameSync(lock,backup); fs.writeFileSync(lock,foreignBytes,{mode:0o600}); fs.chmodSync(lock,0o600);
        return own;
      }
      return fs.readFileSync(target,...args);
    }
  });
  const store=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:fake,pathModule:path});
  await assert.rejects(()=>store.withLock(async()=>{sends++;}),/EIO/);
  assert.equal(sends,0); assert.equal(fs.readFileSync(lock,"utf8"),foreignBytes); assert.equal(fs.existsSync(backup),true);
  fs.unlinkSync(lock); fs.unlinkSync(backup);
});

test("callback mutex closes before simulated Win32 unlink and retains post-close replacement", async () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-lock-win32-cleanup-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"}; fs.writeFileSync(file,JSON.stringify(record));
  const lock=file+".delivery.lock"; const backup=lock+".own"; let openFd; let closeCount=0; let sends=0; let directoryOpens=0;
  const fake=Object.assign(Object.create(fs),{
    openSync(target,...args){if(target===dir) directoryOpens++; const fd=fs.openSync(target,...args); if(target===lock) openFd=fd; return fd;},
    closeSync(fd){closeCount++; if(fd===openFd) openFd=undefined; return fs.closeSync(fd);},
    fsyncSync(fd){const error=new Error("EIO"); error.code="EIO"; throw error;},
    unlinkSync(target){if(target===lock && openFd!==undefined) { const error=new Error("EPERM"); error.code="EPERM"; throw error; } return fs.unlinkSync(target);}
  });
  const store=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:fake,pathModule:path,platform:"win32"});
  await assert.rejects(()=>store.withLock(async()=>{sends++;}),/EIO/); assert.equal(sends,0); assert.equal(closeCount,1); assert.equal(fs.existsSync(lock),false); assert.equal(directoryOpens,0);
  const replacement=Object.assign(Object.create(fake),{closeSync(fd){closeCount++; if(fd===openFd){openFd=undefined; fs.closeSync(fd); fs.renameSync(lock,backup); fs.writeFileSync(lock,"foreign-replacement"); fs.chmodSync(lock,0o600); return;} return fs.closeSync(fd);}});
  const second=createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:"payload",fsModule:replacement,pathModule:path,platform:"win32"});
  await assert.rejects(()=>second.withLock(async()=>{}),/EIO/); assert.equal(fs.existsSync(lock),true); assert.equal(fs.readFileSync(lock,"utf8"),"foreign-replacement"); assert.equal(fs.existsSync(backup),true);
  fs.unlinkSync(lock); fs.unlinkSync(backup);
});

test("two-phase sender journals immediately before click and preserves ambiguity", async () => {
  let state="PENDING", order=[];
  const update=next=>{state=next; order.push(next);};
  const result=await deliverCallback({read:()=>({delivery_state:state}),hasReceipt:async()=>false,update,beforeSend:async()=>order.push("draft"),send:async({beforeClick})=>{order.push("ready"); await beforeClick(); order.push("click"); return "sent";}});
  assert.equal(result.action,"sent"); assert.deepEqual(order,["draft","DRAFT_INSERTED","ready","SUBMISSION_ATTEMPTED","click"]);
  state="PENDING"; order=[];
  await assert.rejects(()=>deliverCallback({read:()=>({delivery_state:state}),hasReceipt:async()=>false,update,beforeSend:async()=>{},send:async({beforeClick})=>{await beforeClick(); const error=new Error("browser transport lost"); error.code="BROWSER_TRANSPORT_LOST"; throw error;}}),/browser transport lost/);
  assert.equal(state,"SUBMISSION_ATTEMPTED");
});

test("deliverCallback blocks send on production state-store faults", async () => {
  const dir=fs.mkdtempSync(path.join(callbackTempRoot,"callback-delivery-store-")); const file=path.join(dir,"state.json");
  const record={routing_version:"explicit-route-v1",delivery_state:"PENDING",callback_id:"x",chat_url:"https://chatgpt.com/c/chat-27",message:"payload"};
  const write=()=>fs.writeFileSync(file,JSON.stringify(record)); const make=(overrides={}, expectedFingerprint="")=>createCallbackStateStore({file,expected:record.chat_url,callbackId:"x",message:record.message,expectedFingerprint,fsModule:Object.assign(Object.create(fs),overrides),pathModule:path});
  const attempt=async (store, receipt=async()=>false) => { let sends=0, receipts=0; await assert.rejects(()=>deliverCallback({read:store.read,hasReceipt:async()=>{receipts++; return receipt();},update:store.update,send:async()=>{sends++;}})); assert.equal(sends,0); return receipts; };
  write(); const fp=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); fs.appendFileSync(file," "); assert.equal(await attempt(make({},fp)),0); write(); fs.unlinkSync(file); assert.equal(await attempt(make()),0); assert.equal(fs.existsSync(file),false);
  for (const method of ["writeFileSync","renameSync"]) { write(); const before=fs.readFileSync(file); await attempt(make({[method](){throw new Error(method);}})); assert.deepEqual(fs.readFileSync(file),before); }
  for (const bad of [{delivery_state:"BROKEN"},{callback_id:"other"}]) { write(); fs.writeFileSync(file,JSON.stringify({...record,...bad})); let receipts=0; await assert.rejects(()=>deliverCallback({read:make().read,hasReceipt:async()=>{receipts++; return true;},update:make().update,send:async()=>{}})); assert.equal(receipts,0); }
});

test("deliverCallback supports direct delivery without persisted state", async () => {
  let before=0, sent=0;
  const result=await deliverCallback({read:()=>null,hasReceipt:async()=>{throw new Error("must not check receipt");},update:()=>{throw new Error("must not update");},beforeSend:async()=>before++,send:async()=>{sent++; return "ok";}});
  assert.deepEqual(result,{action:"sent",result:"ok"}); assert.equal(before,1); assert.equal(sent,1);
  assert.deepEqual(await deliverCallback({read:()=>null,hasReceipt:async()=>true,update:()=>{},beforeSend:async()=>{throw new Error("must not prepare");},send:async()=>{throw new Error("must not send");},allowSend:false}),{action:"reconcile",state:"PENDING"});
  await assert.rejects(()=>deliverCallback({read:()=>null,hasReceipt:async()=>false,update:()=>{},beforeSend:async()=>{},send:async()=>{const error=new Error("not ready"); error.code="PRE_SEND_NOT_READY"; throw error;}}),/not ready/);
});
