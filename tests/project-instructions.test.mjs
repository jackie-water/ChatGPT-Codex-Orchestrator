import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {renderProjectInstructions} from "../src/lib/project-instructions.mjs";

test("generated instructions point orchestration issues to the control repository",()=>{
  const template=fs.readFileSync(new URL("../templates/chatgpt-project-instructions.md",import.meta.url),"utf8");
  const text=renderProjectInstructions(template,{
    projectKey:"demo",
    repository:"owner/app",
    controlRepository:"owner/control",
    sandboxProjectKey:"sandbox-abcd1234"
  });
  assert.match(text,/Control repository: `owner\/control`/);
  assert.match(text,/Installation sandbox project key: `sandbox-abcd1234`/);
  assert.match(text,/never in the application repository/);
  assert.doesNotMatch(text,/\{\{[A-Z0-9_]+\}\}/);
});

test("instructions renderer rejects unresolved configuration",()=>{
  assert.throws(()=>renderProjectInstructions("{{PROJECT_KEY}}",{
    projectKey:"demo",
    repository:"owner/app",
    controlRepository:"",
    sandboxProjectKey:"sandbox-demo"
  }));
});
