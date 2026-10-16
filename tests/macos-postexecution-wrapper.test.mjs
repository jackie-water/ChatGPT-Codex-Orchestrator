import nodeTest from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { planMacosCodexRun, getValidatedMacosCodexPlan } from "../src/lib/macos-codex-run-contract.mjs";
import { executeMacosCodexRun } from "../src/lib/macos-codex-execution.mjs";
import { finalizeMacosCodexRun } from "../src/lib/macos-postexecution-wrapper.mjs";
import { deliverCallback } from "../runtime/scripts/callback-delivery.mjs";

// This POSIX process-group controller is native macOS work. Windows keeps its
// own unchanged implementation and never runs these native-controller cases.
const test = (name, options, fn) => typeof options === "function"
  ? nodeTest(name, { skip: process.platform === "win32" }, options)
  : nodeTest(name, { ...options, skip: process.platform === "win32" || options.skip }, fn);

const realSync = childProcess.spawnSync;
const realSpawn = childProcess.spawn;
const realKill = process.kill;
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function localGit(repo, ...args) {
  const result = realSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function fixture({ validator = "console.log('validator ok');", checkpoint = "codex/checkpoints" } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "macos-finalize-")));
  const home = path.join(root, "home"), control = path.join(root, "control"), bare = path.join(root, "remote.git");
  fs.mkdirSync(home, 0o700); fs.mkdirSync(control, 0o700);
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
  process.env.HOME = home;
  const base = path.join(home, ".chatgpt-codex-orchestrator", "instances", "postexec-test");
  const automation = path.join(base, "automation"), repo = path.join(automation, "repo");
  fs.mkdirSync(automation, { recursive: true, mode: 0o700 });
  write(path.join(control, "instance.json"), { instance_id: "postexec-test" });
  const script = path.join(root, "validator.mjs"); fs.writeFileSync(script, validator, { mode: 0o600 });
  write(path.join(control, "projects.json"), { projects: { demo: { enabled: true, repository: "fake-owner/fake-project", default_branch: "main", checkpoint_branch: checkpoint,
    allowed_validation_executables: ["node"], default_validation_steps: [{ name: "focused validation", command: "node", arguments: [script] }] } } });
  write(path.join(base, "chat-routes.json"), { routes: [{ project: "demo", route: "chat-212", status: "active", chat_url: "https://chatgpt.com/c/chat-212" }] });
  localGit(root, "init", "--bare", bare);
  const seed = path.join(root, "seed"); localGit(root, "clone", bare, seed);
  localGit(seed, "config", "user.name", "Fixture"); localGit(seed, "config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(seed, "README"), "base\n"); localGit(seed, "add", "."); localGit(seed, "commit", "-m", "base");
  const initial = localGit(seed, "rev-parse", "HEAD");
  localGit(seed, "push", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/codex/checkpoints");
  localGit(bare, "symbolic-ref", "HEAD", "refs/heads/main"); localGit(automation, "clone", bare, repo);
  localGit(repo, "checkout", "-b", "feat/task");
  localGit(repo, "config", "remote.origin.url", "https://github.com/fake-owner/fake-project.git");
  const event = { repository: { full_name: "fake-control/private" }, issue: { title: "[CODEX-RUN] demo", number: 222, user: { login: "trusted" },
    body: JSON.stringify({ project: "demo", iteration: 1, max_iterations: 5, review_route: "chat-212", target_branch: "feat/task", prompt: "Implement the isolated task" }) } };
  const plan = () => planMacosCodexRun({ event, controlRoot: control, controlRepository: "fake-control/private", trustedGithubUsername: ["trusted"] });
  const planned = plan(), snapshot = getValidatedMacosCodexPlan(planned);
  const ledgerDir = path.join(base, "macos-execution-ledger"); fs.mkdirSync(ledgerDir, 0o700);
  const ledgerFile = path.join(ledgerDir, "demo-222-1.json");
  const ledger = { version: 1, execution_state: "EXECUTED_UNVALIDATED", instance_id: "postexec-test", project: "demo", issue: 222, iteration: 1,
    authorization_digest: snapshot.authorization_digest, repo_path: repo, observed_branch: "feat/task", observed_repository: "fake-owner/fake-project",
    observed_head: initial, observed_remote_default: initial, post_execution_head: initial, exit_code: 0, validation_state: "NOT_RUN" };
  write(ledgerFile, ledger); fs.writeFileSync(path.join(repo, "README"), "task\n");
  const stateFile = path.join(base, "macos-finalization", "demo-222-1.json");
  return { root, home, control, base, bare, seed, repo, initial, event, plan, planned, ledger, ledgerFile, stateFile, script };
}
function verbOf(args) {
  let at = args.indexOf("-C") + 2;
  while (args[at] === "-c") at += 2;
  return args[at];
}
// Only the three transport boundaries are substituted. All object, diff,
// index, branch and commit operations use real Git against temporary repos.
// Stored origin URLs remain GitHub-shaped, and no network call can escape.
function fakeTransport(f) {
  const calls = [];
  let hook;
  childProcess.spawnSync = (bin, args, options) => {
    assert.equal(path.basename(bin), "git");
    const verb = verbOf(args), call = { bin, args: [...args], options, verb };
    calls.push(call);
    const transport = ["ls-remote", "fetch", "push"].includes(verb);
    const run = () => realSync(bin, transport ? args.map(arg => arg === "origin" ? f.bare : arg) : args, options);
    if (transport) assert.ok(args.includes("origin"), "all network operations target the verified origin");
    const result = hook?.(call, run);
    return result === undefined ? run() : result;
  };
  return { calls, setHook(fn) { hook = fn; } };
}
async function isolated(options, fn) {
  const oldEnv = { ...process.env }, oldRename = fs.renameSync;
  let f;
  try { f = fixture(options); const transport = fakeTransport(f); await fn(f, transport); }
  finally {
    childProcess.spawnSync = realSync; childProcess.spawn = realSpawn; process.kill = realKill; fs.renameSync = oldRename;
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(oldEnv, key)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    if (f) fs.rmSync(f.root, { recursive: true, force: true });
  }
}
const finalize = (f, extra = {}) => finalizeMacosCodexRun({ planned: f.planned, repoPath: f.repo, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000, ...extra });
const mutations = calls => calls.filter(c => ["add", "commit", "fetch", "push", "read-tree", "update-index", "write-tree", "commit-tree", "hash-object"].includes(c.verb));
function failure(f, result, source = null) {
  assert.notEqual(result.state, "READY_FOR_REVIEW");
  assert.equal(result.failure.source_commit, source);
  assert.equal(result.failure.chat_url, "https://chatgpt.com/c/chat-212");
  assert.equal(result.failure.routing_version, "explicit-route-v1");
  assert.equal(result.failure.delivery_state, "PENDING");
  assert.deepEqual(read(path.join(f.base, "failure-outbox", "failure-demo-222-1.json")), result.failure);
  assert.equal(fs.existsSync(path.join(f.base, "pending-wakes")), false);
}

test("first publication stages with dedicated author, preserves ledger/branch, and publishes exact coordinates", { skip: process.platform === "win32" }, async () => {
  await isolated({}, async (f, transport) => {
    const input = fs.readFileSync(f.ledgerFile);
    const result = await finalize(f);
    assert.equal(result.state, "READY_FOR_REVIEW", JSON.stringify(result));
    assert.equal(result.validation_state, "PASSED"); assert.equal(result.callback_state, "PENDING");
    assert.match(result.source_commit, /^[0-9a-f]{40}$/); assert.notEqual(result.source_commit, f.initial);
    assert.equal(localGit(f.repo, "log", "-1", "--format=%an <%ae>"), "Codex Orchestrator <codex-orchestrator@users.noreply.github.com>");
    assert.equal(localGit(f.repo, "branch", "--show-current"), "feat/task"); assert.equal(localGit(f.repo, "status", "--porcelain"), "");
    assert.deepEqual(fs.readFileSync(f.ledgerFile), input); assert.deepEqual(result.changed_files, ["README"]);
    assert.equal(localGit(f.bare, "rev-parse", "refs/heads/main"), f.initial);
    assert.equal(localGit(f.bare, "rev-parse", "refs/heads/feat/task"), result.source_commit);
    assert.equal(localGit(f.bare, "rev-parse", "refs/heads/codex/checkpoints"), result.checkpoint_commit);
    assert.equal(result.checkpoint_path, `.codex/runs/by-issue/222/iteration-1__${result.source_commit.slice(0, 12)}.md`);
    const report = localGit(f.bare, "show", `${result.checkpoint_commit}:${result.checkpoint_path}`);
    assert.ok(report.includes(result.source_commit)); assert.match(report, /validation: PASSED/); assert.match(report, /validator ok/);
    const cb = read(path.join(f.base, "pending-wakes", `${result.callback_id}.json`));
    assert.equal(cb.chat_url, "https://chatgpt.com/c/chat-212"); assert.equal(cb.delivery_state, "PENDING");
    assert.match(cb.message, /^\[CODEX-AUTO callback_id=/); assert.ok(cb.message.includes(`checkpoint_commit=${result.checkpoint_commit} path=${result.checkpoint_path}`));
    assert.ok(cb.message.includes(result.source_commit));
    assert.equal(transport.calls.filter(c => c.verb === "push").length, 2);
    for (const c of transport.calls) { assert.equal(c.options.shell, false); assert.equal(c.args.some(a => ["--force", "--force-with-lease", "reset", "clean", "rebase", "merge"].includes(a)), false); }
  });
});

test("missing, nonexecuted, mismatched, and unbound ledgers stop before any Git call", async () => {
  for (const change of [null, { execution_state: "CLAIMED" }, { execution_state: "READY_FOR_REVIEW" }, { project: "other" }, { issue: 223 }, { iteration: 2 },
    { issue: "222" }, { instance_id: "other" }, { exit_code: 7 }, { validation_state: "PASSED" }, { authorization_digest: "0".repeat(64) },
    { observed_repository: "attacker/repo" }, { observed_branch: "main" }, { observed_head: "bad" }, { post_execution_head: "bad" }]) {
    await isolated({}, async (f, transport) => {
      if (change === null) fs.unlinkSync(f.ledgerFile); else write(f.ledgerFile, { ...f.ledger, ...change });
      const result = await finalize(f); failure(f, result);
      assert.equal(transport.calls.length, 0); assert.equal(localGit(f.repo, "rev-parse", "HEAD"), f.initial);
      assert.equal(fs.readFileSync(path.join(f.repo, "README"), "utf8"), "task\n");
    });
  }
});

test("immutable plan ignores caller mutation; reauthorization of changed config/event is rejected", async () => {
  await isolated({}, async (f) => {
    f.planned.plan.repository = "attacker/repo"; f.planned.plan.target_branch = "main"; f.planned.plan.checkpoint_branch = "main";
    f.planned.plan.validation_steps = [{ name: "evil", command: "sh", arguments: ["-c", "false"] }];
    const result = await finalize(f); assert.equal(result.state, "READY_FOR_REVIEW");
    assert.equal(localGit(f.bare, "rev-parse", "refs/heads/main"), f.initial);
  });
  for (const kind of ["event", "configuration", "route"]) await isolated({}, async (f, transport) => {
    if (kind === "event") { const b = JSON.parse(f.event.issue.body); b.prompt = "changed authority"; f.event.issue.body = JSON.stringify(b); }
    if (kind === "configuration") { const p = read(path.join(f.control, "projects.json")); p.projects.demo.default_validation_steps = []; write(path.join(f.control, "projects.json"), p); }
    if (kind === "route") write(path.join(f.base, "chat-routes.json"), { routes: [{ project: "demo", route: "chat-212", status: "active", chat_url: "https://chatgpt.com/c/other" }] });
    const result = await finalize(f, { planned: f.plan() });
    assert.equal(result.state, "UNKNOWN"); assert.equal(transport.calls.length, 0);
    assert.equal(result.failure.code, "EXECUTION_LEDGER_UNAUTHORIZED");
  });
});

test("final clone symlink, ancestor symlink, foreign clone, gitdir indirection and symlinked ledger reject writes", async () => {
  for (const kind of ["leaf", "ancestor", "foreign", "gitdir", "ledger"]) await isolated({}, async (f, transport) => {
    let repoPath = f.repo;
    if (kind === "leaf") { const moved = path.join(f.root, "moved"); fs.renameSync(f.repo, moved); fs.symlinkSync(moved, f.repo); }
    if (kind === "ancestor") { const old = path.dirname(f.repo), moved = path.join(f.root, "moved"); fs.renameSync(old, moved); fs.symlinkSync(moved, old); }
    if (kind === "foreign") repoPath = f.seed;
    if (kind === "gitdir") { const dir = path.join(f.repo, ".git"), moved = path.join(f.root, "meta"); fs.renameSync(dir, moved); fs.writeFileSync(dir, `gitdir: ${moved}\n`); }
    if (kind === "ledger") { const moved = path.join(f.root, "ledger.json"); fs.renameSync(f.ledgerFile, moved); fs.symlinkSync(moved, f.ledgerFile); }
    const result = await finalize(f, { repoPath }); failure(f, result); assert.equal(transport.calls.length, 0);
  });
});

test("fetch/push URL mismatch, multiple URLs, protected checkpoint and switched task branch fail before mutation", async () => {
  for (const kind of ["fetch", "push", "multiple-fetch", "multiple-push", "branch"]) await isolated({}, async (f, transport) => {
    if (kind === "fetch") localGit(f.repo, "config", "remote.origin.url", "https://github.com/attacker/repo.git");
    if (kind === "push") localGit(f.repo, "config", "remote.origin.pushurl", "https://github.com/attacker/repo.git");
    if (kind === "multiple-fetch") localGit(f.repo, "config", "--add", "remote.origin.url", "git@github.com:fake-owner/fake-project.git");
    if (kind === "multiple-push") { localGit(f.repo, "config", "--add", "remote.origin.pushurl", "https://github.com/fake-owner/fake-project.git"); localGit(f.repo, "config", "--add", "remote.origin.pushurl", "git@github.com:fake-owner/fake-project.git"); }
    if (kind === "branch") localGit(f.repo, "checkout", "main");
    const result = await finalize(f); failure(f, result); assert.equal(mutations(transport.calls).length, 0);
  });
  for (const checkpoint of ["main", "master", "feat/task", "codex/a..b", "codex/x.lock", undefined]) await isolated({ checkpoint }, async (f, transport) => {
    // undefined is explicitly removed since the fixture normally supplies it.
    if (checkpoint === undefined) { const p = read(path.join(f.control, "projects.json")); delete p.projects.demo.checkpoint_branch; write(path.join(f.control, "projects.json"), p); f.planned = f.plan(); f.ledger.authorization_digest = getValidatedMacosCodexPlan(f.planned).authorization_digest; write(f.ledgerFile, f.ledger); }
    const result = await finalize(f); failure(f, result); assert.equal(transport.calls.length, 0);
  });
});

test("executor supplies the clone and authorization link; finalizer accepts only its completed ledger", { skip: process.platform === "win32" }, async () => {
  await isolated({}, async (f) => {
    fs.unlinkSync(f.ledgerFile); fs.writeFileSync(path.join(f.repo, "README"), "base\n");
    const fakeCodex = path.join(f.root, "fake-codex");
    fs.writeFileSync(fakeCodex, "#!/bin/sh\ncat >/dev/null\nprintf 'from fake codex\\n' > README\n", { mode: 0o700 });
    const executed = await executeMacosCodexRun({ planned: f.planned, repoPath: f.repo, codexExecutable: fakeCodex, controlRoot: f.control, trustedGithubUsername: ["trusted"], timeoutMs: 5000 });
    assert.equal(executed.execution_state, "EXECUTED_UNVALIDATED");
    assert.equal(executed.authorization_digest, getValidatedMacosCodexPlan(f.planned).authorization_digest); assert.equal(executed.repo_path, f.repo);
    const result = await finalize(f); assert.equal(result.state, "READY_FOR_REVIEW", JSON.stringify(result));
  });
});

test("pre-SHA, diff-integrity, validation exit and validator tree/SHA/ledger/branch drift never publish success", async () => {
  const cases = [
    ["pre-sha", "console.log('unused');"], ["diff", "console.log('unused');"], ["exit", "process.exit(7);"],
    ["tree", "import fs from 'node:fs'; fs.writeFileSync('generated', 'leave this evidence');"],
    ["sha", "import {execFileSync} from 'node:child_process'; execFileSync('git', ['-c','user.name=Validator','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','drift']);"],
    ["branch", "import {execFileSync} from 'node:child_process'; execFileSync('git', ['checkout','-b','feat/drift']);"],
    ["ledger", "import fs from 'node:fs'; fs.appendFileSync(process.env.FAKE_LEDGER, ' ');"],
  ];
  for (const [kind, validator] of cases) await isolated({ validator }, async (f, transport) => {
    process.env.FAKE_LEDGER = f.ledgerFile;
    if (kind === "pre-sha") { localGit(f.repo, "-c", "user.name=Other", "-c", "user.email=fake@example.invalid", "commit", "--allow-empty", "-m", "unauthorized head"); }
    if (kind === "diff") fs.writeFileSync(path.join(f.repo, "README"), "trailing whitespace  \n");
    const result = await finalize(f), sha = read(f.stateFile).source_commit || null;
    failure(f, result, sha); assert.equal(transport.calls.filter(c => ["fetch", "push"].includes(c.verb)).length, 0);
    if (kind === "exit") { assert.equal(result.state, "VALIDATED_FAILURE"); assert.equal(result.validation_state, "FAILED"); }
    if (kind === "tree") assert.equal(fs.readFileSync(path.join(f.repo, "generated"), "utf8"), "leave this evidence");
    if (kind === "sha") assert.notEqual(localGit(f.repo, "rev-parse", "HEAD"), sha);
  });
});

test("validation runs exact argv without shell and report outputs are bounded and redacted", async () => {
  await isolated({ validator: "console.log('ghp_fakeSECRET123456789 bearer secretvalue123456 api_key=hiddenvalue123456'); console.log('x'.repeat(50000));" }, async (f) => {
    const calls = [];
    childProcess.spawn = (bin, args, options) => { calls.push({ bin, args, options }); return realSpawn(bin, args, options); };
    const result = await finalize(f); assert.equal(result.state, "READY_FOR_REVIEW");
    assert.equal(calls.length, 2); assert.deepEqual(calls[1].args, [f.script]);
    for (const call of calls) { assert.equal(call.options.shell, false); assert.equal(call.options.detached, true); }
    const output = result.validation[1].output;
    assert.ok(output.length <= 8192); assert.match(output, /REDACTED/); assert.doesNotMatch(output, /fakeSECRET|secretvalue|hiddenvalue/);
    assert.doesNotMatch(localGit(f.bare, "show", `${result.checkpoint_commit}:${result.checkpoint_path}`), /fakeSECRET|secretvalue|hiddenvalue/);
  });
});

test("fast-forward existing branches work; diverged remote is retained and fails closed", async () => {
  for (const diverged of [false, true]) await isolated({}, async (f, transport) => {
    let head = f.initial;
    if (diverged) { fs.writeFileSync(path.join(f.seed, "other"), "remote change\n"); localGit(f.seed, "add", "."); localGit(f.seed, "commit", "-m", "remote task"); head = localGit(f.seed, "rev-parse", "HEAD"); }
    localGit(f.seed, "push", "origin", `${head}:refs/heads/feat/task`);
    const result = await finalize(f);
    if (diverged) { failure(f, result, result.source_commit); assert.equal(result.failure.code, "SOURCE_REMOTE_DIVERGED"); assert.equal(localGit(f.bare, "rev-parse", "refs/heads/feat/task"), head); assert.equal(transport.calls.filter(c => c.verb === "push").length, 0); }
    else assert.equal(result.state, "READY_FOR_REVIEW");
  });
});

test("clean and already-committed Codex output retain the exact source SHA without another commit", async () => {
  for (const committed of [false, true]) await isolated({}, async (f, transport) => {
    if (committed) {
      localGit(f.repo, "add", "README"); localGit(f.repo, "-c", "user.name=Fake Codex", "-c", "user.email=fake@example.invalid", "commit", "-m", "already implemented");
    } else fs.writeFileSync(path.join(f.repo, "README"), "base\n");
    const expected = localGit(f.repo, "rev-parse", "HEAD");
    write(f.ledgerFile, { ...f.ledger, post_execution_head: expected });
    const result = await finalize(f); assert.equal(result.state, "READY_FOR_REVIEW", JSON.stringify(result));
    assert.equal(result.source_commit, expected); assert.equal(transport.calls.some(c => c.verb === "commit"), false);
    assert.equal(localGit(f.repo, "rev-parse", "HEAD"), expected);
  });
});

test("remote movement and checkpoint content/publication mismatch cannot queue success", async () => {
  for (const kind of ["source-race", "checkpoint-race", "checkpoint-content", "source-after-push"]) await isolated({}, async (f, transport) => {
    let taskQueries = 0, checkpointQueries = 0, checkpointPush = false, sourcePush = false;
    transport.setHook((call, run) => {
      if (call.verb === "push") {
        if (call.args.at(-1).endsWith(":refs/heads/codex/checkpoints")) checkpointPush = true;
        else sourcePush = true;
      }
      if (call.verb === "ls-remote" && call.args.at(-1) === "refs/heads/feat/task") {
        taskQueries++;
        if ((kind === "source-race" && taskQueries === 2) || (kind === "source-after-push" && sourcePush)) return { status: 0, stdout: `${f.initial}\trefs/heads/feat/task\n`, stderr: "" };
      }
      if (call.verb === "ls-remote" && call.args.at(-1) === "refs/heads/codex/checkpoints") {
        checkpointQueries++;
        if (kind === "checkpoint-race" && checkpointPush) return { status: 0, stdout: `${f.initial}\trefs/heads/codex/checkpoints\n`, stderr: "" };
      }
      if (kind === "checkpoint-content" && call.verb === "show" && call.args.at(-1).includes(":.codex/runs/")) return { status: 0, stdout: "substituted evidence\n", stderr: "" };
    });
    const result = await finalize(f); failure(f, result, result.source_commit);
    if (kind === "source-race") assert.equal(transport.calls.some(c => c.verb === "push"), false);
    if (kind === "checkpoint-content") assert.equal(checkpointPush, false);
    if (kind === "checkpoint-race") assert.ok(checkpointQueries > 1);
  });
});

test("ambiguous source/checkpoint pushes are queried once and never blindly repeated", async () => {
  for (const branch of ["feat/task", "codex/checkpoints"]) for (const accepted of [true, false]) await isolated({}, async (f, transport) => {
    let attempts = 0;
    transport.setHook((call, run) => {
      if (call.verb === "push" && call.args.at(-1).endsWith(`:refs/heads/${branch}`)) {
        attempts++; if (accepted) assert.equal(run().status, 0);
        return { status: null, error: Object.assign(new Error("secret=not-for-report"), { code: "ETIMEDOUT" }), stdout: "", stderr: "" };
      }
    });
    const result = await finalize(f);
    assert.equal(attempts, 1);
    if (accepted) assert.equal(result.state, "READY_FOR_REVIEW", JSON.stringify(result));
    else { failure(f, result, result.source_commit); const again = await finalize(f); assert.equal(again.state, "UNKNOWN"); assert.equal(attempts, 1); }
    const push = transport.calls.findIndex(c => c.verb === "push" && c.args.at(-1).endsWith(`:refs/heads/${branch}`));
    assert.ok(transport.calls.slice(push + 1).some(c => c.verb === "ls-remote" && c.args.at(-1) === `refs/heads/${branch}`));
  });
});

test("conflicting immutable iteration reports are never overwritten or sent as latest", async () => {
  await isolated({}, async (f, transport) => {
    localGit(f.seed, "checkout", "-b", "codex/checkpoints");
    const rel = ".codex/runs/by-issue/222/iteration-1__111111111111.md";
    fs.mkdirSync(path.dirname(path.join(f.seed, rel)), { recursive: true }); fs.writeFileSync(path.join(f.seed, rel), "immutable conflicting report\n");
    localGit(f.seed, "add", "."); localGit(f.seed, "commit", "-m", "existing evidence"); localGit(f.seed, "push", "origin", "HEAD:refs/heads/codex/checkpoints");
    const checkpoint = localGit(f.bare, "rev-parse", "refs/heads/codex/checkpoints");
    const result = await finalize(f); failure(f, result, result.source_commit);
    assert.equal(result.failure.code, "CHECKPOINT_ITERATION_CONFLICT"); assert.equal(localGit(f.bare, "rev-parse", "refs/heads/codex/checkpoints"), checkpoint);
    assert.equal(localGit(f.bare, "show", `${checkpoint}:${rel}`), "immutable conflicting report");
    assert.equal(transport.calls.filter(c => c.verb === "push" && c.args.at(-1).endsWith(":refs/heads/codex/checkpoints")).length, 0);
  });
});

test("same-path content conflicts and a missing checkpoint branch cannot publish readiness", async () => {
  for (const missing of [false, true]) await isolated({}, async (f, transport) => {
    if (missing) localGit(f.bare, "update-ref", "-d", "refs/heads/codex/checkpoints");
    else transport.setHook((call, run) => {
      if (call.verb === "push" && call.args.at(-1).endsWith(":refs/heads/feat/task")) {
        const result = run(), sha = call.args.at(-1).split(":")[0];
        const file = path.join(f.seed, `.codex/runs/by-issue/222/iteration-1__${sha.slice(0, 12)}.md`);
        localGit(f.seed, "checkout", "-b", "codex/checkpoints"); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "conflicting bytes\n");
        localGit(f.seed, "add", "."); localGit(f.seed, "commit", "-m", "conflict"); localGit(f.seed, "push", "origin", "HEAD:refs/heads/codex/checkpoints");
        return result;
      }
    });
    const result = await finalize(f); failure(f, result, result.source_commit);
    assert.equal(result.failure.code, missing ? "CHECKPOINT_BRANCH_MISSING" : "CHECKPOINT_CONTENT_MISMATCH");
    assert.equal(transport.calls.filter(c => c.verb === "push" && c.args.at(-1).endsWith(":refs/heads/codex/checkpoints")).length, 0);
  });
});

test("callback replay preserves SUBMISSION_ATTEMPTED; only existing receipt logic can deliver", async () => {
  await isolated({}, async (f, transport) => {
    const result = await finalize(f); assert.equal(result.state, "READY_FOR_REVIEW");
    const file = path.join(f.base, "pending-wakes", `${result.callback_id}.json`), record = read(file);
    write(file, { ...record, delivery_state: "SUBMISSION_ATTEMPTED" }); const before = fs.readFileSync(file);
    const count = mutations(transport.calls).length;
    const replay = await finalize(f); assert.equal(replay.callback_state, "SUBMISSION_ATTEMPTED"); assert.equal(mutations(transport.calls).length, count);
    assert.deepEqual(fs.readFileSync(file), before);
    let sends = 0;
    const delivered = await deliverCallback({ read: () => read(file), hasReceipt: async () => false, send: async () => { sends++; }, update: () => assert.fail("no receipt") });
    assert.equal(delivered.state, "SUBMISSION_ATTEMPTED"); assert.equal(sends, 0);
    await deliverCallback({ read: () => read(file), hasReceipt: async () => true, send: async () => { sends++; }, update: (state, extra) => write(file, { ...read(file), delivery_state: state, ...extra }) });
    assert.equal((await finalize(f)).callback_state, "DELIVERED"); assert.equal(sends, 0);
  });
});

test("callback identity conflicts and unverified DELIVERED records fail closed", async () => {
  for (const patch of [{ chat_url: "https://chatgpt.com/c/foreign" }, { delivery_state: "DELIVERED", verified_by: "draft-text" }, { checkpoint_path: ".codex/latest-run.md" }]) await isolated({}, async (f, transport) => {
    const result = await finalize(f), file = path.join(f.base, "pending-wakes", `${result.callback_id}.json`);
    assert.equal(result.state, "READY_FOR_REVIEW"); write(file, { ...read(file), ...patch }); const before = fs.readFileSync(file);
    const count = mutations(transport.calls).length;
    const replay = await finalize(f); assert.equal(replay.state, "UNKNOWN"); assert.equal(replay.failure.delivery_state, "PENDING");
    assert.deepEqual(fs.readFileSync(file), before); assert.equal(mutations(transport.calls).length, count);
  });
});

test("a disappeared completed callback is uncertain and cannot be recreated as PENDING", async () => {
  await isolated({}, async (f, transport) => {
    const result = await finalize(f); assert.equal(result.state, "READY_FOR_REVIEW");
    const file = path.join(f.base, "pending-wakes", `${result.callback_id}.json`);
    write(file, { ...read(file), delivery_state: "SUBMISSION_ATTEMPTED" }); fs.unlinkSync(file);
    const count = mutations(transport.calls).length;
    const replay = await finalize(f); assert.equal(replay.state, "UNKNOWN"); assert.equal(replay.failure.code, "CALLBACK_RECORD_MISSING");
    assert.equal(fs.existsSync(file), false); assert.equal(mutations(transport.calls).length, count);
  });
});

test("queue failure retains published intent; recovery queues once without a second validator/push", async () => {
  await isolated({}, async (f, transport) => {
    const link = fs.linkSync; let block = true;
    fs.linkSync = (from, to) => { if (block && path.dirname(to) === path.join(f.base, "pending-wakes")) throw Object.assign(new Error("secret=queue-storage"), { code: "ENOSPC" }); return link(from, to); };
    try {
      const result = await finalize(f); assert.equal(result.state, "UNKNOWN"); assert.equal(read(f.stateFile).phase, "PUBLISHED");
      assert.match(result.checkpoint_commit, /^[0-9a-f]{40}$/); const count = mutations(transport.calls).length;
      block = false;
      const recovered = await finalize(f); assert.equal(recovered.state, "READY_FOR_REVIEW"); assert.equal(recovered.callback_state, "PENDING");
      assert.equal(mutations(transport.calls).length, count); assert.equal(fs.readdirSync(path.join(f.base, "pending-wakes")).length, 1);
    } finally { fs.linkSync = link; }
  });
});

test("publication persists intent before callback queue and storage failure cannot report readiness", async () => {
  await isolated({}, async (f) => {
    const rename = fs.renameSync; let blocked = true;
    fs.renameSync = (from, to) => {
      if (blocked && to === f.stateFile && read(from).phase === "COMPLETE") throw Object.assign(new Error("secret=storage"), { code: "ENOSPC" });
      return rename(from, to);
    };
    const result = await finalize(f); assert.equal(result.state, "UNKNOWN"); assert.equal(result.failure.delivery_state, "PENDING");
    assert.equal(localGit(f.bare, "rev-parse", "refs/heads/codex/checkpoints"), result.checkpoint_commit);
    assert.equal(read(path.join(f.base, "pending-wakes", `${result.callback_id}.json`)).delivery_state, "PENDING");
    blocked = false;
  });
});

test("concurrent claim and interrupted intents cannot execute validators or repeat mutations", async () => {
  await isolated({}, async (f, transport) => {
    const dir = path.dirname(f.stateFile); fs.mkdirSync(dir, { mode: 0o700 });
    write(path.join(dir, "demo-222-1.lock"), { pid: process.pid });
    await assert.rejects(() => finalize(f), { code: "FINALIZATION_BUSY" }); assert.equal(transport.calls.length, 0);
  });
  await isolated({}, async (f, transport) => {
    fs.mkdirSync(path.dirname(f.stateFile), { mode: 0o700 });
    write(f.stateFile, { version: 1, project: "demo", issue: 222, iteration: 1, repo_path: f.repo,
      authorization_digest: getValidatedMacosCodexPlan(f.planned).authorization_digest, ledger_digest: hash(fs.readFileSync(f.ledgerFile)), phase: "VALIDATING" });
    const result = await finalize(f); failure(f, result); assert.equal(result.failure.code, "FINALIZATION_INTERRUPTED"); assert.equal(mutations(transport.calls).length, 0);
  });
});

test("validator timeout kills its entire private group before settlement", { skip: process.platform === "win32", timeout: 12000 }, async () => {
  await isolated({ validator: `import fs from 'node:fs'; import {spawn} from 'node:child_process';
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => require('fs').writeFileSync('late-output', 'bad'), 3500); setInterval(() => {}, 1000);"], {stdio:'ignore'});
fs.writeFileSync(process.env.FAKE_GROUP, JSON.stringify({pid:process.pid, child:child.pid}));
process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);` }, async (f, transport) => {
    const groupFile = path.join(f.root, "group.json"); process.env.FAKE_GROUP = groupFile;
    const signals = [];
    process.kill = (pid, signal) => { if (fs.existsSync(groupFile) && pid === -read(groupFile).pid) signals.push({ pid, signal }); return realKill(pid, signal); };
    const result = await finalize(f, { timeoutMs: 1200 });
    failure(f, result, result.source_commit);
    const group = read(groupFile); assert.ok(signals.length); assert.ok(signals.every(s => s.pid === -group.pid));
    assert.ok(signals.some(s => s.signal === "SIGTERM")); assert.ok(signals.some(s => s.signal === "SIGKILL"));
    if (result.state === "VALIDATED_FAILURE") assert.throws(() => realKill(-group.pid, 0), { code: "ESRCH" });
    else assert.equal(result.failure.code, "VALIDATOR_TERMINATION_UNVERIFIED");
    assert.equal(transport.calls.some(c => c.verb === "push"), false);
    await new Promise(resolve => setTimeout(resolve, 3600)); assert.equal(fs.existsSync(path.join(f.repo, "late-output")), false);
  });
});

test("validator parent close reconciles background descendants before source validation", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  await isolated({ validator: `import fs from 'node:fs'; import {spawn} from 'node:child_process';
const child = spawn(process.execPath, ['-e', "setTimeout(() => require('fs').writeFileSync('late-output', 'bad'), 2500); setInterval(() => {}, 1000);"], {stdio:'ignore'});
fs.writeFileSync(process.env.FAKE_GROUP, JSON.stringify({pid:process.pid, child:child.pid})); process.exit(0);` }, async (f) => {
    const groupFile = path.join(f.root, "group"); process.env.FAKE_GROUP = groupFile;
    const result = await finalize(f);
    if (result.state === "READY_FOR_REVIEW") { assert.equal(result.validation[1].termination_verified, true); assert.throws(() => realKill(-read(groupFile).pid, 0), { code: "ESRCH" }); }
    else { assert.equal(result.state, "UNKNOWN"); assert.equal(result.failure.code, "VALIDATOR_TERMINATION_UNVERIFIED"); }
    await new Promise(resolve => setTimeout(resolve, 2600)); assert.equal(fs.existsSync(path.join(f.repo, "late-output")), false);
  });
});

