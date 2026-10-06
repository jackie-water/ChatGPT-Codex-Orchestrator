import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ps = (command) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8" });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const git = (cwd, ...args) => {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
};

test("review evidence validates exact context and dispositions", { skip: process.platform !== "win32" }, () => {
  const helper = path.resolve("runtime/scripts/code-review-evidence.ps1");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-review-evidence-"));
  const file = path.join(dir, "evidence.md");
  const sha = "a".repeat(40);
  const evidence = status => `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n# Codex Code Review\n\n- source_branch: fix/example\n- reviewed_commit: ${sha}\n\n---\n\n## Result\n\nStatus: ${status}\n\n## Review target\n\n- source_branch: fix/example\n- reviewed_commit: ${sha}\n`;
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
      evidence("CODE_REVIEW_SKIPPED_DOCS_ONLY"), evidence("CODE_REVIEW_COMPLETE").replace("- source_branch: fix/example\n", ""),
      evidence("CODE_REVIEW_COMPLETE").replace("- source_branch: fix/example\n", "- source_branch: fix/example\n- source_branch: fix/other\n"),
      evidence("CODE_REVIEW_COMPLETE").replace("- reviewed_commit: " + sha, "- reviewed_commit: " + sha + "\n- reviewed_commit: " + sha)
    ]) assert.notEqual(invoke(bad).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("publication replaces canonical evidence while retaining failed history", { skip: process.platform !== "win32" }, async () => {
  const publisher = path.resolve("runtime/scripts/publish-code-review.ps1");
  const evidenceHelper = path.resolve("runtime/scripts/code-review-evidence.ps1");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-review-publication-"));
  const remote = path.join(dir, "remote.git");
  const seed = path.join(dir, "seed");
  const clone = path.join(dir, "clone");
  const report = path.join(dir, "report.md");
  const canonical = ".codex/reviews/by-commit/";
  try {
    git(dir, "init", "--bare", remote);
    git(dir, "init", seed);
    git(seed, "config", "user.name", "Fixture");
    git(seed, "config", "user.email", "fixture@example.invalid");
    fs.writeFileSync(path.join(seed, "README.md"), "fixture\n");
    git(seed, "add", "README.md");
    git(seed, "commit", "-m", "fixture");
    git(seed, "branch", "-M", "main");
    git(seed, "checkout", "-b", "fix/example");
    fs.writeFileSync(path.join(seed, "change.txt"), "change\n");
    git(seed, "add", "change.txt");
    git(seed, "commit", "-m", "change");
    const reviewedCommit = git(seed, "rev-parse", "HEAD");
    git(seed, "checkout", "-b", "checkpoint", "main");
    git(seed, "remote", "add", "origin", remote);
    git(seed, "push", "origin", "main", "fix/example", "checkpoint");
    git(dir, "clone", remote, clone);
    git(clone, "config", "user.name", "Fixture");
    git(clone, "config", "user.email", "fixture@example.invalid");

    const syncCheckpoint = () => git(clone, "fetch", "origin", "refs/heads/checkpoint:refs/remotes/origin/checkpoint");
    const publish = status => {
      fs.writeFileSync(report, `Status: ${status}\n`);
      const result = ps(`& ${quote(publisher)} -RepoPath ${quote(clone)} -ProjectKey project -Repository ${quote(remote)} -CheckpointBranch checkpoint -SourceBranch fix/example -SourceCommit ${quote(reviewedCommit)} -ReportPath ${quote(report)}`);
      assert.equal(result.status, 0, result.stderr);
    };
    const readCanonical = () => {
      const file = `${canonical}${reviewedCommit}.md`;
      const listing = git(clone, "ls-tree", "-r", "--name-only", "origin/checkpoint", file);
      assert.equal(listing, file);
      return git(clone, "show", `origin/checkpoint:${file}`);
    };
    const verify = (content, status, expectedDisposition) => {
      const file = path.join(dir, "canonical.md");
      fs.writeFileSync(file, content);
      const result = ps(`. ${quote(evidenceHelper)}; $s = Get-ExistingReviewEvidenceStatus -Content (Get-Content -Raw ${quote(file)}) -Path ${quote(file)} -ExpectedCommit ${quote(reviewedCommit)} -ExpectedBranch ${quote("fix/example")}; if ($s -ne ${quote(status)}) { exit 1 }; Get-CodeReviewEvidenceDisposition -Status ${quote(status)}`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), expectedDisposition);
    };

    syncCheckpoint();
    assert.equal(git(clone, "ls-tree", "-r", "--name-only", "origin/checkpoint", canonical), "");
    publish("CODE_REVIEW_FAILED");
    syncCheckpoint();
    verify(readCanonical(), "CODE_REVIEW_FAILED", "RETRY");
    await new Promise(resolve => setTimeout(resolve, 1100));
    publish("CODE_REVIEW_COMPLETE");
    syncCheckpoint();
    verify(readCanonical(), "CODE_REVIEW_COMPLETE", "DEDUP");
    assert.equal(git(clone, "ls-tree", "-r", "--name-only", "origin/checkpoint", ".codex/reviews/history").split(/\r?\n/).filter(Boolean).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run-code-review uses publication coordinates directly for wake callback", () => {
  const source = fs.readFileSync("runtime/scripts/run-code-review.ps1", "utf8");
  for (const match of source.matchAll(/\$publishOutput[\s\S]*?(?=\$callbackId)/g)) assert.doesNotMatch(match[0], /git fetch/);
});
