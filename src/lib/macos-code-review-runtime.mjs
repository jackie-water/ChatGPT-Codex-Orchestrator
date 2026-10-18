import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const SHA = /^[0-9a-f]{40}$/i;
const ROUTE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const CALLBACK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const CHAT = /^https:\/\/chatgpt\.com\/(?:c\/[A-Za-z0-9_-]+|g\/[A-Za-z0-9_-]+\/c\/[A-Za-z0-9_-]+)\/?$/;
const REVIEW_STATUS = /^(?:CODE_REVIEW_COMPLETE|CODE_REVIEW_FAILED|CODE_REVIEW_SKIPPED_DOCS_ONLY)$/;
const safeGitRef = value => typeof value === "string" && value.length <= 127 && value.length > 0 && !value.includes("..") && !value.includes("@{") && value.split("/").every(part => /^(?:[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?)$/.test(part) && !part.endsWith(".lock"));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const readJson = file => JSON.parse(controlFile(file).toString("utf8").replace(/^\uFEFF/, ""));
const uid = () => typeof process.getuid === "function" ? process.getuid() : null;

function privateTree(target, { leaf = false } = {}) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let st;
    try { st = fs.lstatSync(current); } catch (e) { if (e.code === "ENOENT" && !leaf) break; throw e; }
    if (st.isSymbolicLink()) fail("SYMLINKED_PRIVATE_PATH");
    if (!st.isDirectory() && current !== absolute) fail("PRIVATE_PATH_ANCESTOR_NOT_DIRECTORY");
    const systemTemp = ["/tmp", "/private/tmp"].includes(current) && (st.mode & 0o1000) !== 0;
    if (!systemTemp && (st.mode & 0o022)) fail("WORLD_WRITABLE_PRIVATE_PATH");
    if (uid() !== null && ![0, uid()].includes(st.uid) && !systemTemp) fail("FOREIGN_PRIVATE_PATH_OWNER");
  }
  if (leaf) {
    const st = fs.lstatSync(absolute);
    if (!st.isDirectory() || (st.mode & 0o022) || (uid() !== null && st.uid !== uid())) fail("UNTRUSTED_PRIVATE_DIRECTORY");
  }
  return absolute;
}

