import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { callbackRecord, codexReviewArgv, ensurePendingCallback, executeMacosCodeReview, parseReviewEvidence, pendingWakesPath, publicationIntentPath, publicationIntentRecord, redactReviewOutput, reportSha256, validatePublicationIntent, validateReviewEvent, writeCheckpointEvidence, writePrivate } from "../src/lib/macos-code-review-runtime.mjs";

const sha = "9203170f74b57dade7702fb0530e994ecf531c17";
test("native Codex child argv keeps read-only isolation and disables repository instructions", () => {
  const calls = [];
  const fakeSpawn = (file, argv, options) => { calls.push({ file, argv, options }); return { status: 0, stdout: "review", stderr: "" }; };
  fakeSpawn("codex", codexReviewArgv("gpt-5.6-luna", "medium", "main"), { cwd: "/tmp/review", input: "review" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ["exec", "--ignore-user-config", "-m", "gpt-5.6-luna", "-c", "model_reasoning_effort=medium", "-c", "project_doc_max_bytes=0", "-c", "approval_policy=never", "-c", "sandbox_mode=read-only", "-c", "features.plugins=false", "-c", "features.apps=false", "-c", "features.hooks=false", "review", "--base", "origin/main"]);
});

test("native review output redacts bounded credential key-value values while preserving diagnostics", () => {
  const fakeSpawn = () => ({ status: 0, stdout: "authorization: Bearer REALISH_TOKEN api_key=FAKE_VALUE access_token: FAKE_TOKEN {\"api_key\":\"FAKE_JSON\", \"password\": \"FAKE_PASSWORD_JSON\", \"clientSecret\": \"FAKE_CLIENT_SECRET\"} OPENAI_API_KEY=FAKE_ENV TOKEN: FAKE_TOKEN_VALUE MY_PASSWORD=\"FAKE_ENV_PASSWORD\" AWS_SECRET_ACCESS_KEY=FAKE_AWS SESSION_COOKIE: FAKE_SESSION secretariat=SAFE tokenizer=SAFE apiVersion=SAFE attempt=SAFE message=SAFE ordinary diagnostic text", stderr: "password=FAKE_PASSWORD secret: FAKE_SECRET reviewed SHA 9203170f74b57dade7702fb0530e994ecf531c17; FAKE_TOKEN ordinary text" });
  const result = fakeSpawn();
  const output = redactReviewOutput(`${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(output, /FAKE_(?:VALUE|PASSWORD|SECRET|JSON|PASSWORD_JSON|ENV|ENV_PASSWORD|TOKEN_VALUE|SESSION)/);
  assert.match(output, /authorization: Bearer \[REDACTED\]/);
  assert.match(output, /api_key=\[REDACTED\]/);
  assert.match(output, /access_token: \[REDACTED\]/);
  assert.match(output, /\{\"api_key\":\[REDACTED\], \"password\": \[REDACTED\], \"clientSecret\": \[REDACTED\]\}/);
  assert.match(output, /\"clientSecret\": \[REDACTED\]/);
  assert.match(output, /OPENAI_API_KEY=\[REDACTED\]/);
  assert.match(output, /TOKEN: \[REDACTED\]/);
  assert.match(output, /MY_PASSWORD=\[REDACTED\]/);
  assert.match(output, /AWS_SECRET_ACCESS_KEY=\[REDACTED\]/);
  assert.match(output, /SESSION_COOKIE: \[REDACTED\]/);
  assert.match(output, /secretariat=SAFE tokenizer=SAFE apiVersion=SAFE attempt=SAFE message=SAFE/);
  assert.match(output, /ordinary diagnostic text/);
  assert.match(output, /FAKE_TOKEN ordinary text/);
  assert.match(output, /9203170f74b57dade7702fb0530e994ecf531c17/);
});

function fixture() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "macos-review-runtime-"));
  const home = path.join(root, "home"), control = path.join(root, "control"), instance = "fixture01";
  const instanceRoot = path.join(home, ".chatgpt-codex-orchestrator", "instances", instance);
  const automation = path.join(instanceRoot, "automation", `sandbox-${instance}`);
  fs.mkdirSync(control, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(automation), { recursive: true, mode: 0o700 });
  fs.mkdirSync(automation, { recursive: true, mode: 0o700 });
  spawnSync("git", ["-C", automation, "init", "-q"]);
  spawnSync("git", ["-C", automation, "remote", "add", "origin", `https://github.com/trusted/chatgpt-codex-orchestrator-sandbox-${instance}.git`]);
  const instanceJson = { schema_version: 1, instance_id: instance, trusted_github_username: "trusted", control_repository: "trusted/control", platform: "darwin", arch: "arm64", runner_label: "codex-orchestrator-fixture" };
  const projects = { projects: { [`sandbox-${instance}`]: { enabled: true, repository: `trusted/chatgpt-codex-orchestrator-sandbox-${instance}`, local_path_key: `sandbox-${instance}`, default_branch: "main", checkpoint_branch: "codex/checkpoints", code_review: { enabled: true, review_model: "gpt-5.6-luna", review_reasoning: "medium" } }, target: { enabled: false, repository: "trusted/target" } } };
  fs.writeFileSync(path.join(control, "instance.json"), JSON.stringify(instanceJson), { mode: 0o644 });
  fs.writeFileSync(path.join(control, "projects.json"), JSON.stringify(projects), { mode: 0o644 });
  fs.mkdirSync(instanceRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(instanceRoot, "chat-routes.json"), JSON.stringify({ routes: [{ route: "chat-303", project: `sandbox-${instance}`, chat_url: "https://chatgpt.com/g/project/c/chat-303", status: "active" }] }), { mode: 0o600 });
  const event = body => ({ repository: { full_name: "trusted/control" }, issue: { title: "[CODE-REVIEW] native adapter", number: 258, user: { login: "trusted" }, body: JSON.stringify({ project: `sandbox-${instance}`, source_branch: "feat/task", reviewed_commit: sha, review_route: "chat-303", ...body }) } });
  return { root, home, control, instanceRoot, automation, event };
}

function barePublicationFixture(report, { postPush = true } = {}) {
  const f = fixture();
  const bare = path.join(f.root, "remote.git"), source = path.join(f.root, "source");
  assert.equal(spawnSync("git", ["init", "--bare", "-q", bare]).status, 0);
  assert.equal(spawnSync("git", ["init", "-q", "-b", "fixture-init", source]).status, 0);
  const sourceGit = args => spawnSync("git", ["-C", source, ...args], { encoding: "utf8" });
  for (const args of [["config", "user.name", "fixture"], ["config", "user.email", "fixture@example.invalid"]]) assert.equal(sourceGit(args).status, 0);
  fs.writeFileSync(path.join(source, "base"), "base\n");
  assert.equal(sourceGit(["add", "base"]).status, 0); assert.equal(sourceGit(["commit", "-q", "-m", "base"]).status, 0);
  const base = sourceGit(["rev-parse", "HEAD"]).stdout.trim();
  assert.equal(sourceGit(["branch", "main", base]).status, 0);
  assert.equal(sourceGit(["branch", "feat/task", base]).status, 0);
  const bindReport = value => {
    const reviewed = value.replace(`- reviewed_commit: ${sha}`, `- reviewed_commit: ${base}`);
    return reviewed.includes("\n- checkpoint_branch:")
      ? reviewed.replace(/\n- checkpoint_branch: [^\n]+/, "\n- checkpoint_branch: codex/checkpoints")
      : reviewed.replace(/(\n\nStatus:)/, "\n- checkpoint_branch: codex/checkpoints$1");
  };
  const boundReport = bindReport(report);
  let published = base;
  if (postPush) {
    fs.mkdirSync(path.join(source, ".codex", "reviews", "by-commit"), { recursive: true });
    fs.writeFileSync(path.join(source, ".codex", "reviews", "by-commit", `${base}.md`), boundReport);
    assert.equal(sourceGit(["add", "."]).status, 0); assert.equal(sourceGit(["commit", "-q", "-m", "review"]).status, 0);
    published = sourceGit(["rev-parse", "HEAD"]).stdout.trim();
  }
  assert.equal(sourceGit(["remote", "add", "origin", bare]).status, 0);
  assert.equal(sourceGit(["push", "-q", "origin", "main", "feat/task"]).status, 0);
  assert.equal(sourceGit(["push", "-q", "origin", `${published}:refs/heads/codex/checkpoints`]).status, 0);
  const v = validateReviewEvent({ event: f.event({ reviewed_commit: base }), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  assert.equal(spawnSync("git", ["-C", f.automation, "remote", "set-url", "origin", bare]).status, 0);
  const review = { status: "CODE_REVIEW_COMPLETE", checkpoint: base, report: boundReport };
  return { ...f, v, base, published, review, source, bare };
}

function journalFor(f, review) {
  return publicationIntentRecord(f.v, review);
}

test("accepts prefix title, 0644 Control metadata, and exact Sandbox project Chat URL", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const value = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  assert.equal(value.req.review_route, "chat-303");
});

test("rejects wrong author, target enablement, route collision, repo, and untrusted path", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  assert.throws(() => validateReviewEvent({ event: { ...f.event({}), issue: { ...f.event({}).issue, user: { login: "attacker" } } }, controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /UNTRUSTED_REVIEW_AUTHOR/);
  const projects = JSON.parse(fs.readFileSync(path.join(f.control, "projects.json"), "utf8")); projects.projects.target.enabled = true; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
  assert.throws(() => validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /NON_SANDBOX_PROJECT_ENABLED/);
  projects.projects.target.enabled = false; projects.projects["sandbox-fixture01"] = { ...projects.projects["sandbox-fixture01"], local_path_key: "wrong" }; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
  assert.throws(() => validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /INVALID_AUTOMATION_PATH_KEY|TARGET_ROUTING_FORBIDDEN|AUTOMATION_CLONE_MISSING/);
  const routes = JSON.parse(fs.readFileSync(path.join(f.instanceRoot, "chat-routes.json"), "utf8")); routes.routes.push(routes.routes[0]); fs.writeFileSync(path.join(f.instanceRoot, "chat-routes.json"), JSON.stringify(routes));
  projects.projects["sandbox-fixture01"].local_path_key = "sandbox-fixture01"; fs.writeFileSync(path.join(f.control, "projects.json"), JSON.stringify(projects));
  assert.throws(() => validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /ROUTE_REGISTRY_NOT_UNIQUE/);
});

test("accepts the generated checkpoint ref and rejects malformed or protected refs before clone use", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const projectFile = path.join(f.control, "projects.json");
  const original = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }).project.checkpoint_branch, "codex/checkpoints");
  for (const checkpoint_branch of ["main", "../checkpoint", "codex//checkpoints", "codex/..", "codex/checkpoints.lock", "codex/check@{points}", "codex/check points", "/codex/checkpoints"]) {
    const next = structuredClone(original); next.projects["sandbox-fixture01"].checkpoint_branch = checkpoint_branch; fs.writeFileSync(projectFile, JSON.stringify(next));
    assert.throws(() => validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /TARGET_ROUTING_FORBIDDEN/);
  }
});

test("rejects malformed source refs while accepting ordinary feature refs", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  for (const source_branch of ["feat//x", "feat/..", "feat/x/", "feat/x.lock", "feat/x@{y}", "feat/x..y"]) {
    assert.throws(() => validateReviewEvent({ event: f.event({ source_branch }), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }), /INVALID_REVIEW_TARGET/);
  }
  assert.equal(validateReviewEvent({ event: f.event({ source_branch: "feat/ordinary-change" }), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home }).req.source_branch, "feat/ordinary-change");
});

