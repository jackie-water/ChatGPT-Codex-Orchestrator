import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

function run(args, home) {
  return spawnSync(process.execPath, ["src/cli.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {...process.env, CHATGPT_CODEX_ORCHESTRATOR_HOME: home}
  });
}

test("AI can save a repository answer without editing state by hand", () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orchestrator-answer-"));
  try {
    const r=run(["answer","--action","target_repository","--value","owner/repo","--json","--language","en"],home);
    assert.equal(r.status,0,r.stderr);
    const payload=JSON.parse(r.stdout);
    assert.equal(payload.status,"PASS");
    const state=JSON.parse(fs.readFileSync(path.join(home,"install-state.json"),"utf8"));
    assert.equal(state.target_repository,"owner/repo");
  } finally {
    fs.rmSync(home,{recursive:true,force:true});
  }
});

test("invalid repository answer is rejected", () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orchestrator-answer-"));
  try {
    const r=run(["answer","--action","target_repository","--value","not-a-repository","--json","--language","en"],home);
    assert.equal(r.status,1);
    const payload=JSON.parse(r.stdout);
    assert.equal(payload.error_id,"SETUP-005");
  } finally {
    fs.rmSync(home,{recursive:true,force:true});
  }
});
