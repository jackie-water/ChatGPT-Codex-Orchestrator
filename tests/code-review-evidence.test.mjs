import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ps = (command, env = process.env) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", env });
const run = (script, args, env = process.env) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { encoding: "utf8", env });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

test("review evidence decisions fail closed and permit only failed retries", { skip: process.platform !== "win32" }, () => {
  const script = fs.readFileSync(path.resolve("runtime/scripts/run-code-review.ps1"), "utf8");
  const prefix = script.slice(0, script.indexOf("$reviewFile ="));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-review-evidence-"));
  const file = path.join(dir, "evidence.md");
  const invoke = (content, policy = false) => {
    fs.writeFileSync(file, content);
    const command = `${prefix}\nGet-ExistingReviewEvidenceStatus -Content (Get-Content -Raw ${quote(file)}) -Path ${quote(file)} -ExpectedCommit ${quote("a".repeat(40))} -ExpectedBranch ${quote("fix/example")} -DocsOnlyPolicy $${policy ? "true" : "false"}`;
    return ps(command);
  };
  const evidence = status => `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n- source_branch: fix/example\n- reviewed_commit: ${"a".repeat(40)}\nStatus: ${status}\n`;
  try {
    assert.equal(fs.existsSync(file), false, "no prior evidence is the proceed case");
    assert.equal(invoke(evidence("CODE_REVIEW_COMPLETE")).status, 0);
    assert.equal(invoke(evidence("CODE_REVIEW_SKIPPED_DOCS_ONLY"), true).status, 0);
    assert.equal(invoke(evidence("CODE_REVIEW_FAILED")).status, 0);
    for (const bad of [
      evidence("CODE_REVIEW_COMPLETE").replace("CODEX_ORCHESTRATOR_CODE_REVIEW_V1", "OTHER"),
      evidence("CODE_REVIEW_COMPLETE") + "Status: CODE_REVIEW_FAILED\n",
      evidence("CODE_REVIEW_COMPLETE").replace("- reviewed_commit: " + "a".repeat(40), "- reviewed_commit: " + "b".repeat(40)),
      evidence("CODE_REVIEW_COMPLETE").replace("- source_branch: fix/example", "- source_branch: feat/other"),
      evidence("CODE_REVIEW_SKIPPED_DOCS_ONLY"),
      evidence("CODE_REVIEW_COMPLETE").replace("- source_branch: fix/example\n", ""),
      evidence("CODE_REVIEW_COMPLETE") + "- reviewed_commit: " + "a".repeat(40) + "\n"
    ]) assert.notEqual(invoke(bad, false).status, 0);
    assert.match(invoke(evidence("CODE_REVIEW_COMPLETE")).stdout + invoke(evidence("CODE_REVIEW_COMPLETE")).stderr, /CODE_REVIEW_COMPLETE|expected|status/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("review publisher replaces failed canonical evidence and retains timestamped history", { skip: process.platform !== "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-review-publish-"));
  const bare = path.join(dir, "origin.git"), work = path.join(dir, "work"), report = path.join(dir, "report.md");
  const git = (...args) => { const r = spawnSync("git", args, { cwd: work, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    fs.mkdirSync(work); spawnSync("git", ["init", "--bare", bare], { encoding: "utf8" });
    spawnSync("git", ["clone", bare, work], { encoding: "utf8" });
    git("config", "user.name", "test"); git("config", "user.email", "test@example.com");
    fs.writeFileSync(path.join(work, "seed.txt"), "seed\n"); git("add", "."); git("commit", "-m", "seed"); git("push", "origin", "HEAD:refs/heads/main");
    git("checkout", "-b", "fix/review"); fs.writeFileSync(path.join(work, "change.txt"), "change\n"); git("add", "."); git("commit", "-m", "change"); const commit = git("rev-parse", "HEAD"); git("push", "origin", "HEAD:refs/heads/fix/review");
    git("checkout", "-b", "checkpoint", "main"); git("push", "origin", "HEAD:refs/heads/checkpoint");
    const publish = path.resolve("runtime/scripts/publish-code-review.ps1");
    const publishOnce = status => { fs.writeFileSync(report, `## Result\n\nStatus: ${status}\n`); const r = run(publish, ["-RepoPath", work, "-ProjectKey", "fixture", "-Repository", "fixture/repo", "-CheckpointBranch", "checkpoint", "-SourceBranch", "fix/review", "-SourceCommit", commit, "-ReportPath", report]); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
    publishOnce("CODE_REVIEW_FAILED"); spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 1"]); publishOnce("CODE_REVIEW_COMPLETE");
    const listed = git("ls-tree", "-r", "--name-only", "origin/checkpoint");
    assert.match(listed, new RegExp(`\\.codex/reviews/by-commit/${commit}\\.md`));
    assert.equal((listed.match(/\.codex\/reviews\/history\/[^\n]+/g) || []).length, 2);
    fs.writeFileSync(report, "## Result\n\nStatus: CODE_REVIEW_COMPLETE\n");
    assert.equal(publishOnce("CODE_REVIEW_COMPLETE").includes("CODE_REVIEW_PUBLISHED"), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
