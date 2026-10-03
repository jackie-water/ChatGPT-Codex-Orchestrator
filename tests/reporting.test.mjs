import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

test("submit-report refuses to upload without explicit consent",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"report-consent-"));
  try{
    const file=path.join(home,"report.json");
    fs.writeFileSync(file,JSON.stringify({error_id:"TEST-001"}));
    const r=spawnSync(process.execPath,["src/cli.mjs","submit-report","--file",file,"--json"],{
      cwd:process.cwd(),encoding:"utf8",env:{...process.env,CHATGPT_CODEX_ORCHESTRATOR_HOME:home,ORCHESTRATOR_FEEDBACK_REPOSITORY:"owner/repo"}
    });
    assert.equal(r.status,1);
    const payload=JSON.parse(r.stdout);
    assert.equal(payload.error_id,"REPORT-001");
    assert.equal(payload.uploaded,false);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
