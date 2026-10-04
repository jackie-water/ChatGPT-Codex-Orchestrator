import test from "node:test";
import assert from "node:assert/strict";
import {renderProjectsJson,renderConfigPs1,renderWorkflow,defaultLocalPaths,safeKey} from "../src/lib/control-render.mjs";

test("project config keeps safe defaults and detected validation",()=>{
  const text=renderProjectsJson({
    projectKey:"demo",
    repository:"owner/repo",
    defaultBranch:"main",
    validationProfile:{allowed_executables:["node","npm"],validation_steps:[{name:"tests",command:"npm",arguments:["test"]}]}
  });
  const p=JSON.parse(text).projects.demo;
  assert.equal(p.enabled,true);
  assert.equal(p.max_iterations,5);
  assert.equal(p.enforce_wrapper_validation,true);
  assert.equal(p.code_review.required_for_code_changes,true);
  assert.deepEqual(p.allowed_validation_executables,["git","node","npm"]);
  assert.equal("default_review_route" in p,false);
});

test("workflow only substitutes a validated runner label",()=>{
  assert.match(renderWorkflow("runs-on: [self-hosted, {{RUNNER_LABEL}}]",{runnerLabel:"codex-orchestrator-ab12"}),/ab12/);
  assert.throws(()=>renderWorkflow("x {{RUNNER_LABEL}}",{runnerLabel:"bad label && cmd"}));
});

test("PowerShell config quotes user-derived values and has no reviewer fallback",()=>{
  const c=renderConfigPs1({
    githubLogin:"user'name",
    projectKey:"demo",
    projectClonePath:"C:\\A B\\demo",
    runnerPath:"C:\\runner-demo",
    browserPort:9333,
    browserProfile:"C:\\profile",
    chatRouteFile:"C:\\Users\\Example\\.chatgpt-codex-orchestrator\\routes\\runner-demo\\chat-routes.json"
  });
  assert.match(c,/user''name/);
  assert.match(c,/CODEX_CHAT_ROUTE_FILE/);
  assert.match(c,/chat-routes\.json/);
  assert.match(c,/ORCHESTRATOR_INSTANCE_ID = 'runner-demo'/);
  assert.doesNotMatch(c,/PROJECT_REVIEW_ROUTES|CHAT_ROUTES|ORCHESTRATOR_ORIGIN_FALLBACK_MINUTES/);
  assert.doesNotMatch(c,/PRICEUP/i);
});

test("local paths and project keys are deterministic",()=>{
  assert.equal(safeKey("My App!"),"my-app");
  const p=defaultLocalPaths({home:"C:\\Users\\Example",installationId:"abc-def-123",projectKey:"my-app"});
  assert.match(p.runnerLabel,/^codex-orchestrator-/);
});

test("project registry can keep the real project disabled while sandbox is enabled",()=>{
  const disabled=JSON.parse(renderProjectsJson({
    projectKey:"real-app",
    repository:"owner/real-app",
    defaultBranch:"main",
    validationProfile:{allowed_executables:["node","npm"],validation_steps:[]},
    enabled:false
  })).projects["real-app"];
  assert.equal(disabled.enabled,false);
});
