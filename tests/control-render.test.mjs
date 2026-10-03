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
});

test("workflow only substitutes a validated runner label",()=>{
  assert.match(renderWorkflow("runs-on: [self-hosted, {{RUNNER_LABEL}}]",{runnerLabel:"codex-orchestrator-ab12"}),/ab12/);
  assert.throws(()=>renderWorkflow("x {{RUNNER_LABEL}}",{runnerLabel:"bad label && cmd"}));
});

test("PowerShell config quotes user-derived values",()=>{
  const c=renderConfigPs1({
    githubLogin:"user'name",
    projectKey:"demo",
    projectClonePath:"C:\\A B\\demo",
    reviewerChatUrl:"https://chatgpt.com/c/abc",
    runnerPath:"C:\\runner",
    browserPort:9333,
    browserProfile:"C:\\profile"
  });
  assert.match(c,/user''name/);
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


test("generated config enables delayed issue-origin fallback",()=>{
  const c=renderConfigPs1({
    githubLogin:"user",
    projectMappings:[{projectKey:"demo",projectClonePath:"C:\\demo",reviewerChatUrl:"https://chatgpt.com/c/fallback"}],
    runnerPath:"C:\\runner-demo",
    browserPort:9333,
    browserProfile:"C:\\profile-demo"
  });
  assert.match(c,/ORCHESTRATOR_ORIGIN_FALLBACK_MINUTES = '30'/);
  assert.match(c,/ORCHESTRATOR_INSTANCE_ID = 'runner-demo'/);
});