test("checkpoint evidence writer refuses symlinked paths and never overwrites", t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "macos-review-checkpoint-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = path.join(root, "outside"); fs.mkdirSync(outside, { mode: 0o700 });
  const checkpoint = path.join(root, "worktree", ".codex", "reviews", "by-commit"); fs.mkdirSync(path.dirname(checkpoint), { recursive: true, mode: 0o700 }); fs.symlinkSync(outside, checkpoint);
  assert.throws(() => writeCheckpointEvidence(path.join(checkpoint, "report.md"), "blocked"), /SYMLINKED_PRIVATE_PATH/);
  assert.deepEqual(fs.readdirSync(outside), []);
  const trusted = path.join(root, "trusted", "by-commit", "report.md"); writeCheckpointEvidence(trusted, "first");
  assert.equal(fs.readFileSync(trusted, "utf8"), "first");
  assert.throws(() => writeCheckpointEvidence(trusted, "second"), /EEXIST/);
  assert.equal(fs.readFileSync(trusted, "utf8"), "first");
});

test("native worktree constructors use the canonical temporary root", () => {
  const publisher = fs.readFileSync(path.join(process.cwd(), "runtime/scripts/macos-code-review.mjs"), "utf8");
  const runtime = fs.readFileSync(path.join(process.cwd(), "src/lib/macos-code-review-runtime.mjs"), "utf8");
  assert.match(publisher, /mkdtempSync\(path\.join\(fs\.realpathSync\(os\.tmpdir\(\)\),\s*"codex-review-publish-"\)\)/);
  assert.match(runtime, /mkdtempSync\(path\.join\(fs\.realpathSync\(os\.tmpdir\(\)\),\s*"codex-review-"\)\)/);
});

