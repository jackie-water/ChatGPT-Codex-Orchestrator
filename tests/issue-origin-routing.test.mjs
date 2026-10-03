import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {registerKnownIssueOrigin} from "../src/lib/sandbox-smoke.mjs";

test("different issues retain independent Chat origins",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"origin-route-"));
  const routeFile=path.join(root,"issue-routes.json");
  const previous=process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE;
  process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE=routeFile;
  try{
    registerKnownIssueOrigin({reviewer_chat_url:"https://chatgpt.com/c/chat-a"},{number:101},"demo");
    registerKnownIssueOrigin({reviewer_chat_url:"https://chatgpt.com/c/chat-b"},{number:102},"demo");
    const registry=JSON.parse(fs.readFileSync(routeFile,"utf8"));
    assert.equal(registry.issues["101"].chat_url,"https://chatgpt.com/c/chat-a");
    assert.equal(registry.issues["102"].chat_url,"https://chatgpt.com/c/chat-b");
    assert.notEqual(registry.issues["101"].chat_url,registry.issues["102"].chat_url);
  }finally{
    if(previous===undefined) delete process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE;
    else process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE=previous;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test("an existing issue origin cannot be silently overwritten by another Chat",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"origin-conflict-"));
  const routeFile=path.join(root,"issue-routes.json");
  const previous=process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE;
  process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE=routeFile;
  try{
    registerKnownIssueOrigin({reviewer_chat_url:"https://chatgpt.com/c/chat-a"},{number:201},"demo");
    assert.throws(()=>registerKnownIssueOrigin({reviewer_chat_url:"https://chatgpt.com/c/chat-b"},{number:201},"demo"),/Origin route conflict/);
    const registry=JSON.parse(fs.readFileSync(routeFile,"utf8"));
    assert.equal(registry.issues["201"].chat_url,"https://chatgpt.com/c/chat-a");
  }finally{
    if(previous===undefined) delete process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE;
    else process.env.ORCHESTRATOR_ORIGIN_ROUTE_FILE=previous;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test("runtime execution callbacks use the issue-origin dispatcher",()=>{
  for(const file of ["run-codex.ps1","run-code-review.ps1","merge-approved.ps1"]){
    const text=fs.readFileSync(new URL("../runtime/scripts/"+file,import.meta.url),"utf8");
    assert.match(text,/dispatch-chat-callback\.ps1/,file+" must dispatch through origin routing");
  }
});

test("callback sender targets exact conversation tabs instead of navigating another Chat",()=>{
  const text=fs.readFileSync(new URL("../runtime/scripts/wake-chat.mjs",import.meta.url),"utf8");
  assert.match(text,/resolveTargetPage/);
  assert.match(text,/CHAT_TARGET_TAB_MISSING/);
  assert.match(text,/json\/new/);
  assert.doesNotMatch(text,/Page\.navigate/);
});