test("denied signals and uncertain group probes persist source-aware UNKNOWN with no secret diagnostics", { skip: process.platform === "win32", timeout: 15000 }, async () => {
  for (const deny of ["SIGTERM", "SIGKILL", "probe"]) await isolated({ validator: `import fs from 'node:fs'; fs.writeFileSync(process.env.FAKE_GROUP, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);` }, async (f, transport) => {
    const groupFile = path.join(f.root, "group"); process.env.FAKE_GROUP = groupFile;
    let group, killed = false;
    process.kill = (pid, signal) => {
      if (!fs.existsSync(groupFile)) return realKill(pid, signal);
      group = Number(fs.readFileSync(groupFile, "utf8"));
      if (pid !== -group) return realKill(pid, signal);
      if (signal === deny || (deny === "probe" && killed && signal === 0)) throw Object.assign(new Error("secret=termination_DIAGNOSTIC_123456"), { code: "EPERM" });
      if (signal === "SIGKILL") killed = true;
      return realKill(pid, signal);
    };
    try {
      const result = await finalize(f, { timeoutMs: 1000 }); failure(f, result, result.source_commit);
      assert.equal(result.state, "UNKNOWN"); assert.equal(result.failure.code, "VALIDATOR_TERMINATION_UNVERIFIED");
      assert.equal(result.validation_state, "UNKNOWN"); assert.equal(transport.calls.some(c => c.verb === "push"), false);
      assert.doesNotMatch(fs.readFileSync(f.stateFile, "utf8"), /termination_DIAGNOSTIC/);
    } finally { if (group) { try { realKill(-group, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; } } }
  });
});