test("actual publisher push argv disables pre-push hooks for a local bare repository", t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "macos-review-push-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bare = path.join(root, "bare.git"), source = path.join(root, "source");
  assert.equal(spawnSync("git", ["init", "--bare", "-q", bare]).status, 0);
  assert.equal(spawnSync("git", ["init", "-q", source]).status, 0);
  const git = args => spawnSync("git", ["-C", source, ...args], { encoding: "utf8" });
  assert.equal(git(["config", "user.name", "fixture"]).status, 0);
  assert.equal(git(["config", "user.email", "fixture@example.invalid"]).status, 0);
  fs.writeFileSync(path.join(source, "file"), "fixture\n");
  assert.equal(git(["add", "file"]).status, 0); assert.equal(git(["commit", "-q", "-m", "fixture"]).status, 0);
  assert.equal(git(["remote", "add", "origin", bare]).status, 0);
  const canary = path.join(root, "hook-ran"); fs.writeFileSync(path.join(source, ".git/hooks/pre-push"), `#!/bin/sh\nprintf ran > ${canary}\n`, { mode: 0o700 });
  const push = git(["-c", "core.hooksPath=/dev/null", "push", "origin", "HEAD:refs/heads/codex/checkpoints"]);
  assert.equal(push.status, 0); assert.equal(fs.existsSync(canary), false);
  const publisher = fs.readFileSync(path.join(process.cwd(), "runtime/scripts/macos-code-review.mjs"), "utf8");
  assert.match(publisher, /\["-C", workspace, "-c", "core\.hooksPath=\/dev\/null", "push", "origin"/);
});

