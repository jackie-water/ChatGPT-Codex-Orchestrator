import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const cli=fs.readFileSync("src/cli.mjs","utf8");
const platform=fs.readFileSync("src/lib/macos-platform.mjs","utf8");
const workflow=fs.readFileSync("templates/control-repo/orchestrator.macos.yml.template","utf8");

test("Darwin setup gates bootstrap on validated inputs and connector evidence",()=>{
  const darwin=cli.slice(cli.indexOf('if(process.platform==="darwin")'),cli.indexOf('  state.installation_id ||= crypto.randomUUID();',cli.indexOf('if(process.platform==="darwin")'))+1000);
  assert.ok(darwin.indexOf("if(!state.target_repository)") < darwin.indexOf("prepareControlEnvironment"));
  assert.match(cli,/github_plugin_authorization_verified/);
  assert.match(cli,/github_plugin_authorization_control_repository/);
  assert.doesNotMatch(cli,/github\.event\.issue\.user\.login/);
});

test("LaunchAgent mutations require Sandbox scope and action approval",()=>{
  assert.match(platform,/state\.sandbox_only/);
  assert.match(platform,/state\.macos_action_approval!==action/);
  assert.match(platform,/MACOS-PLIST-COLLISION/);
  assert.match(platform,/launchctl_state/);
  assert.match(platform,/launch_agent_label/);
});

test("macOS workflow binds event path and native dispatcher",()=>{
  assert.match(workflow,/register-chat\.mjs --event-path/);
  assert.match(workflow,/macos-dispatch\.mjs --event-path/);
  assert.match(workflow,/macos-code-review\.mjs/);
  assert.match(workflow,/macos-merge-approved\.mjs/);
  assert.doesNotMatch(workflow,/event\.issue\.user\.login/);
});

test("dispatcher executes before finalization",()=>{
  const dispatcher=fs.readFileSync("runtime/scripts/macos-dispatch.mjs","utf8");
  assert.ok(dispatcher.indexOf("executeMacosCodexRun") < dispatcher.indexOf("finalizeMacosCodexRun"));
  assert.match(dispatcher,/Only the enabled private Sandbox project/);
});
