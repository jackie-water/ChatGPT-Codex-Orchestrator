import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeControlEvent } from "../src/lib/control-event-normalizer.mjs";
import { prepareFailure } from "../src/lib/run-failure-state.mjs";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "control-normalizer-"));
  const control = path.join(home, "control"); fs.mkdirSync(control, { recursive: true });
  fs.writeFileSync(path.join(control, "instance.json"), JSON.stringify({ instance_id: "test-instance" }));
  fs.writeFileSync(path.join(control, "projects.json"), JSON.stringify({ projects: { demo: { repository: "jackie-water/ChatGPT-Codex-Orchestrator", enabled: true } } }));
  const route = path.join(home, ".chatgpt-codex-orchestrator/instances/test-instance"); fs.mkdirSync(route, { recursive: true });
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