test("checkpoint evidence permits only the root-owned sticky system temp ancestor", t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "macos-review-temp-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const safe = path.join(root, "safe", "report.md");
  writeCheckpointEvidence(safe, "safe");
  assert.equal(fs.readFileSync(safe, "utf8"), "safe");
  const writable = path.join(root, "writable"); fs.mkdirSync(writable, { mode: 0o777 }); fs.chmodSync(writable, 0o777);
  assert.throws(() => writeCheckpointEvidence(path.join(writable, "report.md"), "blocked"), /UNTRUSTED_PRIVATE_DIRECTORY/);
});

test("evidence parser requires exact immutable fields and one Status", () => {
  const base = `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n- project: sandbox-fixture01\n- repository: trusted/chatgpt-codex-orchestrator-sandbox-fixture01\n- source_branch: feat/task\n- reviewed_commit: ${sha}\n\nStatus: CODE_REVIEW_COMPLETE\n`;
  assert.equal(parseReviewEvidence(base, { project: "sandbox-fixture01", repository: "trusted/chatgpt-codex-orchestrator-sandbox-fixture01", sourceBranch: "feat/task", reviewedCommit: sha }).status, "CODE_REVIEW_COMPLETE");
  assert.equal(parseReviewEvidence(`${base}Status: CODE_REVIEW_FAILED\n`, { project: "sandbox-fixture01", repository: "trusted/chatgpt-codex-orchestrator-sandbox-fixture01", sourceBranch: "feat/task", reviewedCommit: sha }), null);
  assert.equal(parseReviewEvidence(base.replace(sha, "0".repeat(40)), { project: "sandbox-fixture01", repository: "trusted/chatgpt-codex-orchestrator-sandbox-fixture01", sourceBranch: "feat/task", reviewedCommit: sha }), null);
});

