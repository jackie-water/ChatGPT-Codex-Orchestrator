import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SHA = /^[0-9a-f]{40}$/i;
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ROUTE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CHAT = /^https:\/\/chatgpt\.com\/(?:c\/[A-Za-z0-9_-]+|g\/[A-Za-z0-9_-]+\/c\/[A-Za-z0-9_-]+)\/?$/;
const MARKER = "<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->";
const REVIEW_FILE = sha => `.codex/reviews/by-commit/${sha.toLowerCase()}.md`;

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uid = () => typeof process.getuid === "function" ? process.getuid() : null;
const json = value => JSON.parse(value.toString("utf8").replace(/^\uFEFF/, ""));

function safeRef(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 127 &&
    !value.startsWith("/") && !value.endsWith("/") && !value.includes("..") && !value.includes("@{") &&
    value.split("/").every(part => part && !part.endsWith(".lock") && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/.test(part));
}

function privatePath(target, { leaf = false } = {}) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let st;
    try { st = fs.lstatSync(current); } catch (error) {
      if (error.code === "ENOENT" && !leaf) break;
      fail("PRIVATE_PATH_UNREADABLE");
    }
    if (st.isSymbolicLink()) fail("SYMLINKED_PRIVATE_PATH");
    if (!st.isDirectory() && current !== absolute) fail("PRIVATE_PATH_ANCESTOR_NOT_DIRECTORY");
    const trustedTemp = ["/tmp", "/private/tmp"].includes(current) && st.uid === 0 && (st.mode & 0o7777) === 0o1777;
    if (!trustedTemp && ((st.mode & 0o022) !== 0 || (uid() !== null && st.uid !== uid() && st.uid !== 0))) fail("UNTRUSTED_PRIVATE_PATH");
  }
  if (leaf) {
    let st;
    try { st = fs.lstatSync(absolute); } catch { fail("PRIVATE_PATH_MISSING"); }
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o022) || (uid() !== null && st.uid !== uid())) fail("UNTRUSTED_PRIVATE_DIRECTORY");
  }
  return absolute;
}

