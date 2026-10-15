import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeControlEvent, writeNormalizedOutput } from "../src/lib/control-event-normalizer.mjs";
import { prepareFailure } from "../src/lib/run-failure-state.mjs";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "control-normalizer-"));
  const control = path.join(home, "control"); fs.mkdirSync(control, { recursive: true });
  fs.writeFileSync(path.join(control, "instance.json"), JSON.stringify({ instance_id: "test-instance" }));
  fs.writeFileSync(path.join(control, "projects.json"), JSON.stringify({ projects: { demo: { repository: "jackie-water/ChatGPT-Codex-Orchestrator", enabled: true } } }));
  const route = path.join(home, ".chatgpt-codex-orchestrator/instances/test-instance"); fs.mkdirSync(route, { recursive: true }); fs.chmodSync(route, 0o700);
  fs.writeFileSync(path.join(route, "chat-routes.json"), JSON.stringify({ version: 1, routes: [{ project: "demo", route: "chat-165", chat_url: "https://chatgpt.com/c/abc", status: "active" }] }));
  const event = { repository: { full_name: "jackie-water/control-private" }, issue: { number: 7, title: "[CODEX-RUN] native adapter", user: { login: "jackie" }, body: JSON.stringify({ project: "demo", iteration: 1, review_route: "chat-165" }) } };
  return { home, control, event };
}

test("trusted Control event normalizes to an accepted P1 failure context", () => {
  const x = fixture(); const old = process.env.HOME; process.env.HOME = x.home;
  try {
    const normalized = normalizeControlEvent({ event: x.event, controlRoot: x.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["jackie"] });
    assert.equal(normalized.event.repository.full_name, "jackie-water/ChatGPT-Codex-Orchestrator");
    assert.equal(normalized.context.control_provenance.repository, "jackie-water/control-private");
    assert.equal(prepareFailure({ event: normalized.event, controlRoot: x.control, trustedGithubUsername: ["jackie"], stage: "preflight", code: "GIT_FAILED" }).failure.repository, "jackie-water/ChatGPT-Codex-Orchestrator");
  } finally { process.env.HOME = old; fs.rmSync(x.home, { recursive: true, force: true }); }
});

test("Control origin, target, author, route, and symlink changes are rejected", () => {
  const x = fixture(); const base = { controlRoot: x.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["jackie"] };
  assert.throws(() => normalizeControlEvent({ ...base, event: { ...x.event, repository: { full_name: "attacker/control" } } }), /Control event repository/);
  assert.throws(() => normalizeControlEvent({ ...base, event: { ...x.event, issue: { ...x.event.issue, user: { login: "attacker" } } } }), /Untrusted/);
  const target = JSON.parse(x.event.issue.body); target.target_repo = "attacker/repo";
  assert.throws(() => normalizeControlEvent({ ...base, event: { ...x.event, issue: { ...x.event.issue, body: JSON.stringify(target) } } }), /Target repository/);
  const route = path.join(x.home, "routes-link"); fs.symlinkSync(path.join(x.home, ".chatgpt-codex-orchestrator"), route);
  assert.throws(() => normalizeControlEvent({ ...base, event: x.event, controlRoot: route }), /symlink/i);
  fs.rmSync(x.home, { recursive: true, force: true });
});

test("normalizer rejects chat_url injection and string trusted users", () => {
  const x = fixture(); const old = process.env.HOME; process.env.HOME = x.home;
  try {
    const base = { controlRoot: x.control, controlRepository: "jackie-water/control-private" };
    assert.throws(() => normalizeControlEvent({ ...base, event: x.event, trustedGithubUsername: "jackie" }), /nonempty array/);
    const body = JSON.parse(x.event.issue.body); body.chat_url = "https://chatgpt.com/c/attacker";
    assert.throws(() => normalizeControlEvent({ ...base, trustedGithubUsername: ["jackie"], event: { ...x.event, issue: { ...x.event.issue, body: JSON.stringify(body) } } }), /chat_url/);
    const normalized = normalizeControlEvent({ ...base, trustedGithubUsername: ["jackie"], event: x.event });
    assert.deepEqual(Object.keys(normalized.event.repository), ["full_name"]);
    assert.equal(normalized.event.repository.id, undefined);
    assert.equal(normalized.event.repository.html_url, undefined);
  } finally { process.env.HOME = old; fs.rmSync(x.home, { recursive: true, force: true }); }
});

test("normalized output is private, idempotent, conflict-safe, and confined", () => {
  const x = fixture(); const old = process.env.HOME; process.env.HOME = x.home;
  try {
    const value = normalizeControlEvent({ event: x.event, controlRoot: x.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["jackie"] });
    const dir = path.join(x.home, ".chatgpt-codex-orchestrator/instances/test-instance/normalized-control-events");
    const file = path.join(dir, "event.json"); writeNormalizedOutput(file, value, { controlRoot: x.control });
    const before = fs.readFileSync(file); writeNormalizedOutput(file, value, { controlRoot: x.control }); assert.deepEqual(fs.readFileSync(file), before);
    fs.writeFileSync(file, "{}"); fs.chmodSync(file, 0o600); assert.throws(() => writeNormalizedOutput(file, value, { controlRoot: x.control }), /Conflicting/); assert.equal(fs.readFileSync(file, "utf8"), "{}");
    assert.throws(() => writeNormalizedOutput(path.join(x.home, "outside.json"), value, { controlRoot: x.control }), /inside/);
  } finally { process.env.HOME = old; fs.rmSync(x.home, { recursive: true, force: true }); }
});

test("normalized output refuses insecure or symlink parents without mutation", () => {
  const x = fixture(); const old = process.env.HOME; process.env.HOME = x.home;
  try {
    const value = normalizeControlEvent({ event: x.event, controlRoot: x.control, controlRepository: "jackie-water/control-private", trustedGithubUsername: ["jackie"] });
    const instanceDir = path.join(x.home, ".chatgpt-codex-orchestrator/instances/test-instance");
    const dir = path.join(instanceDir, "normalized-control-events"); fs.mkdirSync(dir); fs.chmodSync(dir, 0o755);
    const file = path.join(dir, "event.json"); fs.writeFileSync(file, "preserve"); fs.chmodSync(file, 0o600);
    assert.throws(() => writeNormalizedOutput(file, value, { controlRoot: x.control }), /not private/);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o755); assert.equal(fs.readFileSync(file, "utf8"), "preserve");
    fs.rmSync(dir, { recursive: true }); fs.symlinkSync(instanceDir, dir);
    assert.throws(() => writeNormalizedOutput(path.join(dir, "event.json"), value, { controlRoot: x.control }), /symlink|inside/i);
    assert.equal(fs.lstatSync(dir).isSymbolicLink(), true);
  } finally { process.env.HOME = old; fs.rmSync(x.home, { recursive: true, force: true }); }
});
