import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

function runCli({home, stateRoot, platform}) {
  const cli=path.resolve("src/cli.mjs");
  const script=`Object.defineProperty(process,"platform",{value:${JSON.stringify(platform)}});process.argv=[process.execPath,${JSON.stringify(cli)},"dry-run","--json"];await import(${JSON.stringify(`file://${cli}`)});`;
  return spawnSync(process.execPath,["--input-type=module","-e",script],{
    cwd:process.cwd(),
    encoding:"utf8",
    env:{...process.env,CHATGPT_CODEX_ORCHESTRATOR_HOME:stateRoot,HOME:home}
  });
}

test("dry-run reports the installation plan without enabling the real project",()=>{
  const tempBase=process.platform==="darwin"?fs.realpathSync(os.tmpdir()):os.tmpdir();
  const home=fs.mkdtempSync(path.join(tempBase,"orchestrator-dry-run-"));
  fs.chmodSync(home,0o700);
  try{
    const r=spawnSync(process.execPath,["src/cli.mjs","dry-run","--json","--language","en"],{
      cwd:process.cwd(),
      encoding:"utf8",
      env:{...process.env,CHATGPT_CODEX_ORCHESTRATOR_HOME:home,HOME:home}
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

test("malformed installer state keeps the original error off Darwin and uses the macOS error on Darwin",()=>{
  for(const platform of ["linux","darwin"]){
    const home=fs.mkdtempSync(path.join(os.tmpdir(),`orchestrator-malformed-${platform}-`));
    const stateRoot=path.join(home,"state");
    fs.mkdirSync(stateRoot,{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(stateRoot,"install-state.json"),"{malformed\n",{mode:0o600});
    try{
      const result=runCli({home,stateRoot,platform});
      if(platform==="darwin"){
        const payload=JSON.parse(result.stdout);
        assert.equal(payload.status,"ERROR");
        assert.equal(payload.error_id,"MACOS-EXISTING-INSTANCE-REVIEW");
        assert.deepEqual(payload.plan,[]);
      }else{
        assert.notEqual(result.status,0);
        assert.match(result.stderr,/SyntaxError|Unexpected token/);
        assert.equal(result.stdout,"");
      }
    }finally{ fs.rmSync(home,{recursive:true,force:true}); }
  }
});

test("Darwin dry-run rejects conflicting trusted recovery receipt before prerequisites",()=>{
  const tempBase=fs.realpathSync(os.tmpdir());
  const home=fs.mkdtempSync(path.join(tempBase,"orchestrator-conflicting-receipt-"));
  const instanceId="installa";
  const instance=path.join(home,".chatgpt-codex-orchestrator","instances",instanceId);
  const control=path.join(home,"ChatGPTCodexOrchestrator","control-installa");
  const migration=path.join(instance,"control-routing-migration-20261020");
  const stateRoot=path.join(home,"state");
  fs.mkdirSync(control,{recursive:true,mode:0o700});
  fs.mkdirSync(instance,{recursive:true,mode:0o700});
  fs.mkdirSync(migration,{recursive:true,mode:0o700});
  fs.mkdirSync(stateRoot,{recursive:true,mode:0o700});
  const state={schema_version:1,preferred_language:"en",installation_id:"install-a",instance_id:instanceId,instance_root:instance,control_repository:"owner/control-a",sandbox_repository:"owner/sandbox-a",sandbox_project_key:"sandbox-a",sandbox_review_route:"chat-route"};
  fs.writeFileSync(path.join(stateRoot,"install-state.json"),JSON.stringify(state),{mode:0o600});
  fs.writeFileSync(path.join(control,"instance.json"),JSON.stringify({...state,role:"control"}),{mode:0o600});
  fs.writeFileSync(path.join(instance,"instance.json"),JSON.stringify({...state,role:"control"}),{mode:0o600});
  fs.writeFileSync(path.join(migration,"instance.json"),JSON.stringify({...state,role:"control"}),{mode:0o600});
  fs.writeFileSync(path.join(instance,"chat-routes.json"),JSON.stringify({routes:[{route:"chat-route",project:"sandbox-a",status:"active",installation_id:"install-a",control_repository:"owner/control-a",sandbox_repository:"owner/sandbox-a"}]}),{mode:0o600});
  fs.writeFileSync(path.join(instance,"trusted-recovery-evidence-v1.json"),"{malformed\n",{mode:0o600});
  try{
    const result=runCli({home,stateRoot,platform:"darwin"});
    const payload=JSON.parse(result.stdout);
    assert.equal(payload.status,"ERROR");
    assert.equal(payload.error_id,"MACOS-TRUSTED-RECOVERY-EVIDENCE");
    assert.equal(payload.trusted_recovery_evidence.status,"CONFLICT");
    assert.deepEqual(payload.plan,[]);
    assert.equal(payload.mutations_performed,false);
  }finally{ fs.rmSync(home,{recursive:true,force:true}); }
});
