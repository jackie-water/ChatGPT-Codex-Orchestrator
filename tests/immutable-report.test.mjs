import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("implementation callbacks point to immutable per-issue reports",()=>{
  const publisher=fs.readFileSync(new URL("../runtime/scripts/publish-checkpoint.ps1",import.meta.url),"utf8");
  const runner=fs.readFileSync(new URL("../runtime/scripts/run-codex.ps1",import.meta.url),"utf8");
  assert.match(publisher,/\.codex\/runs\/by-issue\//);
  assert.match(publisher,/CHECKPOINT_PUBLISHED/);
  assert.match(publisher,/refs\/heads\/\$SourceBranch`:refs\/remotes\/origin\/\$SourceBranch/);
  assert.match(publisher,/refs\/heads\/\$CheckpointBranch`:refs\/remotes\/origin\/\$CheckpointBranch/);
  assert.match(publisher,/fetch origin "refs\/heads\/\$CheckpointBranch`:refs\/remotes\/origin\/\$CheckpointBranch" \| Out-Null\r?\n\s*if \(\$LASTEXITCODE -ne 0\)/);
  assert.match(runner,/checkpoint_commit=\$checkpointCommit path=\$runReportRel/);
  assert.match(runner,/Do not substitute \.codex\/latest-run\.md/);
});

test("code review callbacks point to immutable by-commit evidence",()=>{
  const publisher=fs.readFileSync(new URL("../runtime/scripts/publish-code-review.ps1",import.meta.url),"utf8");
  const runner=fs.readFileSync(new URL("../runtime/scripts/run-code-review.ps1",import.meta.url),"utf8");
  assert.match(publisher,/CODE_REVIEW_PUBLISHED/);
  assert.match(publisher,/\.codex\/reviews\/by-commit\//);
  assert.match(runner,/checkpoint_commit=\$checkpointCommit path=\$reviewEvidencePath/);
});
