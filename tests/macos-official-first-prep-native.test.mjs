import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function syntheticMac(t) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cco-g304-native-synthetic-"));
  fs.chmodSync(home, 0o700);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const instance = path.join(home, ".chatgpt-codex-orchestrator", "instances", "1832f0bb");
  for (const relative of ["", "short-turn-evidence", "manual-codex-evidence", "review-evidence", "logs", "control-routing-migration-passive-history"]) {
    const directory = path.join(instance, relative);
    fs.mkdirSync(directory, {recursive:true,mode:0o700}); fs.chmodSync(directory,0o700);
  }
  const snap = path.join(instance, "control-routing-migration-passive-history", "instance.json");
  fs.writeFileSync(snap, '{"instance_id":"1832f0bb"}', {mode:0o644});fs.chmodSync(snap,0o644);
  for (const [i,mode] of [...Array(14).fill(0o700),...Array(29).fill(0o444),...Array(9).fill(0o400)].entries()) {
    const file = path.join(instance, "logs", `historical-${String(i).padStart(3,"0")}.dat`);
    fs.writeFileSync(file,"opaque-test-only",{mode});fs.chmodSync(file,mode);
  }
  const stateRoot = path.join(home,"isolated-installer-journal"); fs.mkdirSync(stateRoot,{mode:0o700});
  const stateFile=path.join(stateRoot,"install-state.json");
  const state={schema_version:1, preferred_language:"zh-CN",current_step:"macos_native_activation",completed:[],ready:false,
    macos_setup_approved:true,fresh_first_install_bootstrap:true,fresh_first_install_legacy_instance_id:"1832f0bb"};
  fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});fs.chmodSync(stateFile,0o600);
  const env={...process.env, HOME:home,USERPROFILE:home,CHATGPT_CODEX_ORCHESTRATOR_HOME:stateRoot,
    GH_CONFIG_DIR:path.join(home,"gh"),XDG_CONFIG_HOME:path.join(home,"config"),
    GIT_CONFIG_GLOBAL:os.devNull??"/dev/null",NODE_OPTIONS:""};
  for (const name of ["GITHUB_TOKEN","GH_TOKEN","GITHUB_PERSONAL_ACCESS_TOKEN","CODEX_API_KEY","OPENAI_API_KEY"])
    delete env[name];
  function run(args) {
    const result=spawnSync(process.execPath,["src/cli.mjs",...args,"--json"],{cwd:process.cwd(),env,encoding:"utf8",timeout:12000,maxBuffer:1024*1024});
    assert.equal(result.error,undefined);
    assert.equal(result.signal,null);
    return {status:result.status, json:JSON.parse(result.stdout),stderr:result.stderr};
  }
  return {home,instance,stateRoot,stateFile,run};
}

test("G3 official first preparation 01: real Darwin CLI uses synthetic HOME and requires exact human challenge before any write",{skip:process.platform!=="darwin"},t=>{
  const f=syntheticMac(t);
  const original=fs.readFileSync(f.stateFile),legacyMetadata=fs.lstatSync(f.instance);
  const dry=f.run(["dry-run","--language","zh-CN"]),pre=f.run(["recovery-preflight"]),setup=f.run(["setup"]);
  for (const r of [dry,pre,setup]) {
    assert.equal(r.status,1);
    assert.equal(r.json.status,"NEEDS_USER_ACTION");
    assert.equal(r.json.action_id,"macos_official_fresh_preparation");
    assert.match(r.json.approval_challenge,/^macos-official-fresh-preparation-v1:[0-9a-f]{64}$/);
    assert.equal(r.json.mutations_performed,false);
  }
  assert.equal(pre.json.approval_challenge,dry.json.approval_challenge);
  assert.equal(setup.json.approval_challenge,dry.json.approval_challenge);
  assert.deepEqual(fs.readFileSync(f.stateFile),original);
  assert.equal(fs.lstatSync(f.instance).ino,legacyMetadata.ino);
  const wrong=f.run(["answer","--action","macos_official_fresh_preparation","--value","true"]);
  assert.equal(wrong.status,1);assert.equal(wrong.json.error_id,"MACOS-OFFICIAL-FRESH-APPROVAL-MISMATCH");
  assert.deepEqual(fs.readFileSync(f.stateFile),original);
  const accepted=f.run(["answer","--action","macos_official_fresh_preparation","--value",dry.json.approval_challenge]);
  assert.equal(accepted.status,0,JSON.stringify(accepted));assert.equal(accepted.json.action_id,"macos_official_fresh_preparation");
  const current=JSON.parse(fs.readFileSync(f.stateFile,"utf8"));
  assert.equal(current.macos_official_fresh_preparation_approval.scope,"fresh-private-control-sandbox-only-v1");
  assert.equal(fs.lstatSync(f.stateFile).mode&0o777,0o600);
  assert.equal(fs.lstatSync(f.instance).ino,legacyMetadata.ino);
  const again=f.run(["answer","--action","macos_official_fresh_preparation","--value",dry.json.approval_challenge]);
  assert.equal(again.status,1);assert.equal(again.json.error_id,"MACOS-OFFICIAL-FRESH-APPROVAL-MISMATCH");
  const readyDry=f.run(["dry-run"]),readyPre=f.run(["recovery-preflight"]);
  for(const r of [readyDry,readyPre]) {
    assert.equal(r.status,0,JSON.stringify(r));
    assert.equal(r.json.status,"PASS");
    assert.equal(r.json.official_fresh_preparation_approved,true);
    assert.equal(r.json.installation_authorized,false);
    assert.equal(r.json.mutations_performed,false);
  }
  fs.chmodSync(path.join(f.instance,"review-evidence"),0o755);
  const stopped=f.run(["setup"]);
  assert.equal(stopped.status,1);assert.equal(stopped.json.status,"ERROR");
  assert.equal(stopped.json.mutations_performed,false);
  assert.equal(fs.lstatSync(f.instance).ino,legacyMetadata.ino);
});
