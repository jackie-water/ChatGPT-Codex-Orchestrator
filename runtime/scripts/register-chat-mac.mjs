#!/usr/bin/env node
/*
 * Offline-safe native intake for one already-created CHAT-REGISTER issue.
 * This intentionally never dispatches, reruns, or installs a GitHub runner.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACTION_PAGE_SIZE = 100;
const ACTION_MAX_PAGES = 25;
const RUN_ISSUE_WINDOW_MS = 15 * 60 * 1000;
const usage = "Usage: register-chat-mac.mjs --control-repository OWNER/REPO --trusted-github-username USER (--issue-number N | --issue-url URL) [--deliver]";
const fail = message => { throw new Error(message); };

function parseArgs() {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === "--deliver") { out.deliver = true; continue; }
    if (!["--control-repository", "--trusted-github-username", "--issue-number", "--issue-url"].includes(key)) fail(usage);
    const value = process.argv[++i];
    if (!value || value.startsWith("--")) fail(usage);
    out[key.slice(2).replaceAll("-", "_")] = value;
  }
  if (!REPO.test(out.control_repository || "") || !out.trusted_github_username ||
      (!!out.issue_number === !!out.issue_url) || (out.issue_number && !/^\d+$/.test(out.issue_number))) fail(usage);
  return out;
}

function gh(args) {
  const executable = process.env.CODEX_GH_EXECUTABLE || "gh";
  const result = spawnSync(executable, args, {encoding:"utf8", maxBuffer:8 * 1024 * 1024});
  if (result.error || result.status !== 0) fail(`Authenticated gh evidence unavailable: ${(result.stderr || result.error?.message || "gh failed").trim()}`);
  try { return JSON.parse(result.stdout.replace(/^\uFEFF/, "")); }
  catch { fail(`Authenticated gh returned non-JSON evidence for ${args.join(" ")}`); }
}

function ghMutation(args) {
  const executable = process.env.CODEX_GH_EXECUTABLE || "gh";
  const result = spawnSync(executable, args, {encoding:"utf8", maxBuffer:8 * 1024 * 1024});
  if (result.error || result.status !== 0) fail(`Authenticated gh mutation failed: ${(result.stderr || result.error?.message || "gh failed").trim()}`);
}

function issueNumberAndRepo(args) {
  if (args.issue_number) return {number:Number(args.issue_number), url:null};
  let match;
  try { match = new URL(args.issue_url); } catch { fail("--issue-url must be an exact GitHub issue URL"); }
  const parts = match.pathname.split("/").filter(Boolean);
  if (match.origin !== "https://github.com" || parts.length !== 4 || parts[2] !== "issues" || !/^\d+$/.test(parts[3]) || match.search || match.hash) fail("--issue-url must be an exact GitHub issue URL");
  const repo = `${parts[0]}/${parts[1]}`;
  if (repo.toLowerCase() !== args.control_repository.toLowerCase()) fail("Issue URL is not in the exact Control repository");
  return {number:Number(parts[3]), url:args.issue_url.replace(/\/$/, "")};
}

function decodeContents(value, name) {
  if (!value || value.type !== "file" || typeof value.content !== "string" || value.encoding !== "base64") fail(`Private Control ${name} metadata is incomplete`);
  try { return JSON.parse(Buffer.from(value.content.replace(/\s/g, ""), "base64").toString("utf8")); }
  catch { fail(`Private Control ${name} metadata is not valid JSON`); }
}

function activeRunTitle(run) {
  return typeof run.display_title === "string" ? run.display_title : typeof run.displayTitle === "string" ? run.displayTitle : null;
}
function isIssueRun(run) { return String(run.event || "").toLowerCase() === "issues"; }
function isRegistrationRun(run, issue) {
  const title = activeRunTitle(run);
  const exactTitle = title !== null && title === issue.title;
  const workflow = `${run.name || ""} ${run.workflow_name || run.workflowName || ""} ${run.path || ""}`.toLowerCase();
  return isIssueRun(run) && exactTitle && /orchestrator|register-chat/.test(workflow) && /register-chat|orchestrator/.test(workflow);
}
function active(run) { return !["completed", "cancelled", "success", "failure"].includes(String(run.status || "").toLowerCase()); }

function assertCompletePage(payload, label) {
  if (!payload || !Array.isArray(payload.workflow_runs) || !Number.isInteger(Number(payload.total_count)) || Number(payload.total_count) < 0 || payload.workflow_runs.length > ACTION_PAGE_SIZE) fail(`${label} page evidence is unreadable; native intake refuses the race`);
  return {total:Number(payload.total_count), items:payload.workflow_runs};
}

function allIssueRuns(repo) {
  const all = [];
  const seen = new Set();
  let expectedTotal = null;
  for (let page = 1; page <= ACTION_MAX_PAGES; page++) {
    const checked = assertCompletePage(gh(["api", `repos/${repo}/actions/runs?event=issues&per_page=${ACTION_PAGE_SIZE}&page=${page}`]), "Actions run");
    if (expectedTotal === null) expectedTotal = checked.total;
    if (checked.total !== expectedTotal) fail("Actions run evidence changed while paging; native intake refuses the race");
    for (const run of checked.items) {
      if (!run || !Number.isInteger(Number(run.id)) || Number(run.id) < 1 || seen.has(Number(run.id))) fail("Actions run page has missing or duplicate identity; native intake refuses the race");
      seen.add(Number(run.id));
      all.push(run);
    }
    if (all.length >= expectedTotal) return all;
    if (!checked.items.length) fail("Actions run pagination ended before total_count; native intake refuses the race");
  }
  fail("Actions run pagination exceeded the bounded evidence window; native intake refuses the race");
}

function registrationJob(repo, run) {
  const payload = gh(["api", `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`]);
  if (!payload || !Array.isArray(payload.jobs) || !Number.isInteger(Number(payload.total_count)) || Number(payload.total_count) < 0 || Number(payload.total_count) !== payload.jobs.length) fail("Actions job evidence is paginated or incomplete; native intake refuses to cancel");
  const jobs = payload.jobs;
  const matches = jobs.filter(job => job.name === "register-chat");
  if (matches.length !== 1 || jobs.some(job => job.name !== "register-chat" && !["skipped", "completed"].includes(String(job.status || "").toLowerCase()))) fail("Exact registration job binding is unavailable; native intake refuses to cancel");
  return matches[0];
}

function reconcileQueuedRegistration(repo, issue, instance) {
  const runs = allIssueRuns(repo);
  const relevant = runs.filter(run => active(run) && isIssueRun(run) && /orchestrator|register-chat/i.test(`${run.name || ""} ${run.workflow_name || run.workflowName || ""} ${run.path || ""}`));
  const sameTitle = relevant.filter(run => isRegistrationRun(run, issue));
  if (sameTitle.length > 1) fail("Multiple active registration Actions runs share this Issue title; native intake refuses the race");
  if (sameTitle.length === 1) {
    const issueCreated = Date.parse(issue.created_at || "");
    const runCreated = Date.parse(sameTitle[0].created_at || "");
    if (!Number.isFinite(issueCreated) || !Number.isFinite(runCreated) || runCreated < issueCreated || runCreated - issueCreated > RUN_ISSUE_WINDOW_MS) fail("Registration Actions run lacks a unique bounded creation-time binding to this Issue");
  }
  const target = sameTitle;
  const unrelated = relevant.filter(run => !isRegistrationRun(run, issue));
  if (unrelated.length) fail("Unexpected queued or active Control Actions run exists; registration refused without cancelling unrelated work");
  if (target.length > 1) fail("Multiple active registration Actions runs match this Issue; registration refused as an unknown race");
  const runnersPayload = gh(["api", `repos/${repo}/actions/runners?per_page=100`]);
  const online = (runnersPayload.runners || []).filter(r => r.status === "online" && (instance.runner_label ? (r.labels || []).some(label => label.name === instance.runner_label) : (r.labels || []).some(label => label.name === "self-hosted")));
  if (online.length) fail("The configured Control runner is online; native intake refuses the race");
  if (!target.length) return "NO_MATCHING_ACTIVE_RUN";
  const run = target[0];
  const status = String(run.status || "").toLowerCase();
  if (!["queued", "waiting", "requested", "pending"].includes(status)) fail(`Registration Actions run is ${run.status}; native intake refuses the race`);
  const id = run.id || run.databaseId;
  if (!id) fail("Matching queued Actions run has no stable run ID");
  if (!run.id) fail("Matching queued Actions run lacks the canonical GitHub run ID");
  registrationJob(repo, run);
  ghMutation(["api", "--method", "POST", `repos/${repo}/actions/runs/${id}/cancel`]);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const after = gh(["api", `repos/${repo}/actions/runs/${id}`]);
    if (String(after.status || "").toLowerCase() === "completed" && String(after.conclusion || "").toLowerCase() === "cancelled") return `CANCELLED_RUN_${id}`;
    if (!["queued", "waiting", "requested", "pending", "in_progress"].includes(String(after.status || "").toLowerCase())) fail("Actions cancellation reached an unknown state");
  }
  fail("Actions cancellation could not be verified within the bounded reconciliation window");
}

function main() {
  const args = parseArgs();
  const identity = issueNumberAndRepo(args);
  const repo = args.control_repository;
  const viewer = gh(["api", "user"]);
  const repoEvidence = gh(["api", `repos/${repo}`]);
  if (viewer.login !== args.trusted_github_username || !repoEvidence.private || String(repoEvidence.full_name || "").toLowerCase() !== repo.toLowerCase() || repoEvidence.owner?.login !== viewer.login) fail("Authenticated gh identity is not the exact private Control repository owner");
  const issue = gh(["api", `repos/${repo}/issues/${identity.number}`]);
  if (Number(issue.number) !== identity.number || String(issue.html_url || "").replace(/\/$/, "") !== (identity.url || `https://github.com/${repo}/issues/${identity.number}`) || (issue.repository?.full_name && issue.repository.full_name.toLowerCase() !== repo.toLowerCase()) || issue.state !== "open" || !issue.created_at) fail("Exact open registration Issue evidence is required");
  if (!String(issue.title || "").startsWith("[CHAT-REGISTER]")) fail("Exact Issue is not a CHAT-REGISTER Issue");
  if (!issue.user?.login || issue.user.login !== args.trusted_github_username) fail("Registration Issue author is not the trusted GitHub user");
  const instance = decodeContents(gh(["api", `repos/${repo}/contents/instance.json`]), "instance.json");
  const projects = decodeContents(gh(["api", `repos/${repo}/contents/projects.json`]), "projects.json");
  const expectedRepoName = `chatgpt-codex-orchestrator-control-${instance.instance_id || ""}`;
  if (!ID.test(instance.instance_id || "") || repoEvidence.name !== expectedRepoName || (instance.control_repository && instance.control_repository.toLowerCase() !== repo.toLowerCase()) || (instance.trusted_github_username && instance.trusted_github_username !== args.trusted_github_username) || viewer.login !== issue.user.login || !projects.projects || typeof projects.projects !== "object") fail("Private Control metadata does not match the generated Control identity");
  const action = reconcileQueuedRegistration(repo, issue, instance);
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "codex-native-chat-register-"));
  try {
    fs.writeFileSync(path.join(temp, "instance.json"), JSON.stringify(instance));
    fs.writeFileSync(path.join(temp, "projects.json"), JSON.stringify(projects));
    const event = {issue:{number:identity.number, user:{login:issue.user.login}, body:String(issue.body || "")}};
    const eventPath = path.join(temp, "issue.json"); fs.writeFileSync(eventPath, JSON.stringify(event));
    const childArgs = [fileURLToPath(new URL("./register-chat.mjs", import.meta.url)), "--event-path", eventPath, "--control-root", temp, "--trusted-github-username", args.trusted_github_username];
    if (args.deliver) childArgs.push("--deliver");
    const child = spawnSync(process.execPath, childArgs, {env:process.env, encoding:"utf8"});
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    const body = JSON.parse(String(issue.body || "{}"));
    const callbackFile = path.join(os.homedir(), ".chatgpt-codex-orchestrator", "instances", instance.instance_id, "pending-wakes", `chat-register-${String(body.project || "").toLowerCase()}-${identity.number}.json`);
    let delivery = null;
    try { delivery = JSON.parse(fs.readFileSync(callbackFile, "utf8")); } catch {}
    const trustedProof = delivery?.verified_by === "committed-user-turn" || delivery?.verified_by === "existing-user-message";
    if (child.status === 0 && delivery?.delivery_state === "DELIVERED" && trustedProof) {
      console.log(`MAC_NATIVE_REGISTRATION_OK issue=${identity.number} action_reconciliation=${action} delivery_state=DELIVERED`);
    } else if (delivery?.delivery_state && delivery.delivery_state !== "DELIVERED" && (child.status === 0 || args.deliver)) {
      console.log(`MAC_NATIVE_REGISTRATION_PENDING issue=${identity.number} action_reconciliation=${action} delivery_state=${delivery.delivery_state}`);
      if (args.deliver) process.exitCode = 3;
    } else {
      fail("Local persistent registration intake failed or returned an untrusted delivery record");
    }
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
}
try { main(); } catch (error) { console.error(`REGISTER_CHAT_MAC_FAILED: ${error.message}`); process.exitCode = 1; }
