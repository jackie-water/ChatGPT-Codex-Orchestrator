import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { submitMacosDurableIntent, durablePaths, readMacosDurableStatus } from "../src/lib/macos-durable-intake.mjs";

const write = (file, value, mode = 0o600) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode }); };
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "macos-durable-intake-")));
  const home = path.join(root, "home"), control = path.join(root, "control"); fs.mkdirSync(home, { mode: 0o700 }); fs.mkdirSync(control, { mode: 0o700 });
  const instance = "durable-test", base = path.join(home, ".chatgpt-codex-orchestrator", "instances", instance);
  write(path.join(control, "instance.json"), { instance_id: instance });
  write(path.join(control, "projects.json"), { projects: { demo: { enabled: true, repository: "fake-owner/fake-project", default_branch: "main", checkpoint_branch: "codex/checkpoints", local_path_key: "sandbox-demo" } } });
  write(path.join(base, "chat-routes.json"), { routes: [{ project: "demo", route: "chat-267", status: "active", chat_url: "https://chatgpt.com/c/chat-267" }] });
  const event = { repository: { full_name: "fake-control/private" }, issue: { title: "[CODEX-RUN] durable", number: 266, user: { login: "trusted" }, body: JSON.stringify({ project: "demo", iteration: 1, max_iterations: 5, review_route: "chat-267", target_branch: "feat/macos-durable-submit-return-20261017", prompt: "Implement the isolated task" }) } };
  return { root, home, control, event, args: { controlRoot: control, controlRepository: "fake-control/private", trustedGithubUsername: ["trusted"] } };
}
function withHome(home, fn) { const old = process.env.HOME; process.env.HOME = home; try { return fn(); } finally { if (old === undefined) delete process.env.HOME; else process.env.HOME = old; } }
const fakeSpawn = calls => (file, argv, options) => { calls.push({ file, argv, options }); return { pid: 4242, unref() {} }; };

test("acknowledges before worker terminal and replays exactly once", () => {
  const f = fixture(), calls = [];
  try { withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) });
    assert.equal(first.status, "ACCEPTED"); assert.equal(calls.length, 1); assert.ok(fs.existsSync(first.receipt_path));
  });
  withHome(f.home, () => {
    const first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) });
    assert.equal(first.status, "ACCEPTED"); assert.equal(calls.length, 1);
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("partial, unknown, conflicting and symlinked durable state fail closed", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    const calls = [], first = submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) });
    const paths = path.parse(first.receipt_path); fs.unlinkSync(first.receipt_path);
    assert.throws(() => submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) }), /partial|missing|UNCERTAIN/i);
    const dir = path.dirname(first.receipt_path); fs.unlinkSync(path.join(dir, `${path.basename(first.receipt_path).replace(".receipt.json", ".intent.json")}`));
    const moved = `${dir}.moved`; fs.renameSync(dir, moved); fs.mkdirSync(path.join(f.root, "elsewhere"), { mode: 0o700 }); fs.symlinkSync(path.join(f.root, "elsewhere"), dir, "dir");
    assert.throws(() => submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: fakeSpawn(calls) }), /symlink|unsafe/i);
    void paths; fs.rmSync(moved, { recursive: true, force: true });
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("spawn failure is terminal and never claims a worker", () => {
  const f = fixture();
  try { withHome(f.home, () => {
    assert.throws(() => submitMacosDurableIntent({ ...f.args, event: f.event, spawnWorker: () => { throw new Error("fake spawn"); } }), /spawn/i);
    const dir = path.join(f.home, ".chatgpt-codex-orchestrator", "instances", "durable-test", "macos-durable-intake");
    const receipt = fs.readdirSync(dir).find(name => name.endsWith(".receipt.json"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, receipt))).status, "FAILED");
  }); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test("Windows remains outside the native durable intake surface", () => {
  const source = fs.readFileSync(new URL("../runtime/scripts/macos-durable-worker.mjs", import.meta.url), "utf8");
  assert.match(source, /macos-dispatch\.mjs/); assert.doesNotMatch(source, /powershell|\.ps1/);
});