test("callback recovery preserves immutable delivery state", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const v = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  const record = callbackRecord(v, { status: "CODE_REVIEW_COMPLETE" }, "a".repeat(40));
  const file = path.join(f.instanceRoot, "pending-wakes", `${record.callback_id}.json`); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ ...record, delivery_state: "SUBMISSION_ATTEMPTED", verified_by: "not-a-receipt" }), { mode: 0o600 });
  const recovered = ensurePendingCallback(file, record);
  assert.equal(recovered.delivery_state, "SUBMISSION_ATTEMPTED");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).verified_by, "not-a-receipt");
});

test("publication intent is outside the callback-only pending-wakes directory", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const v = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  const intent = publicationIntentPath(v, sha);
  assert.notEqual(path.dirname(intent), pendingWakesPath(v));
  fs.mkdirSync(path.dirname(intent), { recursive: true, mode: 0o700 });
  fs.writeFileSync(intent, JSON.stringify({ reviewed_commit: sha, state: "PUBLISHED" }), { mode: 0o600 });
  const callback = callbackRecord(v, { status: "CODE_REVIEW_COMPLETE" }, "a".repeat(40));
  fs.mkdirSync(pendingWakesPath(v), { recursive: true, mode: 0o700 });
  ensurePendingCallback(path.join(pendingWakesPath(v), `${callback.callback_id}.json`), callback);
  assert.deepEqual(fs.readdirSync(pendingWakesPath(v)), [`${callback.callback_id}.json`]);
});

test("crash after exclusive PUBLISHING intent preserves the exact report for one resume", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const v = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  const review = { status: "CODE_REVIEW_COMPLETE", checkpoint: "a".repeat(40), report: "canonical redacted report\n" };
  const intent = publicationIntentPath(v, sha), journal = publicationIntentRecord(v, review);
  writePrivate(intent, journal, true);
  const recovered = JSON.parse(fs.readFileSync(intent, "utf8"));
  assert.equal(recovered.state, "PUBLISHING");
  assert.equal(recovered.report, review.report);
  assert.equal(recovered.report_sha256, reportSha256(review.report));
  assert.deepEqual(validatePublicationIntent(v, recovered), recovered);
});

