import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

function createFixture() {
  const darwin=process.platform==="darwin";
  const tempBase=darwin?fs.realpathSync(os.tmpdir()):os.tmpdir();
  const home=fs.mkdtempSync(path.join(tempBase,"orchestrator-answer-"));
  const stateRoot=darwin?path.join(home,"state"):home;
  if(darwin){
    fs.chmodSync(home,0o700);
    fs.mkdirSync(stateRoot,{mode:0o700});
  }
  return {home,stateRoot};
}

function run(args, {home,stateRoot}) {
  return spawnSync(process.execPath, ["src/cli.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {...process.env, ...(process.platform==="darwin"?{HOME:home}:{}), CHATGPT_CODEX_ORCHESTRATOR_HOME: stateRoot}
  });
}

test("AI can save a repository answer without editing state by hand", () => {
  const fixture=createFixture();
  try {
    const r=run(["answer","--action","target_repository","--value","owner/repo","--json","--language","en"],fixture);
    assert.equal(r.status,0,r.stderr);
    const payload=JSON.parse(r.stdout);
    assert.equal(payload.status,"PASS");
    const state=JSON.parse(fs.readFileSync(path.join(fixture.stateRoot,"install-state.json"),"utf8"));
    assert.equal(state.target_repository,"owner/repo");
  } finally {
    fs.rmSync(fixture.home,{recursive:true,force:true});
  }
});

test("invalid repository answer is rejected", () => {
  const fixture=createFixture();
  try {
    const r=run(["answer","--action","target_repository","--value","not-a-repository","--json","--language","en"],fixture);
    assert.equal(r.status,1,r.stderr);
    const payload=JSON.parse(r.stdout);
    assert.equal(payload.error_id,"SETUP-005");
  } finally {
    fs.rmSync(fixture.home,{recursive:true,force:true});
  }
});
