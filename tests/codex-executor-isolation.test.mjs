import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => fs.readFileSync(new URL(`../runtime/scripts/${file}`, import.meta.url), "utf8");
const isolation = [
  "features.plugins=false",
  "features.apps=false",
  "features.hooks=false",
  "features.memories=false",
  "features.goals=false",
  "features.skill_search=false",
  "features.skip_host_skill_discovery=true",
  "cloud.skills.enabled=false",
  "skills.include_instructions=false"
];

test("implementation and independent review use isolated Codex exec sessions", () => {
  const runner = read("run-codex.ps1");
  const review = read("run-code-review.ps1");
  for (const source of [runner, review]) {
    assert.match(source, /exec --ignore-user-config/);
    for (const setting of isolation) assert.match(source, new RegExp(setting.replaceAll(".", "\\.")));
  }
  assert.match(runner, /exec --ignore-user-config[\s\S]*-m \$model[\s\S]*-c \$cfg[\s\S]*-c \$projectDocsCfg[\s\S]*-c 'default_permissions=":workspace"'[\s\S]*-c 'windows\.sandbox="unelevated"'/);
  assert.doesNotMatch(runner, /-s workspace-write/);
  assert.doesNotMatch(runner, /-a never/);
  assert.doesNotMatch(runner, /\$approvalCfg|\$sandboxCfg|approval_policy|sandbox_mode/);
  assert.match(review, /exec --ignore-user-config[\s\S]*review --base/);
  assert.match(review, /-c \$approvalCfg[\s\S]*-c \$sandboxCfg[\s\S]*-c 'windows\.sandbox="unelevated"'/);
  assert.match(review, /\$approvalCfg = 'approval_policy="never"'/);
  assert.match(review, /\$sandboxCfg = 'sandbox_mode="read-only"'/);
  assert.doesNotMatch(review, /(?:\s|-)a never|(?:\s|-)s read-only/);
  assert.doesNotMatch(review, /& \$codexCommand\.Source\s+-m[\s\S]*\breview --base/);
  assert.doesNotMatch(review, /codex review(?:\s|--)/);
  assert.match(review, /review --base "origin\/\$defaultBranch"/);
  for (const source of [runner, review]) {
    assert.equal(source.split(/\r?\n/).some(line => /(?:Write|Set-Content|Remove-Item|Rename-Item).*?(?:CODEX_HOME|\.codex)|(?:CODEX_HOME|\.codex).*?(?:Write|Set-Content|Remove-Item|Rename-Item)/i.test(line)), false);
  }
});

test("preflight requires isolated exec, review base, and feature capability support", () => {
  const preflight = read("preflight.ps1");
  assert.match(preflight, /codex exec --help/);
  assert.match(preflight, /--ignore-user-config/);
  assert.match(preflight, /default_permissions=":workspace"/);
  assert.match(preflight, /windows\.sandbox="unelevated"/);
  assert.match(preflight, /& codex -c 'default_permissions=":workspace"' -c 'windows\.sandbox="unelevated"' sandbox --/);
  assert.doesNotMatch(preflight, /codex -c 'default_permissions=":workspace"' sandbox[\s\S]*--ignore-user-config/);
  assert.doesNotMatch(preflight, /codex -c 'default_permissions=":workspace"' sandbox[\s\S]*sandbox -C/);
  assert.doesNotMatch(preflight, /codex -c 'default_permissions=":workspace"' sandbox[\s\S]*--include-managed-config/);
  assert.doesNotMatch(preflight, /codex -c 'default_permissions=":workspace"' sandbox[\s\S]*--permission-profile/);
  assert.match(preflight, /SetEnvironmentVariable\("CODEX_HOME", \$workspaceProbeCodexHome, "Process"\)/);
  assert.match(preflight, /Push-Location \$workspaceProbeWorkspace/);
  assert.match(preflight, /Pop-Location/);
  assert.match(preflight, /workspaceProbeCodexHomeWasSet/);
  assert.match(preflight, /SetEnvironmentVariable\("CODEX_HOME", \$null, "Process"\)/);
  assert.match(preflight, /marker\.txt/);
  assert.match(preflight, /Test-Path -LiteralPath \$workspaceProbeMarker/);
  assert.match(preflight, /Get-Content -Raw -LiteralPath \$workspaceProbeMarker/);
  assert.match(preflight, /\$LASTEXITCODE -ne 0[\s\S]*workspaceProbeMarker/);
  assert.match(preflight, /-not \(Test-Path -LiteralPath \$workspaceProbeMarker\)/);
  assert.match(preflight, /finally \{[\s\S]*Remove-Item -LiteralPath \$workspaceProbeDirectory -Recurse -Force/);
  assert.match(preflight, /Codex workspace-permission-profile compatibility error/);
  assert.match(preflight, /failed to create the expected marker with exact content/);
  assert.doesNotMatch(preflight, /-not \(\$execHelp -match "\(\?m\).*--sandbox/);
  assert.match(preflight, /codex exec --ignore-user-config -c 'approval_policy="never"' -c 'sandbox_mode="read-only"' -c 'windows\.sandbox="unelevated"' review --help/);
  assert.match(preflight, /review --base/);
  assert.match(preflight, /codex features list/);
  for (const feature of ["plugins", "apps", "hooks", "memories", "goals", "skill_search", "skip_host_skill_discovery"]) {
    assert.match(preflight, new RegExp(`requiredFeatures[\\s\\S]*${feature}`));
  }
  assert.doesNotMatch(preflight, /codex review --help/);
  assert.doesNotMatch(preflight, /codex features (?:enable|disable)/);
  assert.doesNotMatch(preflight, /(?:plugin|features)\s+(?:install|remove)/);
});

test("feature capability check fails closed for a missing fake key", () => {
  const preflight = read("preflight.ps1");
  const fakeFeatureList = "plugins stable true\napps stable true\nhooks stable true\nmemories stable true\ngoals stable true\nskill_search stable true\n";
  const required = ["plugins", "apps", "hooks", "memories", "goals", "skill_search", "skip_host_skill_discovery"];
  assert.ok(required.some(feature => !new RegExp(`^\\s*${feature}\\s`, "m").test(fakeFeatureList)));
  assert.match(preflight, /throw ["']Installed Codex CLI does not expose required feature key/);
});

test("review preflight fails closed unless the isolated read-only invocation parses", () => {
  const preflight = read("preflight.ps1");
  assert.match(preflight, /\$reviewHelp = & codex exec --ignore-user-config -c 'approval_policy="never"' -c 'sandbox_mode="read-only"' -c 'windows\.sandbox="unelevated"' review --help/);
  assert.match(preflight, /\$LASTEXITCODE -ne 0[\s\S]*--base/);
  assert.match(preflight, /isolated read-only/);
});

test("preflight does not require legacy sandbox CLI capability", () => {
  const preflight = read("preflight.ps1");
  const execHelpWithoutSandbox = "--ignore-user-config\n--approval-policy";
  assert.equal(/(?:-s\b|--sandbox\b)/.test(execHelpWithoutSandbox), false);
  assert.match(preflight, /-not \(\$execHelp -match "--ignore-user-config"\)/);
  assert.match(preflight, /throw "Installed Codex CLI does not expose required feature key/);
});
