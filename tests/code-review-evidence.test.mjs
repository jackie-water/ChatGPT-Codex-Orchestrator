import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ps = (command) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8" });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

test("review evidence validates exact context and dispositions", { skip: process.platform !== "win32" }, () => {
  const helper = path.resolve("runtime/scripts/code-review-evidence.ps1");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-review-evidence-"));
  const file = path.join(dir, "evidence.md");
  const sha = "a".repeat(40);
  const evidence = status => `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n- source_branch: fix/example\n- reviewed_commit: ${sha}\nStatus: ${status}\n`;
  const invoke = (content, policy = false) => {
    fs.writeFileSync(file, content);
    return ps(`. ${quote(helper)}; Get-ExistingReviewEvidenceStatus -Content (Get-Content -Raw ${quote(file)}) -Path ${quote(file)} -ExpectedCommit ${quote(sha)} -ExpectedBranch ${quote("fix/example")} -DocsOnlyPolicy $${policy}`);
  };
  try {
    for (const status of ["CODE_REVIEW_COMPLETE", "CODE_REVIEW_FAILED"]) assert.equal(invoke(evidence(status)).status, 0);
    assert.equal(invoke(evidence("CODE_REVIEW_SKIPPED_DOCS_ONLY"), true).status, 0);
    for (const [status, expected] of [["CODE_REVIEW_FAILED", "RETRY"], ["CODE_REVIEW_COMPLETE", "DEDUP"], ["CODE_REVIEW_SKIPPED_DOCS_ONLY", "DEDUP"]]) {
      const result = ps(`. ${quote(helper)}; Get-CodeReviewEvidenceDisposition -Status ${quote(status)}`);
      assert.equal(result.status, 0);
      assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), expected);
    }
    for (const bad of [
      evidence("CODE_REVIEW_COMPLETE").replace("CODEX_ORCHESTRATOR_CODE_REVIEW_V1", "OTHER"),
      evidence("CODE_REVIEW_NOT_A_STATUS"), evidence("CODE_REVIEW_COMPLETE") + "Status: CODE_REVIEW_FAILED\n",
      evidence("CODE_REVIEW_COMPLETE").replace(sha, "b".repeat(40)), evidence("CODE_REVIEW_COMPLETE").replace("fix/example", "feat/other"),
      evidence("CODE_REVIEW_SKIPPED_DOCS_ONLY"), evidence("CODE_REVIEW_COMPLETE").replace("- source_branch: fix/example\n", "")
    ]) assert.notEqual(invoke(bad).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("run-code-review uses publication coordinates directly for wake callback", () => {
  const source = fs.readFileSync("runtime/scripts/run-code-review.ps1", "utf8");
  for (const match of source.matchAll(/\$publishOutput[\s\S]*?(?=\$callbackId)/g)) assert.doesNotMatch(match[0], /git fetch/);
});
