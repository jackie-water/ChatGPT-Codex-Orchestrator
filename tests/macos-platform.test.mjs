import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { macosPrerequisites, parseNodeMajor, migrationInventory, migrationPreflight, renderLaunchAgent } from "../src/lib/macos-platform.mjs";

test("Node prerequisite parser accepts supported majors and rejects v21",()=>{
  assert.equal(parseNodeMajor("v21.9.0"),21);
  assert.equal(parseNodeMajor("v22.0.0"),22);
  assert.equal(parseNodeMajor("v24.22.0"),24);
  assert.equal(typeof macosPrerequisites,"function");
});

test("macOS migration inventory is read-only and keeps credential locations private",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-home-"));
  const before=fs.readdirSync(home);
  const result=migrationInventory({home,state:{browser_port:9333}});
  assert.equal(result.platform,process.platform);
  assert.equal(result.browser.port,9333);
  assert.deepEqual(fs.readdirSync(home),before);
  assert.doesNotMatch(JSON.stringify(result),/token|secret|oauth|password/i);
});

test("migration preflight reports conflicts without stopping or switching runners",()=>{
  const result=migrationPreflight({home:fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-home-")),state:{runner_label:"never-present"}});
  assert.equal(result.mutations_performed,false);
  assert.equal(result.rollback.automatic,false);
  assert.ok(Array.isArray(result.conflicts));
});

test("LaunchAgent rendering separates reverse-DNS labels from filesystem paths",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-home-"));
  const previousHome=process.env.HOME;
  process.env.HOME=home;
  try {
    const runner=path.join(home,"runner");
    const instance=path.join(home,"instance");
    fs.mkdirSync(runner,{mode:0o700});
    fs.mkdirSync(instance,{mode:0o700});

    assert.throws(()=>renderLaunchAgent({label:"x",runnerPath:runner,instanceRoot:instance}),/reverse-DNS/);
    assert.throws(()=>renderLaunchAgent({label:"com.example.orchestrator",runnerPath:"/tmp/runner",instanceRoot:"/tmp/instance"}),/HOME-scoped/);

    const plist=renderLaunchAgent({
      label:"com.example.orchestrator",
      runnerPath:runner,
      instanceRoot:instance,
      programArguments:["--value", "a&b<c>d\"e'e"]
    });
    assert.match(plist,/com\.example\.orchestrator/);
    assert.match(plist,/a&amp;b&lt;c&gt;d&quot;e&apos;e/);
  } finally {
    if(previousHome===undefined) delete process.env.HOME;
    else process.env.HOME=previousHome;
  }
});