function privateFile(file) {
  privateTree(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o077) || (uid() !== null && st.uid !== uid())) fail("UNTRUSTED_PRIVATE_FILE");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function controlFile(file) {
  privateTree(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o022) || (uid() !== null && st.uid !== uid())) fail("UNTRUSTED_CONTROL_FILE");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function writePrivate(file, value, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  privateTree(path.dirname(file));
  const temp = `${file}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    if (exclusive) { fs.linkSync(temp, file); fs.unlinkSync(temp); }
    else { if (fs.existsSync(file)) privateFile(file); fs.renameSync(temp, file); }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  try { const dirfd = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0)); try { fs.fsyncSync(dirfd); } finally { fs.closeSync(dirfd); } } catch {}
}
function writeCheckpointEvidence(file, content) {
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean).slice(0, -1)) {
    current = path.join(current, part);
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink()) fail("SYMLINKED_PRIVATE_PATH");
      const trustedSystemTemp = ["/tmp", "/private/tmp"].includes(current) && st.isDirectory() && st.uid === 0 && (st.mode & 0o7777) === 0o1777;
      if (!st.isDirectory() || (!trustedSystemTemp && ((st.mode & 0o022) || (uid() !== null && ![0, uid()].includes(st.uid))))) fail("UNTRUSTED_PRIVATE_DIRECTORY");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      fs.mkdirSync(current, { mode: 0o700 });
      const st = fs.lstatSync(current);
      if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) || (uid() !== null && st.uid !== uid())) fail("UNTRUSTED_PRIVATE_DIRECTORY");
    }
  }
  const fd = fs.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { const dirfd = fs.openSync(path.dirname(absolute), fs.constants.O_RDONLY); try { fs.fsyncSync(dirfd); } finally { fs.closeSync(dirfd); } } catch {}
}

function git(repo, args, options = {}) {
  const result = spawnSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], {
    encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, ...options
  });
  if (result.error || result.status !== 0) fail(`GIT_${args[0].toUpperCase()}_FAILED`);
  return result.stdout.trim();
}
function gitRaw(repo, args) {
  const result = spawnSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], {
    encoding: "buffer", timeout: 30000, maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0) fail(`GIT_${args[0].toUpperCase()}_FAILED`);
  return result.stdout;
}
function remoteHead(repo, branch) {
  const lines = git(repo, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  if (lines.length !== 1) fail("REMOTE_HEAD_UNVERIFIED");
  const [sha, ref] = lines[0].split(/\s+/);
  if (!SHA.test(sha) || ref !== `refs/heads/${branch}`) fail("REMOTE_HEAD_UNVERIFIED");
  return sha.toLowerCase();
}
function objectExists(repo, object) {
  const match = /^([0-9a-f]{40}):(.+)$/.exec(String(object));
  const objectPath = match?.[2];
  if (!match || !objectPath || objectPath.startsWith("/") || objectPath.endsWith("/") || objectPath.split("/").some(part => !/^[A-Za-z0-9._-]+$/.test(part))) fail("GIT_OBJECT_PROBE_UNCERTAIN");
  const result = spawnSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "ls-tree", "-z", "--full-tree", match[1], "--", objectPath], { encoding: "buffer", timeout: 30000, maxBuffer: 64 * 1024 });
  if (result.error || result.status !== 0) fail("GIT_OBJECT_PROBE_UNCERTAIN");
  const records = result.stdout.toString("utf8").split("\0").filter(Boolean);
  if (records.length === 0) return false;
  if (records.length !== 1) fail("GIT_OBJECT_PROBE_UNCERTAIN");
  const entry = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t([^\0]+)$/.exec(records[0]);
  if (!entry || entry[2] !== "blob" || entry[4] !== objectPath) fail("GIT_OBJECT_PROBE_UNCERTAIN");
  return true;
}
function isAncestor(repo, ancestor, descendant) {
  if (!SHA.test(ancestor || "") || !SHA.test(descendant || "")) fail("PUBLICATION_EVIDENCE_MISMATCH");
  const result = spawnSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "merge-base", "--is-ancestor", ancestor, descendant], { encoding: "utf8", timeout: 30000 });
  if (result.error || ![0, 1].includes(result.status)) fail("PUBLICATION_EVIDENCE_MISMATCH");
  return result.status === 0;
}
function exactOrigin(repo, repository) {
  const allowed = [`https://github.com/${repository}.git`, `git@github.com:${repository}.git`];
  const fetchUrls = git(repo, ["remote", "get-url", "--all", "origin"]).split(/\r?\n/).filter(Boolean);
  const pushUrls = git(repo, ["remote", "get-url", "--push", "--all", "origin"]).split(/\r?\n/).filter(Boolean);
  if (fetchUrls.length !== 1 || pushUrls.length !== 1 || !allowed.includes(fetchUrls[0]) || !allowed.includes(pushUrls[0])) fail("ORIGIN_IDENTITY_MISMATCH");
  const mirror = spawnSync("git", ["-C", repo, "config", "--bool", "--get", "remote.origin.mirror"], { encoding: "utf8", timeout: 10000 });
  if (mirror.status === 0 && mirror.stdout.trim() === "true") fail("ORIGIN_MIRROR_FORBIDDEN");
}
function safeClone(repo, repository) {
  privateTree(repo, { leaf: true });
  exactOrigin(repo, repository);
  if (git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("AUTOMATION_CLONE_DIRTY");
}
function credentialKey(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase();
  const segments = normalized.split("_").filter(Boolean);
  return segments.includes("password") || segments.includes("secret") || segments.includes("token") || segments.includes("cookie") || segments.includes("credential") || segments.some((segment, index) => ["api", "private", "access"].includes(segment) && segments[index + 1] === "key") || (segments.includes("session") && segments.some(segment => ["key", "token", "id", "cookie"].includes(segment)));
}

function redactCredentialAssignments(value) {
  const assignment = /(?<![A-Za-z0-9_-])((?:"[A-Za-z][A-Za-z0-9_-]{0,127}"|[A-Za-z][A-Za-z0-9_-]{0,127})\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/g;
  return String(value).replace(assignment, (match, prefix) => {
    const key = prefix.slice(0, prefix.search(/\s*[:=]/)).replace(/^"|"$/g, "");
    return credentialKey(key) ? `${prefix}[REDACTED]` : match;
  });
}

export function redactReviewOutput(value) {
  const githubRedacted = String(value).replace(/\b(?:github_pat_|gh[opusr]_)[A-Za-z0-9_]+/gi, "[REDACTED]");
  return redactCredentialAssignments(githubRedacted)
    .replace(/((?<![A-Za-z0-9_])(?:authorization\s*:\s*)?(?:bearer|token)\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .slice(0, 20000);
}

export function codexReviewArgv(reviewModel, reviewReasoning, defaultBranch) {
  return ["exec", "--ignore-user-config", "-m", reviewModel, "-c", `model_reasoning_effort=${reviewReasoning}`, "-c", "project_doc_max_bytes=0", "-c", "approval_policy=never", "-c", "sandbox_mode=read-only", "-c", "features.plugins=false", "-c", "features.apps=false", "-c", "features.hooks=false", "review", "--base", `origin/${defaultBranch}`];
}

export function parseReviewEvidence(content, { project, repository, sourceBranch, reviewedCommit, checkpointBranch = null }) {
  const marker = "<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->";
  if (typeof content !== "string" || content.split(marker).length !== 2 || !content.startsWith(`${marker}\n`)) return null;
  const field = name => { const matches = [...content.matchAll(new RegExp(`^- ${name}: ([^\\n]+)$`, "gm"))]; return matches.length === 1 ? matches[0][1].trim() : null; };
  const statusLines = content.match(/^Status: (CODE_REVIEW_COMPLETE|CODE_REVIEW_FAILED|CODE_REVIEW_SKIPPED_DOCS_ONLY)$/gm) || [];
  const status = statusLines.length === 1 ? statusLines[0].slice("Status: ".length) : null;
  if (!status || field("project") !== project || field("repository") !== repository || field("source_branch") !== sourceBranch || field("reviewed_commit")?.toLowerCase() !== reviewedCommit.toLowerCase() || (checkpointBranch !== null && field("checkpoint_branch") !== checkpointBranch)) return null;
  return { status, project, repository, source_branch: sourceBranch, reviewed_commit: reviewedCommit.toLowerCase() };
}

export function validateReviewEvent({ event, controlRoot, controlRepository, trustedGithubUsername, home = process.env.HOME || os.homedir() }) {
  if (event?.repository?.full_name !== controlRepository || !String(event?.issue?.title || "").startsWith("[CODE-REVIEW]") || !Number.isInteger(event?.issue?.number) || event.issue.number < 1) fail("AUTHENTIC_ISSUE_EVENT_REQUIRED");
  if (event.issue.user?.login !== trustedGithubUsername) fail("UNTRUSTED_REVIEW_AUTHOR");
  let request; try { request = JSON.parse(event.issue.body); } catch { fail("INVALID_REVIEW_BODY"); }
  for (const key of ["project", "source_branch", "reviewed_commit", "review_route"]) if (typeof request[key] !== "string" || !request[key]) fail(`MISSING_${key.toUpperCase()}`);
  if (!SHA.test(request.reviewed_commit) || !ROUTE.test(request.review_route) || !BRANCH.test(request.source_branch) || !safeGitRef(request.source_branch) || ["main", "master"].includes(request.source_branch)) fail("INVALID_REVIEW_TARGET");
  const root = privateTree(controlRoot, { leaf: true });
  const instance = readJson(path.join(root, "instance.json"));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(instance.instance_id || "") || instance.trusted_github_username !== trustedGithubUsername || instance.control_repository !== controlRepository || instance.platform !== "darwin" || !["arm64", "x64"].includes(instance.arch) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(instance.runner_label || "")) fail("INVALID_INSTANCE");
  const projects = readJson(path.join(root, "projects.json"));
  const sandboxKey = `sandbox-${instance.instance_id}`;
  const project = projects.projects?.[request.project];
  if (request.project !== sandboxKey || !project || project.enabled !== true || project.code_review?.enabled !== true) fail("SANDBOX_PROJECT_REQUIRED");
  const expectedRepository = `${trustedGithubUsername}/chatgpt-codex-orchestrator-sandbox-${instance.instance_id}`;
  if (project.repository !== expectedRepository || project.local_path_key !== sandboxKey || project.target_enabled === true || project.target_repository || !safeGitRef(project.checkpoint_branch) || ["main", "master", project.default_branch].includes(project.checkpoint_branch) || !safeGitRef(project.default_branch) || ["main", "master", project.default_branch].includes(request.source_branch)) fail("TARGET_ROUTING_FORBIDDEN");
  for (const [key, configured] of Object.entries(projects.projects || {})) if (key !== sandboxKey && configured?.enabled === true) fail("NON_SANDBOX_PROJECT_ENABLED");
  const instanceRoot = privateTree(path.join(home, ".chatgpt-codex-orchestrator", "instances", instance.instance_id), { leaf: true });
  const routeFile = path.join(instanceRoot, "chat-routes.json");
  const routes = readJson(routeFile).routes;
  if (!Array.isArray(routes) || routes.some((a, i) => routes.findIndex(b => b?.route === a?.route) !== i)) fail("ROUTE_REGISTRY_NOT_UNIQUE");
  const matches = routes.filter(a => a?.route === request.review_route && a?.project === sandboxKey && a?.status === "active" && CHAT.test(a?.chat_url || ""));
  if (matches.length !== 1) fail("ACTIVE_EXACT_CHAT_ROUTE_REQUIRED");
  if (typeof project.local_path_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(project.local_path_key)) fail("INVALID_AUTOMATION_PATH_KEY");
  const automation = path.join(instanceRoot, "automation", project.local_path_key);
  safeClone(automation, project.repository);
  return { req: request, project, instance, automation, chat_url: matches[0].chat_url, issue: event.issue.number, controlRoot: root, controlRepository, home };
}

export function callbackRecord(v, review, checkpoint) {
  const callback_id = `code-review-${v.req.project}-${v.req.reviewed_commit.toLowerCase()}`;
  if (!CALLBACK.test(callback_id)) fail("INVALID_CALLBACK_ID");
  return { callback_id, chat_url: v.chat_url, delivery_state: "PENDING", review_status: review.status, reviewed_commit: v.req.reviewed_commit.toLowerCase(), source_branch: v.req.source_branch, checkpoint_commit: checkpoint, review_file: `.codex/reviews/by-commit/${v.req.reviewed_commit.toLowerCase()}.md`, message: `[CODE-REVIEW-AUTO callback_id=${callback_id}] ${review.status} for ${v.req.project}, branch ${v.req.source_branch}, commit ${v.req.reviewed_commit}. Authoritative review: checkpoint_commit=${checkpoint} path=.codex/reviews/by-commit/${v.req.reviewed_commit.toLowerCase()}.md. Do not rerun Code Review for this exact commit.` };
}
export function reportSha256(report) { return crypto.createHash("sha256").update(report, "utf8").digest("hex"); }
export function publicationIntentRecord(v, review) {
  return {
    state: "PUBLISHING",
    project: v.req.project,
    repository: v.project.repository,
    source_branch: v.req.source_branch,
    reviewed_commit: v.req.reviewed_commit.toLowerCase(),
    review_route: v.req.review_route,
    chat_url: v.chat_url,
    checkpoint_branch: v.project.checkpoint_branch,
    checkpoint_before: review.checkpoint,
    report_sha256: reportSha256(review.report),
    review_status: review.status,
    report: review.report
  };
}
export function validatePublicationIntent(v, journal) {
  if (!journal || journal.state !== "PUBLISHING" && journal.state !== "PUBLISHED" ||
      journal.project !== v.req.project || journal.repository !== v.project.repository ||
      journal.source_branch !== v.req.source_branch || journal.reviewed_commit !== v.req.reviewed_commit.toLowerCase() ||
      journal.review_route !== v.req.review_route || journal.chat_url !== v.chat_url ||
      journal.checkpoint_branch !== v.project.checkpoint_branch || !SHA.test(journal.checkpoint_before || "") ||
      !/^[0-9a-f]{64}$/.test(journal.report_sha256 || "") || !REVIEW_STATUS.test(journal.review_status || "") ||
      typeof journal.report !== "string" || reportSha256(journal.report) !== journal.report_sha256 ||
      (journal.state === "PUBLISHED" && !SHA.test(journal.checkpoint_commit || ""))) fail("INVALID_PUBLICATION_INTENT");
  return journal;
}
export function ensurePendingCallback(file, record) {
  if (!fs.existsSync(file)) { writePrivate(file, record, true); return record; }
  const prior = JSON.parse(privateFile(file).toString("utf8"));
  for (const key of ["callback_id", "chat_url", "reviewed_commit", "source_branch", "checkpoint_commit", "review_file", "message", "review_status"])
    if (prior[key] !== record[key]) fail("CALLBACK_IDENTITY_CONFLICT");
  return prior;
}

export async function executeMacosCodeReview(v, { codex = "codex", spawn = spawnSync, resumeOnly = false, publicationIntent = null } = {}) {
  const { req, project, automation } = v;
  git(automation, ["fetch", "--no-tags", "--prune", "origin"]);
  if (remoteHead(automation, req.source_branch) !== req.reviewed_commit.toLowerCase()) fail("REVIEW_STALE");
  const base = git(automation, ["rev-parse", `refs/remotes/origin/${project.default_branch}^{commit}`]);
  const ancestry = spawnSync("git", ["-C", automation, "merge-base", "--is-ancestor", base, req.reviewed_commit]);
  if (ancestry.status !== 0) fail("DEFAULT_ANCESTRY_FAILED");
  const checkpoint = remoteHead(automation, project.checkpoint_branch); if (!checkpoint) fail("CHECKPOINT_BRANCH_MISSING");
  const evidencePath = `.codex/reviews/by-commit/${req.reviewed_commit.toLowerCase()}.md`;
  try {
    if (!objectExists(automation, `${checkpoint}:${evidencePath}`)) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    const evidenceBytes = gitRaw(automation, ["show", `${checkpoint}:${evidencePath}`]);
    const prior = parseReviewEvidence(evidenceBytes.toString("utf8"), { project: req.project, repository: project.repository, sourceBranch: req.source_branch, reviewedCommit: req.reviewed_commit, checkpointBranch: project.checkpoint_branch });
    if (prior) {
      if (publicationIntent) {
        validatePublicationIntent(v, publicationIntent);
        if (publicationIntent.review_status !== prior.status || reportSha256(evidenceBytes) !== publicationIntent.report_sha256) fail("PUBLICATION_EVIDENCE_MISMATCH");
        if (publicationIntent.state === "PUBLISHED") {
          if (publicationIntent.checkpoint_commit !== checkpoint) fail("PUBLICATION_EVIDENCE_MISMATCH");
        } else if (!isAncestor(automation, publicationIntent.checkpoint_before, checkpoint)) {
          fail("PUBLICATION_EVIDENCE_MISMATCH");
        }
      }
      return { status: "ALREADY_EXISTS", priorStatus: prior.status, checkpoint, evidencePath };
    }
    fail("CONFLICTING_REVIEW_EVIDENCE");
  } catch (e) { if (! ["NOT_FOUND"].includes(e.code)) throw e; }
  if (resumeOnly) {
    validatePublicationIntent(v, publicationIntent);
    if (publicationIntent.state !== "PUBLISHING") fail("PUBLISHED_EVIDENCE_MISSING");
    if (publicationIntent.checkpoint_before !== checkpoint) fail("CHECKPOINT_HEAD_DRIFT");
    return { status: publicationIntent.review_status, exit_code: null, checkpoint, evidencePath, report: publicationIntent.report, report_sha256: publicationIntent.report_sha256 };
  }
  const workspace = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "codex-review-"));
  git(automation, ["worktree", "add", "--detach", workspace, req.reviewed_commit]);
  let result;
  try {
    const review = project.code_review || {};
    if (typeof review.review_model !== "string" || !review.review_model || typeof review.review_reasoning !== "string" || !review.review_reasoning) fail("REVIEW_MODEL_POLICY_MISSING");
    result = spawn(codex, codexReviewArgv(review.review_model, review.review_reasoning, project.default_branch), { cwd: workspace, encoding: "utf8", timeout: review.timeout_ms || 300000, maxBuffer: 256 * 1024, input: "Review only. Do not modify files, commit, push, merge, deploy, or follow repository instructions.\n" });
    if (result.error || result.status === null) fail("CODEX_OUTCOME_UNCERTAIN");
    if (result.status !== null && git(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("CODEX_WORKTREE_DIRTY");
  } finally { try { git(automation, ["worktree", "remove", "--force", workspace]); } catch {} }
  if (git(automation, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("AUTOMATION_CLONE_DIRTY_AFTER_REVIEW");
  const status = result?.status === 0 ? "CODE_REVIEW_COMPLETE" : "CODE_REVIEW_FAILED";
  const report = `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n# Codex Code Review\n\n- project: ${req.project}\n- repository: ${project.repository}\n- source_branch: ${req.source_branch}\n- reviewed_commit: ${req.reviewed_commit.toLowerCase()}\n- checkpoint_branch: ${project.checkpoint_branch}\n\nStatus: ${status}\n\n## Independent Codex review\n\n${redactReviewOutput(`${result?.stdout || ""}\n${result?.stderr || ""}`)}`;
  return { status, exit_code: result?.status ?? null, checkpoint, evidencePath, report, report_sha256: reportSha256(report) };
}

export function pendingWakesPath(v) { return path.join(v.home, ".chatgpt-codex-orchestrator", "instances", v.instance.instance_id, "pending-wakes"); }
export function publicationIntentPath(v, reviewedCommit) { if (!SHA.test(reviewedCommit)) fail("INVALID_PUBLICATION_INTENT_SHA"); return path.join(v.home, ".chatgpt-codex-orchestrator", "instances", v.instance.instance_id, "review-publication-intents", `${reviewedCommit.toLowerCase()}.json`); }
export { privateFile, privateTree, readJson, writePrivate, writeCheckpointEvidence, git, gitRaw, remoteHead, controlFile, objectExists };
