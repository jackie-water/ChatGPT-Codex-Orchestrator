import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime=file=>fs.readFileSync(new URL("../runtime/scripts/"+file,import.meta.url),"utf8");

test("all execution entrypoints require an active registered review_route",()=>{
  for(const file of ["run-codex.ps1","run-code-review.ps1","merge-approved.ps1"]){
    const text=runtime(file);
    assert.match(text,/CHAT_ROUTE_REQUIRED/,file+" must reject missing routes");
    assert.match(text,/CHAT_ROUTE_UNREGISTERED/,file+" must reject unknown routes");
    assert.match(text,/Resolve-RegisteredChatRoute/,file+" must resolve the explicit registry");
    assert.match(text,/wake-chat\.ps1/,file+" must deliver to the pinned route URL");
    assert.doesNotMatch(text,/dispatch-chat-callback|default_review_route|PROJECT_REVIEW_ROUTES|CHAT_ROUTES/,file+" must not use origin/fallback routing");
  }
});

test("Chat registration workflow exists and stores routes locally",()=>{
  const workflow=fs.readFileSync(new URL("../templates/control-repo/orchestrator.yml.template",import.meta.url),"utf8");
  const register=runtime("register-chat.ps1");
  const registry=runtime("chat-route-registry.ps1");
  assert.match(workflow,/\[CHAT-REGISTER\]/);
  assert.match(workflow,/register-chat\.ps1/);
  assert.match(register,/Register-ChatRoute/);
  assert.match(register,/CHAT-ROUTE-REGISTERED/);
  assert.match(registry,/Get-OrchestratorChatRoutePath/);
  assert.match(registry,/Resolve-RegisteredChatRoute/);
});

test("callback retry never discovers or falls back to another Chat",()=>{
  const retry=runtime("retry-pending-callbacks.ps1");
  assert.match(retry,/routing_version.*explicit-route-v1/s);
  assert.match(retry,/LEGACY_PENDING_RETIRED/);
  assert.match(retry,/ChatUrl = \[string\]\$item\.chat_url/);
  assert.doesNotMatch(retry,/origin_issue|fallback_after|Resolve-ChatCallbackRoute|Update-OriginRoutes/);
});

test("browser sender requires an exact target conversation",()=>{
  const text=runtime("wake-chat.mjs");
  assert.match(text,/exact Chat destination is required/);
  assert.match(text,/CHAT_TARGET_TAB_MISSING/);
  assert.match(text,/Could not open the exact target Chat/);
  assert.doesNotMatch(text,/No normal ChatGPT tab found|Page\.navigate/);
});

test("old origin discovery runtime is retired",()=>{
  for(const file of ["capture-chat-origins.mjs","chat-routing.ps1","dispatch-chat-callback.ps1","origin-router-loop.ps1"]){
    assert.equal(fs.existsSync(new URL("../runtime/scripts/"+file,import.meta.url)),false,file+" must be removed");
  }
});

test("installer registration creates CHAT-REGISTER rather than origin markers",()=>{
  const text=fs.readFileSync(new URL("../src/lib/chat-registration.mjs",import.meta.url),"utf8");
  assert.match(text,/\[CHAT-REGISTER\]/);
  assert.match(text,/chat_url/);
  assert.doesNotMatch(text,/ORCHESTRATOR-ORIGIN|issue-routes/);
});