function privateFile(file, { control = false } = {}) {
  privatePath(path.dirname(file));
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch { fail(control ? "CONTROL_FILE_UNREADABLE" : "PRIVATE_FILE_UNREADABLE"); }
  try {
    const st = fs.fstatSync(fd);
    const modeBad = control ? (st.mode & 0o022) !== 0 : (st.mode & 0o077) !== 0;
    if (!st.isFile() || st.nlink !== 1 || modeBad || (uid() !== null && st.uid !== uid() && st.uid !== 0)) fail(control ? "UNTRUSTED_CONTROL_FILE" : "UNTRUSTED_PRIVATE_FILE");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function readControl(root, name) {
  return json(privateFile(path.join(root, name), { control: true }));
}

function gitExecutable() {
  for (const candidate of ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"]) {
    try { const st = fs.lstatSync(candidate); if (st.isFile() && (st.mode & 0o111) && !candidate.includes("/tmp/")) return candidate; } catch {}
  }
  fail("TRUSTED_GIT_EXECUTABLE_MISSING");
}

function runGit(repo, args, { raw = false } = {}) {
  const result = spawnSync(gitExecutable(), ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], {
    encoding: raw ? "buffer" : "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0) fail(`GIT_${args[0].toUpperCase().replaceAll("-", "_")}_FAILED`);
  return raw ? result.stdout : result.stdout.trim();
}

function gitStatus(repo) {
  return runGit(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
}

function remoteHead(repo, branch) {
  if (!safeRef(branch)) fail("REMOTE_HEAD_UNVERIFIED");
  const lines = runGit(repo, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) fail("REMOTE_HEAD_UNVERIFIED");
  const [sha, ref] = lines[0].split(/\s+/);
  if (!SHA.test(sha) || ref !== `refs/heads/${branch}`) fail("REMOTE_HEAD_UNVERIFIED");
  return sha.toLowerCase();
}

function fetchPinnedRefs(repo, heads) {
  const refspecs = Object.entries(heads).map(([branch, sha]) => {
    if (!safeRef(branch) || !SHA.test(sha)) fail("REMOTE_HEAD_UNVERIFIED");
    return `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
  });
  const result = spawnSync(gitExecutable(), ["-C", repo, "-c", "core.hooksPath=/dev/null", "fetch", "--no-tags", "--no-write-fetch-head", "origin", ...refspecs], {
    encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0) fail("REMOTE_OBJECT_FETCH_FAILED");
  for (const [branch, expected] of Object.entries(heads)) {
    const local = runGit(repo, ["rev-parse", `refs/remotes/origin/${branch}`]).toLowerCase();
    const objectType = spawnSync(gitExecutable(), ["-C", repo, "-c", "core.hooksPath=/dev/null", "cat-file", "-t", expected], { encoding: "utf8", timeout: 30000 });
    if (local !== expected || objectType.error || objectType.status !== 0 || objectType.stdout.trim() !== "commit") fail("REMOTE_OBJECT_UNVERIFIED");
  }
}

function pinnedRemoteHeads(repo, branches) {
  const heads = {};
  for (const branch of branches) {
    if (heads[branch] && heads[branch] !== remoteHead(repo, branch)) fail("REMOTE_HEAD_UNVERIFIED");
    heads[branch] = remoteHead(repo, branch);
  }
  return heads;
}

function ancestor(repo, older, newer, code = "SOURCE_ANCESTRY_FAILED") {
  if (!SHA.test(older || "") || !SHA.test(newer || "")) fail(code);
  const result = spawnSync(gitExecutable(), ["-C", repo, "-c", "core.hooksPath=/dev/null", "merge-base", "--is-ancestor", older, newer], { encoding: "utf8", timeout: 30000 });
  if (result.error || ![0, 1].includes(result.status)) fail(code);
  return result.status === 0;
}

function exactOrigin(repo, repository, configuredOrigin) {
  const pushurl = spawnSync(gitExecutable(), ["-C", repo, "-c", "core.hooksPath=/dev/null", "config", "--get-regexp", "^remote\\.origin\\.pushurl$"], { encoding: "utf8", timeout: 10000 });
  if (pushurl.error || ![0, 1].includes(pushurl.status)) fail("ORIGIN_CONFIG_UNVERIFIED");
  if (pushurl.status === 0 && pushurl.stdout.trim()) fail("ORIGIN_PUSHURL_FORBIDDEN");
  const fetch = runGit(repo, ["remote", "get-url", "--all", "origin"]).split(/\r?\n/).filter(Boolean);
  const push = runGit(repo, ["remote", "get-url", "--push", "--all", "origin"]).split(/\r?\n/).filter(Boolean);
  const github = [`https://github.com/${repository}.git`, `git@github.com:${repository}.git`];
  const allowed = configuredOrigin ? [configuredOrigin] : github;
  if (fetch.length !== 1 || push.length !== 1 || fetch[0] !== push[0] || !allowed.includes(fetch[0])) fail("ORIGIN_IDENTITY_MISMATCH");
  const mirror = spawnSync(gitExecutable(), ["-C", repo, "-c", "core.hooksPath=/dev/null", "config", "--bool", "--get", "remote.origin.mirror"], { encoding: "utf8", timeout: 10000 });
  if (mirror.error || ![0, 1].includes(mirror.status)) fail("ORIGIN_CONFIG_UNVERIFIED");
  if (mirror.status === 0 && mirror.stdout.trim() === "true") fail("ORIGIN_MIRROR_FORBIDDEN");
}

function safeClone(repo, repository, configuredOrigin) {
  privatePath(repo, { leaf: true });
  exactOrigin(repo, repository, configuredOrigin);
  if (gitStatus(repo)) fail("AUTOMATION_CLONE_DIRTY");
}

function parseApproval(event, controlRepository, trustedGithubUsername) {
  if (!event || event.repository?.full_name !== controlRepository || event.issue?.pull_request ||
      !Number.isInteger(event.issue?.number) || event.issue.number < 1 ||
      typeof event.issue?.title !== "string" || !event.issue.title.startsWith("[MERGE-APPROVE]") ||
      event.issue.user?.login !== trustedGithubUsername) fail("AUTHENTIC_MERGE_APPROVAL_REQUIRED");
  let request;
  try { request = JSON.parse(event.issue.body); } catch { fail("INVALID_MERGE_APPROVAL_BODY"); }
  if (!request || Array.isArray(request) || typeof request !== "object" || Object.keys(request).sort().join(",") !== "approved_commit,project,review_route,source_branch") fail("INVALID_MERGE_APPROVAL_BODY");
  if (!PROJECT_KEY.test(request.project || "") || !safeRef(request.source_branch) ||
      SHA.test(request.approved_commit || "") === false || !ROUTE.test(request.review_route || "")) fail("INVALID_MERGE_APPROVAL_BODY");
  if (["main", "master"].includes(request.source_branch)) fail("PROTECTED_SOURCE_BRANCH");
  return request;
}

function validateInstance(instance, controlRepository, trustedGithubUsername) {
  if (!instance || !INSTANCE_ID.test(instance.instance_id || "") || instance.trusted_github_username !== trustedGithubUsername ||
      instance.control_repository !== controlRepository || instance.platform !== "darwin" || !["arm64", "x64"].includes(instance.arch)) fail("INVALID_INSTANCE");
  return instance;
}

function validateRoute(home, instanceId, projectKey, route) {
  const instanceRoot = privatePath(path.join(home, ".chatgpt-codex-orchestrator", "instances", instanceId), { leaf: true });
  const registry = readControl(instanceRoot, "chat-routes.json");
  if (!Array.isArray(registry.routes) || registry.routes.some((item, index) => registry.routes.findIndex(other => other?.route === item?.route) !== index)) fail("ROUTE_REGISTRY_NOT_UNIQUE");
  const matches = registry.routes.filter(item => item?.route === route && item?.project === projectKey && item?.status === "active" && CHAT.test(item?.chat_url || ""));
  if (matches.length !== 1) fail("ACTIVE_EXACT_CHAT_ROUTE_REQUIRED");
  return matches[0].chat_url;
}

function validateProjects(controlRoot, instance, request) {
  const projects = readControl(controlRoot, "projects.json");
  const sandboxKey = `sandbox-${instance.instance_id}`;
  if (request.project !== sandboxKey) fail("SANDBOX_PROJECT_REQUIRED");
  const project = projects?.projects?.[sandboxKey];
  const expectedRepository = `${instance.trusted_github_username}/chatgpt-codex-orchestrator-sandbox-${instance.instance_id}`;
  if (!project || project.enabled !== true || project.repository !== expectedRepository || project.local_path_key !== sandboxKey ||
      project.target_enabled === true || project.target_repository || !safeRef(project.default_branch) || !safeRef(project.checkpoint_branch) ||
      project.default_branch === project.checkpoint_branch || ["main", "master"].includes(project.checkpoint_branch)) fail("SANDBOX_PROJECT_REQUIRED");
  for (const [key, value] of Object.entries(projects.projects || {})) if (key !== sandboxKey && (value?.enabled === true || value?.target_enabled === true)) fail("NON_SANDBOX_PROJECT_ENABLED");
  return project;
}

function parseReview(content, request, project) {
  const text = content.toString("utf8");
  if (!text.startsWith(`${MARKER}\n`) || text.split(MARKER).length !== 2) fail("REVIEW_EVIDENCE_INVALID");
  const field = name => { const rows = [...text.matchAll(new RegExp(`^- ${name}: ([^\\n]+)$`, "gm"))]; return rows.length === 1 ? rows[0][1].trim() : null; };
  const statuses = text.match(/^Status: [A-Z_]+$/gm) || [];
  if (statuses.length !== 1 || statuses[0] !== "Status: CODE_REVIEW_COMPLETE" ||
      field("project") !== request.project || field("repository") !== project.repository || field("source_branch") !== request.source_branch ||
      field("reviewed_commit")?.toLowerCase() !== request.approved_commit.toLowerCase() || field("checkpoint_branch") !== project.checkpoint_branch) fail("REVIEW_EVIDENCE_INVALID");
  if (text.includes("CODE_REVIEW_FAILED") || text.includes("CODE_REVIEW_SKIPPED_DOCS_ONLY")) fail("CONFLICTING_REVIEW_EVIDENCE");
  return { status: "CODE_REVIEW_COMPLETE", review_file: REVIEW_FILE(request.approved_commit) };
}

function reviewBytes(repo, checkpoint, request, project) {
  const file = REVIEW_FILE(request.approved_commit);
  const result = spawnSync(gitExecutable(), ["-C", repo, "-c", "core.hooksPath=/dev/null", "show", `${checkpoint}:${file}`], { encoding: "buffer", timeout: 30000, maxBuffer: 512 * 1024 });
  if (result.error || result.status !== 0) fail("REVIEW_EVIDENCE_MISSING");
  return parseReview(result.stdout, request, project) && file;
}

/**
 * Read-only Phase B / stage 1 approval preflight. It never checks out, writes,
 * rebases, commits, pushes, dispatches callbacks, or mutates a remote.
 */
export function preflightMacosSandboxMerge({ event, controlRoot, controlRepository, trustedGithubUsername, home = process.env.HOME || os.homedir(), sandboxOrigin = null } = {}) {
  const request = parseApproval(event, controlRepository, trustedGithubUsername);
  const root = privatePath(controlRoot, { leaf: true });
  const instance = validateInstance(readControl(root, "instance.json"), controlRepository, trustedGithubUsername);
  const project = validateProjects(root, instance, request);
  const route = validateRoute(home, instance.instance_id, request.project, request.review_route);
  const instanceRoot = path.join(home, ".chatgpt-codex-orchestrator", "instances", instance.instance_id);
  const automation = privatePath(path.join(instanceRoot, "automation", project.local_path_key), { leaf: true });
  safeClone(automation, project.repository, sandboxOrigin);
  const pinned = pinnedRemoteHeads(automation, [project.default_branch, request.source_branch, project.checkpoint_branch]);
  fetchPinnedRefs(automation, pinned);
  const reconciled = pinnedRemoteHeads(automation, [project.default_branch, request.source_branch, project.checkpoint_branch]);
  for (const branch of Object.keys(pinned)) if (reconciled[branch] !== pinned[branch]) fail("REMOTE_HEAD_DRIFT");
  const defaultHead = pinned[project.default_branch];
  const sourceHead = pinned[request.source_branch];
  const checkpoint = pinned[project.checkpoint_branch];
  if (sourceHead !== request.approved_commit.toLowerCase()) fail("APPROVED_SHA_STALE");
  if (request.source_branch === project.default_branch || project.protected_branches?.includes?.(request.source_branch)) fail("PROTECTED_SOURCE_BRANCH");
  if (!ancestor(automation, defaultHead, request.approved_commit, "DEFAULT_ANCESTRY_FAILED")) fail("NON_FAST_FORWARD_SOURCE");
  const reviewFile = reviewBytes(automation, checkpoint, request, project);
  const diffCheck = spawnSync(gitExecutable(), ["-C", automation, "-c", "core.hooksPath=/dev/null", "diff", "--check", `${defaultHead}..${request.approved_commit}`], { encoding: "utf8", timeout: 30000 });
  if (diffCheck.error || diffCheck.status !== 0) fail("DIFF_CHECK_FAILED");
  return {
    approved_sha: request.approved_commit.toLowerCase(),
    remote_default_before: defaultHead,
    remote_source: sourceHead,
    checkpoint,
    review_file: reviewFile,
    route
  };
}

export const validateMergeApprovalEvent = preflightMacosSandboxMerge;
export { privatePath, privateFile, safeRef };
