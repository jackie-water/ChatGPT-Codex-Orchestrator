import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => fs.readFileSync(new URL(`../runtime/scripts/${file}`, import.meta.url), "utf8");
const isolation = [
  "features.plugins=false",
  "features.apps=false",
  "features.hooks=false",
  "features.memories=false",
  "features.goals=false",
  "cloud.skills.enabled=false",
  "skills.include_instructions=false"
];

test("implementation and independent review use isolated Codex exec sessions", () => {
  const runner = read("run-codex.ps1");
  const review = read("run-code-review.ps1");
  for (const source of [runner, review]) {
    assert.match(source, /exec --ignore-user-config/);
    for (const setting of isolation) assert.match(source, new RegExp(setting.replaceAll(".", "\\.")));
  }
  assert.match(runner, /exec --ignore-user-config[\s\S]*-m \$model[\s\S]*model_reasoning_effort/);
  for (const setting of ["model_reasoning_effort", "approval_policy", "sandbox_mode", "project_doc_max_bytes"]) {
    assert.match(runner, new RegExp(setting));
  }
  assert.match(review, /exec --ignore-user-config[\s\S]*review --base/);
  assert.match(review, /-a never[\s\S]*-s read-only/);
  assert.doesNotMatch(review, /& \$codexCommand\.Source\s+-m[\s\S]*\breview --base/);
});

test("preflight requires isolated exec and exec review base support", () => {
  const preflight = read("preflight.ps1");
  assert.match(preflight, /codex exec --help/);
  assert.match(preflight, /--ignore-user-config/);
  assert.match(preflight, /codex exec review --help/);
  assert.match(preflight, /codex exec review --base/);
  assert.doesNotMatch(preflight, /codex review --help/);
});
