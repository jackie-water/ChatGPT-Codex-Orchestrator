import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

test("submit-report refuses to upload without explicit consent",()=>{
  const darwin=process.platform==="darwin";
  const tempBase=darwin?fs.realpathSync(os.tmpdir()):os.tmpdir();
  const home=fs.mkdtempSync(path.join(tempBase,"report-consent-"));
  const stateRoot=darwin?path.join(home,"state"):home;
  try{
    if(darwin){
      fs.chmodSync(home,0o700);
      fs.mkdirSync(stateRoot,{mode:0o700});
    }
    const file=path.join(home,"report.json");
    fs.writeFileSync(file,JSON.stringify({error_id:"TEST-001"}));
    const r=spawnSync(process.execPath,["src/cli.mjs","submit-report","--file",file,"--json"],{
      cwd:process.cwd(),encoding:"utf8",env:{...process.env,...(darwin?{HOME:home}:{}),CHATGPT_CODEX_ORCHESTRATOR_HOME:stateRoot,ORCHESTRATOR_FEEDBACK_REPOSITORY:"owner/repo"}
    });
    assert.equal(r.status,1,r.stderr);
    assert.notEqual(r.stdout.trim(),"",r.stderr);
    const payload=JSON.parse(r.stdout);
    assert.equal(payload.error_id,"REPORT-001");
    assert.equal(payload.uploaded,false);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
