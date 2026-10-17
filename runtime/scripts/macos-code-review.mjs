import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { validateReviewEvent, executeMacosCodeReview, callbackRecord, ensurePendingCallback, pendingWakesPath, publicationIntentPath, writePrivate, writeCheckpointEvidence, privateTree, git, readJson } from "../../src/lib/macos-code-review-runtime.mjs";

if (process.argv.length === 2) { console.error("Native macOS code-review adapter requires a validated event path"); process.exit(78); }
function args() { const out = {}; for (let i = 2; i < process.argv.length; i++) { const key = process.argv[i]; const value = process.argv[++i]; if (!key?.startsWith("--") || !value) throw Error("Invalid arguments"); out[key.slice(2).replaceAll("-", "_")] = value; } for (const key of ["event_path", "control_root", "control_repository", "trusted_github_username"]) if (!out[key]) throw Error(`Missing --${key.replaceAll("_", "-")}`); return out; }
function publish(v, review) {
  const workspace = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "codex-review-publish-"));
  git(v.automation, ["worktree", "add", "--detach", workspace, review.checkpoint]);
  try {
    const relative = review.evidencePath;
    const target = path.join(workspace, relative);
    try { writeCheckpointEvidence(target, review.report); } catch (error) { if (error.code === "EEXIST") throw Error("CONFLICTING_REVIEW_EVIDENCE"); throw error; }
    git(workspace, ["add", relative]);
    git(workspace, ["-c", "user.name=Codex Orchestrator", "-c", "user.email=codex-orchestrator@users.noreply.github.com", "commit", "-m", `chore(code-review): ${v.req.reviewed_commit.slice(0, 12)}`]);
    const commit = git(workspace, ["rev-parse", "HEAD"]);
    const current = git(v.automation, ["ls-remote", "--heads", "origin", `refs/heads/${v.project.checkpoint_branch}`]).split(/\s+/)[0]?.toLowerCase();
    if (current !== review.checkpoint) throw Error("CHECKPOINT_HEAD_RACE");
    const pushed = spawnSync("git", ["-C", workspace, "-c", "core.hooksPath=/dev/null", "push", "origin", `HEAD:refs/heads/${v.project.checkpoint_branch}`], { encoding: "utf8", timeout: 30000 });
    if (pushed.error || pushed.status !== 0) throw Error("CHECKPOINT_PUSH_FAILED");
    return commit;
  } finally { try { git(v.automation, ["worktree", "remove", "--force", workspace]); } catch {} }
}
try {
  const a = args();
  const v = validateReviewEvent({ event: JSON.parse(fs.readFileSync(a.event_path, "utf8")), controlRoot: a.control_root, controlRepository: a.control_repository, trustedGithubUsername: a.trusted_github_username, home: process.env.HOME });
  const intent = publicationIntentPath(v, v.req.reviewed_commit);
  const hasIntent = fs.existsSync(intent);
  if (hasIntent) {
    const journal = readJson(intent);
    if (journal.reviewed_commit !== v.req.reviewed_commit.toLowerCase() || journal.source_branch !== v.req.source_branch || journal.project !== v.req.project) throw Error("STALE_PUBLICATION_INTENT");
  }
  const review = await executeMacosCodeReview(v, { resumeOnly: hasIntent });
  if (review.status === "ALREADY_EXISTS") {
    const record = callbackRecord(v, { status: review.priorStatus }, review.checkpoint);
    privateTree(pendingWakesPath(v)); ensurePendingCallback(path.join(pendingWakesPath(v), `${record.callback_id}.json`), record);
    console.log(`CODE_REVIEW_ALREADY_EXISTS checkpoint=${review.checkpoint}`);
  } else {
    privateTree(pendingWakesPath(v));
    writePrivate(intent, { reviewed_commit: v.req.reviewed_commit.toLowerCase(), source_branch: v.req.source_branch, project: v.req.project, checkpoint_before: review.checkpoint, report_sha256: crypto.createHash("sha256").update(review.report).digest("hex"), state: "PUBLISHING" }, true);
    const checkpoint = publish(v, review);
    writePrivate(intent, { reviewed_commit: v.req.reviewed_commit.toLowerCase(), source_branch: v.req.source_branch, project: v.req.project, checkpoint_before: review.checkpoint, checkpoint_commit: checkpoint, report_sha256: crypto.createHash("sha256").update(review.report).digest("hex"), state: "PUBLISHED" });
    const record = callbackRecord(v, review, checkpoint);
    ensurePendingCallback(path.join(pendingWakesPath(v), `${record.callback_id}.json`), record);
    console.log(`CODE_REVIEW_PUBLISHED status=${review.status} checkpoint=${checkpoint}`);
    if (review.status === "CODE_REVIEW_FAILED") process.exitCode = 1;
  }
} catch (error) { console.error(`CODE_REVIEW_REJECTED: ${error.message}`); process.exitCode = 1; }
