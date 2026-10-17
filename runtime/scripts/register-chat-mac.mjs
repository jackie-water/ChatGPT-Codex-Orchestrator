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
function signedIssueNumber(run) {
  const candidates = [run.issue_number, run.issueNumber, run.event_payload?.issue?.number, run.eventPayload?.issue?.number];
  const match = candidates.find(value => Number.isInteger(Number(value)) && Number(value) > 0);
  return match === undefined ? null : Number(match);
}
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
    if (checked.items.length > checked.total) fail("Actions run page exceeds total_count; native intake refuses the race");
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

function allRunners(repo) {
  const all = [];
  const seen = new Set();
  let expectedTotal = null;
  for (let page = 1; page <= ACTION_MAX_PAGES; page++) {
    const payload = gh(["api", `repos/${repo}/actions/runners?per_page=${ACTION_PAGE_SIZE}&page=${page}`]);
    if (!payload || !Array.isArray(payload.runners) || !Number.isInteger(Number(payload.total_count)) || Number(payload.total_count) < 0 || payload.runners.length > ACTION_PAGE_SIZE) fail("Actions runner evidence is unreadable; native intake refuses the race");
    const total = Number(payload.total_count);
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) fail("Actions runner evidence changed while paging; native intake refuses the race");
    if (payload.runners.length > total) fail("Actions runner page exceeds total_count; native intake refuses the race");
    for (const runner of payload.runners) {
      if (!runner || !Number.isInteger(Number(runner.id)) || Number(runner.id) < 1 || seen.has(Number(runner.id))) fail("Actions runner page has missing or duplicate identity; native intake refuses the race");
      if (!['online', 'offline'].includes(String(runner.status || '').toLowerCase())) fail("Actions runner page has unknown status; native intake refuses the race");
      if (!Array.isArray(runner.labels) || !runner.labels.length || runner.labels.some(label => !label || typeof label.name !== 'string' || !label.name)) fail("Actions runner page has missing or malformed labels; native intake refuses the race");
      seen.add(Number(runner.id));
      all.push(runner);
    }
    if (all.length >= expectedTotal) return all;
    if (!payload.runners.length) fail("Actions runner pagination ended before total_count; native intake refuses the race");
  }
  fail("Actions runner pagination exceeded the bounded evidence window; native intake refuses the race");
}

