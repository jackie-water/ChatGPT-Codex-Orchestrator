import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
  inspectMacosReceiptContinuity, makeMacosReceiptContinuityReceipt,
  MACOS_RECEIPT_CONTINUITY_ACTION, MACOS_RECEIPT_CONTINUITY_SCOPE
} from '../src/lib/macos-receipt-continuity.mjs';
const sourceNames=['install.sh','src/cli.mjs','src/lib/macos-existing-instance-recovery.mjs','AI_INSTALL.md'];
function git(cwd,...args){
  const out=spawnSync('git',args,{cwd,encoding:'utf8',env:{...process.env,
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',
    GIT_TERMINAL_PROMPT:'0'},timeout:6000});
  if(out.status!==0)throw new Error('fixture git failed: '+out.stderr);
  return out.stdout.trim();
}
function mkdir(p){fs.mkdirSync(p,{recursive:true,mode:0o700});fs.chmodSync(p,0o700);}
function fixture(t){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'g3-receipt-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const home=path.join(root,'home');mkdir(home);
  const instanceId='192e9295',installationId='192e9295-frozen-installation';
  const entries=path.join(home,'.chatgpt-codex-orchestrator','instances');mkdir(entries);
  const historical=path.join(entries,'1832f0bb');
  for(const name of ['short-turn-evidence','manual-codex-evidence','review-evidence'])mkdir(path.join(historical,name));
  const instance=path.join(entries,instanceId);mkdir(instance);
  const sourceRoot=path.join(home,'new-source');mkdir(sourceRoot);
  const originalRoot=path.join(home,'.chatgpt-codex-orchestrator','official-source');mkdir(originalRoot);
  // Two honest, isolated Git repositories. Never touch a user checkout.
  for(const loc of [sourceRoot]){
    git(loc,'init','-q');
    for(const name of sourceNames){const p=path.join(loc,name);mkdir(path.dirname(p));fs.writeFileSync(p,`${name}\nnew frozen source\n`,{mode:0o600});}
    git(loc,'add','-A');git(loc,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','frozen new source');
  }
  const sourceCommit=git(sourceRoot,'rev-parse','HEAD'),sourceTree=git(sourceRoot,'rev-parse','HEAD^{tree}');
  // A different original HEAD lives in the immutable official-source root.
  const originalTemp=path.join(home,'old-source-temp');mkdir(originalTemp);
  git(originalTemp,'init','-q');
  for(const name of sourceNames){const p=path.join(originalTemp,name);mkdir(path.dirname(p));fs.writeFileSync(p,`${name}\noriginal installation source\n`,{mode:0o600});}
  git(originalTemp,'add','-A');git(originalTemp,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','frozen original source');
  const oldCommit=git(originalTemp,'rev-parse','HEAD');
  const old=path.join(originalRoot,oldCommit);fs.renameSync(originalTemp,old);
  const intentFile=path.join(instance,'migration-intent.json');
  const state={schema_version:1,installation_id:installationId,github_login:'owner',
    reviewer_chat_url:'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555',target_repository:'owner/ChatGPT-Codex-Orchestrator-E2E-Target',
    macos_setup_approved:true,fresh_first_install_bootstrap:true,
    fresh_first_install_legacy_instance_id:'1832f0bb',current_step:'macos_native_activation',
    migration_intent_path:intentFile,migration_intent_phase:'PREPARED',
    last_error:{error_id:'SETUP-011',message:'saved original error'},
    macos_official_fresh_preparation_approval:{schema_version:1,
      action_id:'macos_official_fresh_preparation',scope:'fresh-private-control-sandbox-only-v1',
      challenge:'macos-official-fresh-preparation-v1:'+'a'.repeat(64),approved_at:'2026-11-17T01:00:00.000Z'}};
  const intent={schema_version:1,phase:'PREPARED',installation_id:installationId,
    generated_repositories:{control:'owner/chatgpt-codex-orchestrator-control-192e9295',
      sandbox:'owner/chatgpt-codex-orchestrator-sandbox-192e9295'},
    source:{path:old,git:{head:oldCommit,dirty_count:0}},
    destination:{path:instance,git:{present:false}},
    exact_refs:{source_head:oldCommit,destination_head:null},
    preservation:{registry:{target_repository:state.target_repository,target_environment_ready:false}}};
  fs.writeFileSync(intentFile,JSON.stringify(intent),{mode:0o600});fs.chmodSync(intentFile,0o600);
  const local=()=>({status:'PASS',mutations_performed:false});
  const remote=()=>({status:'PASS',owner_login:'owner',owner_id:1234,
    control:'VERIFIED_ABSENT',sandbox:'VERIFIED_ABSENT'});
  const inspect=opts=>inspectMacosReceiptContinuity({state,home,sourceRoot,
    localPreflight:local,remotePreflight:remote,...opts});
  return {root,home,sourceRoot,sourceCommit,sourceTree,old,oldCommit,intentFile,state,intent,local,remote,inspect};
}

test('G3 receipt continuity: exact existing intent and clean NEW source require a NEW action, never reuse historic challenge',t=>{
  const f=fixture(t),beforeIntent=fs.readFileSync(f.intentFile),beforeReceipt=JSON.stringify(f.state.macos_official_fresh_preparation_approval);
  const r=f.inspect();
  assert.equal(r.status,'NEEDS_USER_ACTION',JSON.stringify(r));
  assert.equal(r.action_id,MACOS_RECEIPT_CONTINUITY_ACTION);
  assert.match(r.approval_challenge,/^macos-receipt-continuity-v1:[0-9a-f]{64}$/);
  assert.notEqual(r.approval_challenge,f.state.macos_official_fresh_preparation_approval.challenge);
  assert.equal(r.source_commit,f.sourceCommit);
  assert.equal(r.source_tree,f.sourceTree);
  assert.equal(r.original_receipt_validity,'HISTORICAL_NOT_RECONSTRUCTIBLE');
  assert.equal(r.mutations_performed,false);
  assert.equal(makeMacosReceiptContinuityReceipt({state:f.state,value:'true',inspection:r}),null);
  assert.equal(makeMacosReceiptContinuityReceipt({state:f.state,value:f.state.macos_official_fresh_preparation_approval.challenge,inspection:r}),null);
  const newReceipt=makeMacosReceiptContinuityReceipt({state:f.state,value:r.approval_challenge,inspection:r});
  assert.equal(newReceipt.scope,MACOS_RECEIPT_CONTINUITY_SCOPE);
  assert.equal(newReceipt.source_commit,f.sourceCommit);
  f.state.macos_receipt_continuity_approval=newReceipt;
  assert.equal(f.inspect().status,'PASS');
  assert.equal(makeMacosReceiptContinuityReceipt({state:f.state,value:r.approval_challenge,inspection:r}),null,'one-time action cannot be minted twice');
  assert.deepEqual(fs.readFileSync(f.intentFile),beforeIntent);
  assert.equal(JSON.stringify(f.state.macos_official_fresh_preparation_approval),beforeReceipt);
});

test('G3 receipt continuity: 14 contradictory states all block with no challenge',t=>{
  const f=fixture(t);
  const variants=[
    s=>{s.macos_setup_approved=false},
    s=>{s.target_environment_ready=true},
    s=>{s.control_environment_ready=true},
    s=>{s.review_route='chat-1'},
    s=>{s.sandbox_repository='owner/foreign'},
    s=>{s.control_repository='owner/foreign'},
    s=>{s.instance_id='192e9295'},
    s=>{s.macos_runner_bootstrap={phase:'STARTED'}},
    s=>{s.macos_receipt_continuity_attempt={phase:'INTENT_RECORDED'}},
    s=>{s.migration_intent_phase='COMPLETED'},
    s=>{s.macos_official_fresh_preparation_approval.scope='runner-start'},
    s=>{s.macos_official_fresh_preparation_approval.challenge='fake'},
    s=>{s.macos_official_fresh_preparation_approval.extra=true},
    s=>{s.last_error.error_id='UNRELATED'}
  ];
  for(const make of variants){const state=structuredClone(f.state);make(state);
    const r=f.inspect({state});assert.equal(r.status,'BLOCKED',JSON.stringify(r));
    assert.equal(Object.hasOwn(r,'approval_challenge'),false);
  }
  assert.equal(variants.length,14);
});

test('G3 receipt continuity: unknown, foreign or partial remote effects refuse to issue challenge',t=>{
  const f=fixture(t);
  for(const remote of [
    undefined,
    ()=>({status:'UNKNOWN'}),
    ()=>({...f.remote(),control:'EXISTS'}),
    ()=>({...f.remote(),sandbox:'EXISTS'}),
    ()=>({...f.remote(),owner_id:0}),
    ()=>({...f.remote(),owner_login:'other'})
  ]){
    const r=f.inspect({remotePreflight:remote===undefined?null:remote});
    assert.equal(r.status,'BLOCKED');assert.equal(r.error_id,'G3-CONTINUITY-REMOTE_EFFECTS_UNVERIFIED');
  }
  assert.equal(f.inspect({localPreflight:()=>({status:'UNKNOWN'})}).error_id,'G3-CONTINUITY-LOCAL_EFFECTS_UNVERIFIED');
});

test('G3 receipt continuity: old intent and historic source drift invalidate fresh approval, no overwrite',t=>{
  const f=fixture(t),initial=f.inspect();assert.equal(initial.status,'NEEDS_USER_ACTION');
  const receipt=makeMacosReceiptContinuityReceipt({state:f.state,value:initial.approval_challenge,inspection:initial});
  f.state.macos_receipt_continuity_approval=receipt;
  const oldIntent=fs.readFileSync(f.intentFile);
  fs.writeFileSync(f.intentFile,oldIntent.toString().replace('PREPARED','COMPLETE'));
  let result=f.inspect();assert.equal(result.status,'BLOCKED');
  fs.writeFileSync(f.intentFile,oldIntent);fs.chmodSync(f.intentFile,0o600);
  assert.equal(f.inspect().status,'PASS');
  fs.appendFileSync(path.join(f.old,'AI_INSTALL.md'),'\nold bytes changed\n');
  result=f.inspect();assert.equal(result.status,'BLOCKED');assert.match(result.error_id,/DIRTY_SOURCE|APPROVAL_CONFLICT/);
  assert.deepEqual(fs.readFileSync(f.intentFile),oldIntent);
});

test('G3 receipt continuity: changed source, staged edit, or untracked file reject; no Git filters are executed',t=>{
  const f=fixture(t);
  assert.equal(f.inspect().status,'NEEDS_USER_ACTION');
  const extension=path.join(f.root,'fsmonitor-would-execute');
  fs.writeFileSync(extension,'not executed',{mode:0o600});
  const cfg=path.join(f.sourceRoot,'.git','config');
  fs.appendFileSync(cfg,`\n[core]\n fsmonitor = ${extension}\n[filter "test"]\n clean = /bin/sh -c 'exit 99'\n`);
  assert.equal(f.inspect().status,'NEEDS_USER_ACTION','no filter/fsmonitor on plumbing reads');
  assert.equal(fs.readFileSync(extension,'utf8'),'not executed');
  fs.appendFileSync(path.join(f.sourceRoot,'src','cli.mjs'),'\nchanged\n');
  assert.match(f.inspect().error_id,/DIRTY_SOURCE/);
  git(f.sourceRoot,'add','src/cli.mjs');
  assert.match(f.inspect().error_id,/STAGED_OR_MISSING_SOURCE/);
  git(f.sourceRoot,'reset','-q','HEAD','--','src/cli.mjs');
  fs.writeFileSync(path.join(f.sourceRoot,'untracked.txt'),'temp');
  assert.match(f.inspect().error_id,/UNTRACKED_SOURCE|DIRTY_SOURCE/);
});

test('G3 receipt continuity: duplicate-key original migration intent is rejected without mutation',t=>{
  const f=fixture(t),original=fs.readFileSync(f.intentFile);
  assert.equal(f.inspect().status,'NEEDS_USER_ACTION');
  const duplicate=original.toString().replace('"phase":"PREPARED"',
    '"phase":"PREPARED","ph\u0061se":"COMPLETE"');
  fs.writeFileSync(f.intentFile,duplicate,{mode:0o600});
  const result=f.inspect();
  assert.equal(result.status,'BLOCKED');
  assert.match(result.error_id,/DUPLICATE_JSON_KEY/);
  assert.deepEqual(fs.readFileSync(f.intentFile),Buffer.from(duplicate));
});

test('G3 receipt continuity: source location and historic legacy roots are immutable inspection facts',t=>{
  const f=fixture(t);
  const r=f.inspect();assert.equal(r.status,'NEEDS_USER_ACTION');
  const symlink=path.join(f.home,'symlink-source');fs.symlinkSync(f.sourceRoot,symlink);
  assert.equal(f.inspect({sourceRoot:symlink}).status,'BLOCKED');
  fs.chmodSync(path.join(f.home,'.chatgpt-codex-orchestrator','instances','1832f0bb','short-turn-evidence'),0o755);
  assert.equal(f.inspect().status,'BLOCKED');
  assert.equal(f.inspect().authorization_for_new_sha,false);
});

test('G3 receipt continuity: changing Chat URL changes new approval challenge',t=>{
  const f=fixture(t),r=f.inspect();
  const receipt=makeMacosReceiptContinuityReceipt({state:f.state,value:r.approval_challenge,inspection:r});
  f.state.macos_receipt_continuity_approval=receipt;
  assert.equal(f.inspect().status,'PASS');
  f.state.reviewer_chat_url='https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(f.inspect().error_id,'G3-CONTINUITY-APPROVAL-CONFLICT');
});

// CLI integration checks belong to a frozen source-only fixture, not a real
// HOME or a real GitHub Control. This test proves the side-effect order in code.
test('G3 continuity: official CLI source orders the exact gate before all side effects',()=>{
  const cli=fs.readFileSync(new URL('../src/cli.mjs',import.meta.url),'utf8');
  const module=fs.readFileSync(new URL('../src/lib/macos-receipt-continuity.mjs',import.meta.url),'utf8');
  const setup=cli.slice(cli.indexOf('function runSetup()'),cli.indexOf('function githubLogin()',cli.indexOf('function runSetup()')));
  assert.ok(setup.indexOf('const continuity=continuityCandidate?macosReceiptContinuityInspection')>0);
  assert.ok(setup.indexOf('const continuity=continuityCandidate?macosReceiptContinuityInspection')<setup.indexOf('const existingInstanceRecovery=macosRecoveryReport'));
  assert.ok(setup.indexOf('const continuity=continuityCandidate?macosReceiptContinuityInspection')<setup.indexOf('prepareMigrationIntent({state'));
  assert.ok(setup.indexOf('macos_receipt_continuity_attempt={')<setup.indexOf('prepareControlEnvironment({installationId:state.installation_id'));
  assert.ok(setup.includes('original_intent_immutable:true'));
  assert.ok(setup.includes('UNRECONCILED_AFTER_ATTEMPT'));
  assert.ok(module.includes('HISTORICAL_NOT_RECONSTRUCTIBLE'));
});
