import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("control workflow queues multiple pending orchestration runs",()=>{
  const text=fs.readFileSync(new URL("../templates/control-repo/orchestrator.yml.template",import.meta.url),"utf8");
  assert.match(text,/concurrency:\s*[\s\S]*?group:\s*chatgpt-codex-orchestrator[\s\S]*?queue:\s*max/);
  assert.doesNotMatch(text,/cancel-in-progress:\s*true/);
  assert.match(text,/register-chat:/);
  assert.match(text,/\[CHAT-REGISTER\]/);
});
