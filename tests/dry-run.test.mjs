import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

test("dry-run reports the installation plan without enabling the real project",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orchestrator-dry-run-"));
  try{
    const r=spawnSync(process.execPath,["src/cli.mjs","dry-run","--json","--language","en"],{
      cwd:process.cwd(),
      encoding:"utf8",
      env:{...process.env,CHATGPT_CODEX_ORCHESTRATOR_HOME:home}
    });
    assert.equal(r.status,0);
    const payload=JSON.parse(r.stdout);
    assert.equal(payload.dry_run,true);
    assert.equal(payload.mutations_performed,false);
    const activation=payload.plan.find(x=>x.step==="real_project_activation");
    assert.equal(activation.gated_by,"sandbox_complete");
  }finally{
    fs.rmSync(home,{recursive:true,force:true});
  }
});