function reconcileQueuedRegistration(repo, issue, instance) {
  const runs = allIssueRuns(repo);
  const relevant = runs.filter(run => active(run) && isIssueRun(run) && /orchestrator|register-chat/i.test(`${run.name || ""} ${run.workflow_name || run.workflowName || ""} ${run.path || ""}`));
  const signedIssueTitleConflicts = relevant.filter(run => signedIssueNumber(run) === issue.number && !isRegistrationRun(run, issue));
  if (signedIssueTitleConflicts.length) fail("An active Control Actions run has the same signed Issue number with a different title; registration refused without claiming or cancelling the run");
  const sameTitle = relevant.filter(run => isRegistrationRun(run, issue));
  const exact = sameTitle.filter(run => signedIssueNumber(run) === issue.number);
  const unproven = sameTitle.filter(run => signedIssueNumber(run) === null);
  const foreignIssue = sameTitle.filter(run => signedIssueNumber(run) !== null && signedIssueNumber(run) !== issue.number);
  const unrelated = relevant.filter(run => !isRegistrationRun(run, issue) && signedIssueNumber(run) !== issue.number).concat(foreignIssue);
  if (unrelated.length) fail("Unexpected queued or active Control Actions run exists; registration refused without cancelling unrelated work");
  const runners = allRunners(repo);
  const expectedLabel = `codex-orchestrator-${instance.instance_id}`;
  if (instance.runner_label && instance.runner_label !== expectedLabel) fail("Configured Control runner label is not the exact instance-scoped label");
  const scoped = runners.filter(r => (r.labels || []).some(label => label.name === expectedLabel));
  if (scoped.some(r => (r.labels || []).filter(label => label.name === expectedLabel).length !== 1 || (r.labels || []).some(label => label.name.startsWith("codex-orchestrator-") && label.name !== expectedLabel))) fail("Actions runner has an ambiguous instance-scoped label; native intake refuses the race");
  if (scoped.some(r => String(r.status).toLowerCase() !== "offline")) fail("The configured Control runner is not proven offline; native intake refuses the race");
  if (runners.length && !scoped.length) fail("Actions runner inventory has no exact instance-scoped label; native intake refuses the race");
  const online = scoped.filter(r => String(r.status).toLowerCase() === "online");
  if (online.length) fail("The configured Control runner is online; native intake refuses the race");
  if (!exact.length && !unproven.length) return "CONTROL_QUEUE_CLEAR";
  const exactIds = exact.map(run => run.id || run.databaseId).filter(id => Number.isInteger(Number(id)) && Number(id) > 0);
  const unprovenIds = unproven.map(run => run.id || run.databaseId).filter(id => Number.isInteger(Number(id)) && Number(id) > 0);
  if (exactIds.length !== exact.length || unprovenIds.length !== unproven.length) fail("Matching Actions run has no stable run ID; native intake refuses the race");
  for (const run of [...exact, ...unproven]) {
    const status = String(run.status || "").toLowerCase();
    if (!["queued", "waiting", "requested", "pending"].includes(status)) fail(`Registration Actions run is ${run.status}; native intake refuses the race`);
  }
  const messages = [];
  if (exactIds.length) messages.push(`CONTROL_QUEUE_UNRESOLVED run_id=${exactIds.join(",")} instruction="An authorized human must inspect this exact Issue-owned queued registration run and explicitly decide cancellation or migration; native intake performed no GitHub mutation."`);
  if (unprovenIds.length) messages.push(`CONTROL_QUEUE_UNPROVEN_CANDIDATE run_id=${unprovenIds.join(",")} warning="Legacy Actions metadata has no signed Issue number. Human reconciliation is required; native intake does not claim queue ownership or cancellation and does not block this local route on the title match."`);
  return messages.join(" ");
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
    const child = spawnSync(process.execPath, childArgs, {env:process.env, encoding:"utf8"});
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    const body = JSON.parse(String(issue.body || "{}"));
    const callbackFile = path.join(os.homedir(), ".chatgpt-codex-orchestrator", "instances", instance.instance_id, "pending-wakes", `chat-register-${String(body.project || "").toLowerCase()}-${identity.number}.json`);
    let delivery = null;
    try { delivery = JSON.parse(fs.readFileSync(callbackFile, "utf8")); } catch {}
    if (child.status !== 0 || !delivery?.delivery_state) {
      fail("Local persistent registration intake failed or returned an untrusted delivery record");
    }
    const trustedProof = delivery?.verified_by === "committed-user-turn" || delivery?.verified_by === "existing-user-message";
    if (delivery.delivery_state === "DELIVERED" && !trustedProof) fail("Local DELIVERED callback record lacks trusted user-role proof");
    if (args.deliver && delivery.delivery_state !== "DELIVERED") {
      const deliverChild = spawnSync(process.execPath, [...childArgs, "--deliver"], {env:process.env, encoding:"utf8"});
      if (deliverChild.stdout) process.stdout.write(deliverChild.stdout);
      if (deliverChild.stderr) process.stderr.write(deliverChild.stderr);
      if (deliverChild.status !== 0) process.exitCode = 3;
      try { delivery = JSON.parse(fs.readFileSync(callbackFile, "utf8")); } catch {}
    }
    const finalTrustedProof = delivery?.verified_by === "committed-user-turn" || delivery?.verified_by === "existing-user-message";
    if (delivery?.delivery_state === "DELIVERED" && finalTrustedProof) console.log(`MAC_NATIVE_REGISTRATION_OK issue=${identity.number} action_reconciliation=${action} delivery_state=DELIVERED`);
    else if (delivery?.delivery_state === "DELIVERED") fail("Local DELIVERED callback record lacks trusted user-role proof");
    else console.log(`MAC_NATIVE_REGISTRATION_PENDING issue=${identity.number} action_reconciliation=${action} delivery_state=${delivery?.delivery_state}`);
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
}
try { main(); } catch (error) { console.error(`REGISTER_CHAT_MAC_FAILED: ${error.message}`); process.exitCode = 1; }