test("crash after remote push reconciles one callback without changing the persisted report", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const v = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  const checkpoint = "b".repeat(40), review = { status: "CODE_REVIEW_COMPLETE", checkpoint, report: "published canonical report\n" };
  const intent = publicationIntentPath(v, sha), journal = { ...publicationIntentRecord(v, review), state: "PUBLISHED", checkpoint_commit: checkpoint };
  writePrivate(intent, journal, true);
  const callback = callbackRecord(v, review, checkpoint), file = path.join(pendingWakesPath(v), `${callback.callback_id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  ensurePendingCallback(file, callback);
  ensurePendingCallback(file, callback);
  assert.deepEqual(JSON.parse(fs.readFileSync(intent, "utf8")), journal);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).delivery_state, "PENDING");
});

test("isolated bare Git pre-push crash resumes the journal without rerunning Codex", async t => {
  const report = `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n- project: sandbox-fixture01\n- repository: trusted/chatgpt-codex-orchestrator-sandbox-fixture01\n- source_branch: feat/task\n- reviewed_commit: ${sha}\n\nStatus: CODE_REVIEW_COMPLETE\n`;
  const f = barePublicationFixture(report, { postPush: false }); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const journal = journalFor(f, f.review);
  let codexRuns = 0;
  const recovered = await executeMacosCodeReview(f.v, { resumeOnly: true, publicationIntent: journal, spawn: () => { codexRuns++; return { status: 0 }; } });
  assert.equal(recovered.status, "CODE_REVIEW_COMPLETE"); assert.equal(recovered.checkpoint, f.base); assert.equal(codexRuns, 0);
});

test("isolated bare Git post-push recovery preserves trailing-newline bytes and queues one callback", async t => {
  const report = `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n- project: sandbox-fixture01\n- repository: trusted/chatgpt-codex-orchestrator-sandbox-fixture01\n- source_branch: feat/task\n- reviewed_commit: ${sha}\n\nStatus: CODE_REVIEW_COMPLETE\n`;
  const f = barePublicationFixture(report); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const journal = journalFor(f, f.review); let codexRuns = 0;
  const recovered = await executeMacosCodeReview(f.v, { resumeOnly: true, publicationIntent: journal, spawn: () => { codexRuns++; return { status: 0 }; } });
  assert.equal(recovered.status, "ALREADY_EXISTS"); assert.equal(recovered.checkpoint, f.published); assert.equal(codexRuns, 0);
  const callback = callbackRecord(f.v, { status: recovered.priorStatus }, recovered.checkpoint);
  const file = path.join(pendingWakesPath(f.v), `${callback.callback_id}.json`); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  ensurePendingCallback(file, callback); ensurePendingCallback(file, callback);
  assert.equal(fs.readdirSync(pendingWakesPath(f.v)).length, 1);
});

test("isolated bare Git tampering and ambiguous checkpoint drift fail closed", async t => {
  const report = `<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->\n- project: sandbox-fixture01\n- repository: trusted/chatgpt-codex-orchestrator-sandbox-fixture01\n- source_branch: feat/task\n- reviewed_commit: ${sha}\n\nStatus: CODE_REVIEW_COMPLETE\n`;
  const f = barePublicationFixture(report); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const journal = journalFor(f, f.review);
  const tampered = `${f.review.report}tampered`;
  fs.writeFileSync(path.join(f.source, ".codex", "reviews", "by-commit", `${f.base}.md`), tampered);
  const sourceGit = args => spawnSync("git", ["-C", f.source, ...args], { encoding: "utf8" });
  assert.equal(sourceGit(["add", "."]).status, 0); assert.equal(sourceGit(["commit", "-q", "-m", "tamper"]).status, 0);
  const tamperedCommit = sourceGit(["rev-parse", "HEAD"]).stdout.trim();
  assert.equal(sourceGit(["push", "-q", "--force", "origin", `${tamperedCommit}:refs/heads/codex/checkpoints`]).status, 0);
  await assert.rejects(() => executeMacosCodeReview(f.v, { resumeOnly: true, publicationIntent: journal }), /PUBLICATION_EVIDENCE_MISMATCH/);

  const unrelated = path.join(f.root, "unrelated"); assert.equal(spawnSync("git", ["init", "-q", unrelated]).status, 0);
  const unrelatedGit = args => spawnSync("git", ["-C", unrelated, ...args], { encoding: "utf8" });
  for (const args of [["config", "user.name", "fixture"], ["config", "user.email", "fixture@example.invalid"]]) assert.equal(unrelatedGit(args).status, 0);
  fs.mkdirSync(path.join(unrelated, ".codex", "reviews", "by-commit"), { recursive: true }); fs.writeFileSync(path.join(unrelated, ".codex", "reviews", "by-commit", `${f.base}.md`), f.review.report);
  assert.equal(unrelatedGit(["add", "."]).status, 0); assert.equal(unrelatedGit(["commit", "-q", "-m", "drift"]).status, 0);
  const drift = unrelatedGit(["rev-parse", "HEAD"]).stdout.trim(); assert.equal(unrelatedGit(["remote", "add", "origin", f.bare]).status, 0);
  assert.equal(unrelatedGit(["push", "-q", "--force", "origin", `${drift}:refs/heads/codex/checkpoints`]).status, 0);
  await assert.rejects(() => executeMacosCodeReview(f.v, { resumeOnly: true, publicationIntent: journal }), /PUBLICATION_EVIDENCE_MISMATCH/);
});

test("same SHA resume is idempotent and tampered or drifted journals fail closed", t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const v = validateReviewEvent({ event: f.event({}), controlRoot: f.control, controlRepository: "trusted/control", trustedGithubUsername: "trusted", home: f.home });
  const journal = publicationIntentRecord(v, { status: "CODE_REVIEW_FAILED", checkpoint: "c".repeat(40), report: "failure report\n" });
  assert.equal(validatePublicationIntent(v, journal).report_sha256, validatePublicationIntent(v, structuredClone(journal)).report_sha256);
  assert.throws(() => validatePublicationIntent(v, { ...journal, report: "tampered\n" }), /INVALID_PUBLICATION_INTENT/);
  assert.equal(validatePublicationIntent(v, { ...journal, checkpoint_before: "d".repeat(40) }).checkpoint_before, "d".repeat(40));
  assert.equal(journal.review_status, "CODE_REVIEW_FAILED");
});
