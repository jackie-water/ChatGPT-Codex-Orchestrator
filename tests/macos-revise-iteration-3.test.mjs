import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = fs.readFileSync("src/cli.mjs", "utf8");
const env = fs.readFileSync("src/lib/control-env.mjs", "utf8");
const dispatch = fs.readFileSync("runtime/scripts/macos-dispatch.mjs", "utf8");

test("macOS setup creates before exact generated-repository confirmation", () => {
  const start = cli.indexOf('if(process.platform==="darwin")');
  const section = cli.slice(start, cli.indexOf("  state.installation_id ||= crypto.randomUUID();", start) + 1000);
  assert.ok(section.indexOf("if(!state.github_plugin_authorized)") < section.indexOf("prepareControlEnvironment"));
  assert.doesNotMatch(section.slice(0, section.indexOf("prepareControlEnvironment")), /github_plugin_authorization_verified!==true/);
});

test("generated Sandbox is instance-scoped and dirty clones are never overwritten", () => {
  assert.match(env, /instances\",short,\"automation\",sandboxProjectKey/);
  assert.match(env, /inspectExistingClone\(sandboxClonePath,"Sandbox"\)/);
  assert.match(env, /inspectExistingClone\(paths\.control,"Control"\)/);
});

test("macOS dispatcher binds the enabled Sandbox to its configured private repository", () => {
  assert.match(dispatch, /project\.repository!==planned\.plan\.repository/);
  assert.match(dispatch, /config\",\"--get-all\",\"remote\.origin\.url/);
  assert.match(dispatch, /config\",\"--get-all\",\"remote\.origin\.pushurl/);
  assert.match(dispatch, /fetch and effective push URLs do not exactly match/);
  assert.match(dispatch, /Sandbox fetch and effective push URLs do not exactly match the private configured repository/);
});

test("Darwin CLI records exact post-creation GitHub authorization without inferring a Sandbox route", { skip: process.platform !== "darwin" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-p3-cli-"));
  const stateFile = path.join(root, "install-state.json");
  const chatUrl = "https://chatgpt.com/g/project/c/6ad1852c-b7a4-83ec-aeab-6b83a28ea58f";
  const base = {
    schema_version: 1, preferred_language: "en", completed: [], installation_id: "install-226",
    reviewer_chat_url: chatUrl, control_environment_ready: true,
    control_repository: "trusted/control-226", sandbox_repository: "trusted/sandbox-226"
  };
  fs.writeFileSync(stateFile, JSON.stringify(base));
  const run = args => spawnSync(process.execPath, ["src/cli.mjs", "answer", "--json", ...args], {
    cwd: process.cwd(), env: { ...process.env, CHATGPT_CODEX_ORCHESTRATOR_HOME: root }, encoding: "utf8"
  });
  const rejected = args => assert.notEqual(run(args).status, 0);
  rejected(["--action", "generated_repo_authorization", "--value", "true"]);
  rejected(["--action", "generated_repo_authorization", "--control-repository", "evil/control", "--sandbox-repository", base.sandbox_repository, "--chat-url", chatUrl]);
  rejected(["--action", "generated_repo_authorization", "--control-repository", base.control_repository, "--sandbox-repository", "evil/sandbox", "--chat-url", chatUrl]);
  rejected(["--action", "generated_repo_authorization", "--control-repository", base.control_repository, "--sandbox-repository", base.sandbox_repository, "--chat-url", "https://chatgpt.com/c/chat-212"]);
  fs.writeFileSync(stateFile, JSON.stringify({ ...base, control_environment_ready: false }));
  rejected(["--action", "generated_repo_authorization", "--control-repository", base.control_repository, "--sandbox-repository", base.sandbox_repository, "--chat-url", chatUrl]);
  fs.writeFileSync(stateFile, JSON.stringify(base));
  const accepted = run(["--action", "generated_repo_authorization", "--control-repository", base.control_repository, "--sandbox-repository", base.sandbox_repository, "--chat-url", chatUrl]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(saved.github_plugin_authorization_verified, true);
  assert.equal(saved.github_plugin_authorization_installation_id, base.installation_id);
  assert.equal(saved.github_plugin_authorization_control_repository, base.control_repository);
  assert.equal(saved.github_plugin_authorization_sandbox_repository, base.sandbox_repository);
  assert.equal(saved.github_plugin_authorization_chat_url, chatUrl);
  assert.equal(Object.hasOwn(saved, "sandbox_review_route"), false);
  fs.rmSync(root, { recursive: true, force: true });
});
