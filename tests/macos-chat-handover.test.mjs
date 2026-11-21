import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {
  canonicalMacosHandoverChatUrl,inspectMacosChatHandover,
  makeMacosChatHandoverReceipt,makeMacosChatHandoverResumeReceipt,
  MACOS_CHAT_HANDOVER_ACTION,MACOS_CHAT_HANDOVER_RESUME_ACTION
} from '../src/lib/macos-chat-handover.mjs';

const OLD='422e20b12e851fc373daeac3c0a602223b628011',
  OLD_TREE='cc0a0e2a53912be928789124237687cd2735ee8d',BIND='c'.repeat(64);
const FORMER='https://chatgpt.com/g/project-01/c/11111111-1111-1111-1111-111111111111';
const SUCCESSOR='https://chatgpt.com/g/project-01/c/22222222-2222-2222-2222-222222222222';
function mkdir(dir){fs.mkdirSync(dir,{mode:0o700,recursive:true});fs.chmodSync(dir,0o700);}
function git(dir,...args){const o=spawnSync('git',args,{cwd:dir,encoding:'utf8',env:{...process.env,
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',
  GIT_TERMINAL_PROMPT:'0'},timeout:6000});
  if(o.status!==0)throw Error('test fixture git: '+o.stderr);return o.stdout.trim();}
function fixture(t){
  const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'g3-handover-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const home=path.join(temp,'home');mkdir(home);
  const privateRoot=path.join(home,'.chatgpt-codex-orchestrator');mkdir(privateRoot);
  const instances=path.join(privateRoot,'instances');mkdir(instances);
  const instance=path.join(instances,'192e9295');mkdir(instance);
  const intentFile=path.join(instance,'migration-intent.json');fs.writeFileSync(intentFile,
    JSON.stringify({schema_version:1,phase:'PREPARED',installation_id:'192e9295-frozen',
      preservation:{registry:{target_repository:'owner/ChatGPT-Codex-Orchestrator-E2E-Target'}}}),{mode:0o600});
  fs.chmodSync(intentFile,0o600);
  const official=path.join(privateRoot,'official-source');mkdir(official);
  const stage=path.join(official,'stage-source');mkdir(stage);
  git(stage,'init','-q');
  for(const name of ['install.sh','AI_INSTALL.md','src/cli.mjs','src/lib/macos-existing-instance-recovery.mjs']){
    const f=path.join(stage,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,`handover exact source ${name}\n`);
  }
  git(stage,'add','-A');git(stage,'-c','user.name=G3 Test','-c','user.email=g3@test.invalid','commit','-qm','frozen');
  const sourceSha=git(stage,'rev-parse','HEAD'),sourceTree=git(stage,'rev-parse','HEAD^{tree}');
  const sourceRoot=path.join(official,sourceSha);fs.renameSync(stage,sourceRoot);
  const originalSourceRoot=path.join(official,OLD);mkdir(originalSourceRoot);
  const state={installation_id:'192e9295-frozen',preferred_language:'en',
    macos_setup_approved:true,fresh_first_install_bootstrap:true,
    fresh_first_install_legacy_instance_id:'1832f0bb',last_error:{error_id:'SETUP-011'},
    target_repository:'jackie-water/ChatGPT-Codex-Orchestrator-E2E-Target',github_login:'jackie-water',
    reviewer_chat_url:FORMER,migration_intent_path:intentFile,migration_intent_phase:'PREPARED',
    github_plugin_authorized:true,target_environment_ready:false,control_environment_ready:false,
    macos_receipt_continuity_approval:{schema_version:1,
      action_id:'macos_receipt_continuity_approval',scope:'g3-failed-setup-retry-private-control-sandbox-only-v1',
      challenge:'macos-receipt-continuity-v1:'+'e'.repeat(64),approved_at:'2026-11-19T04:00:00.000Z',
      source_commit:OLD,source_tree:OLD_TREE,binding_sha256:BIND},
    macos_official_fresh_preparation_approval:{schema_version:1,
      action_id:'macos_official_fresh_preparation',scope:'fresh-private-control-sandbox-only-v1',
      challenge:'macos-official-fresh-preparation-v1:'+'f'.repeat(64),approved_at:'2026-11-17T01:00:00.000Z'}};
  const prior=source=>({status:'PASS',authorized:source===originalSourceRoot,
    source_commit:OLD,source_tree:OLD_TREE,binding_sha256:BIND,
    old_receipt_preserved:true,historical_intent_preserved:true,mutations_performed:false});
  const inspect=extra=>inspectMacosChatHandover({state,home,sourceRoot,
    successorChatUrl:SUCCESSOR,inspectPriorContinuity:prior,...extra});
  return {temp,home,official,instance,intentFile,sourceRoot,sourceSha,sourceTree,originalSourceRoot,state,prior,inspect};
}

test('handover: canonical Chat URL permits same project and rejects fragments, redirects, malformed IDs',()=>{
  assert.equal(canonicalMacosHandoverChatUrl(SUCCESSOR)?.chat,'22222222-2222-2222-2222-222222222222');
  assert.equal(canonicalMacosHandoverChatUrl(SUCCESSOR+'/')?.url,SUCCESSOR);
  for(const u of [SUCCESSOR+'?a=1',SUCCESSOR+'#x',SUCCESSOR.replace('chatgpt.com','chatgpt.com.evil'),
    SUCCESSOR.replace('https:','http:'),'https://evil@chatgpt.com/c/33333333',
    'https://chatgpt.com/c/no','https://chatgpt.com/share/11111111',
    SUCCESSOR.replace('/c/','/other/'),SUCCESSOR+' ',null,123])assert.equal(canonicalMacosHandoverChatUrl(u),null);
});

test('handover: first consent changes no state, old intent or receipt; second consent is separate',t=>{
  const f=fixture(t),beforeIntent=fs.readFileSync(f.intentFile),oldReceipt=structuredClone(f.state.macos_receipt_continuity_approval),
    historical=structuredClone(f.state.macos_official_fresh_preparation_approval);
  const first=f.inspect();assert.equal(first.status,'NEEDS_USER_ACTION',JSON.stringify(first));
  assert.equal(first.action_id,MACOS_CHAT_HANDOVER_ACTION);
  assert.match(first.approval_challenge,/^macos-chat-handover-v1:[0-9a-f]{64}$/);
  assert.equal(first.authorization_for_new_chat,false);
  assert.equal(makeMacosChatHandoverReceipt({state:f.state,value:'true',inspection:first,successorChatUrl:SUCCESSOR}),null);
  const record=makeMacosChatHandoverReceipt({state:f.state,value:first.approval_challenge,
    inspection:first,successorChatUrl:SUCCESSOR});
  assert.equal(record.predecessor_chat_url,FORMER);
  assert.equal(record.successor_chat_url,SUCCESSOR);
  f.state.macos_chat_handover_approval=record;
  assert.equal(f.state.reviewer_chat_url,FORMER,'old URL remains bound before unique attempt');
  const second=f.inspect();assert.equal(second.status,'NEEDS_USER_ACTION');
  assert.equal(second.action_id,MACOS_CHAT_HANDOVER_RESUME_ACTION);
  assert.equal(second.installation_authorized,false);
  assert.match(second.approval_challenge,/^macos-chat-handover-resume-v1:[0-9a-f]{64}$/);
  const invalid=makeMacosChatHandoverResumeReceipt({state:f.state,value:record.challenge,inspection:second});
  assert.equal(invalid,null,'handover identity permission cannot authorize private repo writes');
  const granted=makeMacosChatHandoverResumeReceipt({state:f.state,value:second.approval_challenge,inspection:second});
  f.state.macos_chat_handover_resume_approval=granted;
  const approved=f.inspect();assert.equal(approved.status,'PASS',JSON.stringify(approved));
  assert.equal(approved.authorized,true);
  assert.equal(approved.successor_chat_url,SUCCESSOR);
  assert.equal(makeMacosChatHandoverResumeReceipt({state:f.state,value:second.approval_challenge,inspection:second}),null);
  assert.equal(makeMacosChatHandoverReceipt({state:f.state,value:first.approval_challenge,inspection:first,successorChatUrl:SUCCESSOR}),null);
  assert.deepEqual(fs.readFileSync(f.intentFile),beforeIntent);
  assert.deepEqual(f.state.macos_receipt_continuity_approval,oldReceipt);
  assert.deepEqual(f.state.macos_official_fresh_preparation_approval,historical);
});

test('handover: no successor URL emits only URL request with no hidden approval',t=>{
  const f=fixture(t),r=f.inspect({successorChatUrl:undefined});
  // Explicit undefined replaces the fixture's default successor URL.
  const no=inspectMacosChatHandover({state:f.state,home:f.home,sourceRoot:f.sourceRoot,inspectPriorContinuity:f.prior});
  assert.equal(no.status,'NEEDS_USER_ACTION');assert.equal(no.action_id,'macos_chat_successor_url');
  assert.equal(Object.hasOwn(no,'approval_challenge'),false);
  assert.equal(r.action_id,'macos_chat_successor_url');
});

test('handover: 21 conflicting identity and stage variants fail closed before new authorization',t=>{
  const f=fixture(t),variants=[
    s=>s.macos_setup_approved=false,s=>s.fresh_first_install_bootstrap=false,
    s=>s.fresh_first_install_legacy_instance_id='another',s=>s.last_error.error_id='OTHER',
    s=>s.control_environment_ready=true,s=>s.target_environment_ready=true,s=>s.ready=true,
    s=>s.review_route='chat-1',s=>s.sandbox_review_route='chat-1',s=>s.control_repository='owner/other',
    s=>s.sandbox_repository='owner/other',s=>s.control_clone_path='/tmp/other',
    s=>s.sandbox_clone_path='/tmp/other',s=>s.sandbox_chat_registration_issue='issue-1',
    s=>s.instance_id='192e9295',s=>s.macos_runner_bootstrap={phase:'STARTED'},
    s=>s.macos_runner_activation={status:'ACTIVE'},
    s=>s.macos_receipt_continuity_attempt={phase:'INTENT_RECORDED'},
    s=>s.github_plugin_authorization_verified=true,
    s=>s.macos_chat_handover_applied={status:'PENDING'},
    s=>s.macos_receipt_continuity_approval.challenge='bad'
  ];
  for(const mutate of variants){const state=structuredClone(f.state);mutate(state);
    const r=f.inspect({state});assert.equal(r.status,'BLOCKED',JSON.stringify(r));
    assert.equal(Object.hasOwn(r,'approval_challenge'),false);
  }
  assert.equal(variants.length,21);
});

test('handover: successor identity must differ and remain in same project if old URL is project-scoped',t=>{
  const f=fixture(t);
  for(const url of [FORMER,FORMER+'/',SUCCESSOR.replace('project-01','other-project'),
    SUCCESSOR.replace('/g/project-01',''),SUCCESSOR+'?leak=yes','http://chatgpt.com/c/abcdef1234']){
    assert.equal(f.inspect({successorChatUrl:url}).status,'BLOCKED',url);
  }
  assert.equal(f.inspect().status,'NEEDS_USER_ACTION');
  assert.equal(f.inspect({successorChatUrl:SUCCESSOR+'/'}).status,'NEEDS_USER_ACTION','trailing slash on pasted URL is normalized');
});

test('handover: failed old exact source proof, foreign previous root or unknown remote status never yield challenge',t=>{
  const f=fixture(t);
  for(const old of [undefined,()=>({status:'PASS',authorized:false}),
    ()=>({...f.prior(f.originalSourceRoot),source_tree:'9'.repeat(40)}),
    ()=>({...f.prior(f.originalSourceRoot),old_receipt_preserved:false}),
    ()=>({...f.prior(f.originalSourceRoot),mutations_performed:true})]){
    const result=f.inspect({inspectPriorContinuity:old});
    assert.equal(result.status,'BLOCKED');assert.equal(Object.hasOwn(result,'approval_challenge'),false);
  }
});

test('handover: altered intent, source bytes, unsafe ancestor and mismatched source root block',t=>{
  const f=fixture(t),before=f.inspect();assert.equal(before.status,'NEEDS_USER_ACTION');
  const original=fs.readFileSync(f.intentFile);
  fs.appendFileSync(f.intentFile,' ');
  assert.equal(f.inspect().status,'NEEDS_USER_ACTION','valid bytes drift produces different consent, not reuse');
  fs.writeFileSync(f.intentFile,original);fs.chmodSync(f.intentFile,0o600);
  fs.appendFileSync(path.join(f.sourceRoot,'AI_INSTALL.md'),'DIRTY');
  assert.equal(f.inspect().status,'BLOCKED');
  fs.writeFileSync(path.join(f.sourceRoot,'AI_INSTALL.md'),'handover exact source AI_INSTALL.md\n');
  const a=fs.lstatSync(f.intentFile);fs.chmodSync(f.intentFile,0o644);
  assert.equal(f.inspect().status,'BLOCKED');fs.chmodSync(f.intentFile,0o600);
  assert.equal(f.inspect({sourceRoot:f.originalSourceRoot}).status,'BLOCKED');
});

test('handover: challenge tampering, receipt drift, old URL change and source mismatch fail closed',t=>{
  const f=fixture(t),first=f.inspect();
  const rec=makeMacosChatHandoverReceipt({state:f.state,value:first.approval_challenge,inspection:first,successorChatUrl:SUCCESSOR});
  f.state.macos_chat_handover_approval=rec;
  const second=f.inspect();
  assert.equal(second.status,'NEEDS_USER_ACTION');
  for(const modify of [
    s=>s.macos_chat_handover_approval.challenge='bad',
    s=>s.macos_chat_handover_approval.successor_chat_url='https://chatgpt.com/c/33333333',
    s=>s.macos_chat_handover_approval.binding_sha256='1'.repeat(64),
    s=>s.macos_chat_handover_approval.extra=1,
    s=>s.reviewer_chat_url='https://chatgpt.com/g/project-01/c/33333333',
    s=>s.macos_receipt_continuity_approval.binding_sha256='0'.repeat(64),
  ]){const state=structuredClone(f.state);modify(state);
    const r=f.inspect({state});assert.equal(r.status,'BLOCKED',JSON.stringify(r));
  }
  const approved=makeMacosChatHandoverResumeReceipt({state:f.state,value:second.approval_challenge,inspection:second});
  f.state.macos_chat_handover_resume_approval=approved;
  assert.equal(f.inspect().status,'PASS');
  f.state.macos_chat_handover_resume_approval.binding_sha256='0'.repeat(64);
  assert.equal(f.inspect().status,'BLOCKED');
});

test('handover: no untrusted URL response leaks private Chat URL; explicit successor input cannot change saved receipt',t=>{
  const f=fixture(t),first=f.inspect();
  assert.equal(JSON.stringify(first).includes(SUCCESSOR),false);
  f.state.macos_chat_handover_approval=makeMacosChatHandoverReceipt({state:f.state,value:first.approval_challenge,inspection:first,successorChatUrl:SUCCESSOR});
  const second=f.inspect();assert.equal(JSON.stringify(second).includes(SUCCESSOR),false);
  assert.equal(f.inspect({successorChatUrl:'https://chatgpt.com/g/project-01/c/33333333'}).status,'BLOCKED');
  f.state.macos_chat_handover_resume_approval=makeMacosChatHandoverResumeReceipt({state:f.state,value:second.approval_challenge,inspection:second});
  assert.equal(f.inspect().authorized,true);
});

test('handover: another project or non-mac state cannot quietly inherit Chat route',t=>{
  const f=fixture(t),state=structuredClone(f.state);state.review_route='chat-121';
  assert.equal(f.inspect({state}).status,'BLOCKED');
  state.review_route=undefined;state.sandbox_chat_registration_issue='https://github.com/owner/control/issues/77';
  assert.equal(f.inspect({state}).status,'BLOCKED');
  assert.equal(f.inspect().action_id,MACOS_CHAT_HANDOVER_ACTION);
});

test('handover: no successor prompt is emitted until both frozen source proofs and private intent pass',t=>{
  const f=fixture(t),file=path.join(f.sourceRoot,'AI_INSTALL.md');
  fs.appendFileSync(file,'dirty\n');
  const r=inspectMacosChatHandover({state:f.state,home:f.home,sourceRoot:f.sourceRoot,inspectPriorContinuity:f.prior});
  assert.equal(r.status,'BLOCKED');assert.equal(Object.hasOwn(r,'action_id'),false);
});

test('handover: preexisting route/outbox/Runner and launch agent leaves must be reconciled, never inherited',t=>{
  const f=fixture(t),root=f.instance;
  for(const role of ['chat-routes.json','registration-delivery','pending-wakes','runner']){
    const leaf=path.join(root,role);
    fs.writeFileSync(leaf,'suspicious');
    const result=f.inspect();assert.equal(result.status,'BLOCKED',role);
    assert.match(result.error_id,/LOCAL_ROUTE_OR_RUNNER_RESIDUE/);
    fs.unlinkSync(leaf);
  }
  const agents=path.join(f.home,'Library','LaunchAgents');mkdir(agents);
  fs.writeFileSync(path.join(agents,'com.chatgpt.codex.192e9295.plist'),'already exists');
  assert.match(f.inspect().error_id,/LOCAL_RUNNER_LAUNCHAGENT_RESIDUE/);
});

test('handover: project-scoped and unscoped URLs cannot be silently mixed in either direction',t=>{
  const f=fixture(t),other=SUCCESSOR.replace('/g/project-01','');
  assert.equal(f.inspect({successorChatUrl:other}).status,'BLOCKED');
  f.state.reviewer_chat_url=FORMER.replace('/g/project-01','');
  assert.equal(f.inspect({successorChatUrl:SUCCESSOR}).status,'BLOCKED');
  assert.equal(f.inspect({successorChatUrl:other}).status,'NEEDS_USER_ACTION');
});

test('handover: foreign immutable Control/Sandbox IDs, or saved Chat route file, block before consent',t=>{
  const f=fixture(t);
  for(const key of ['control_repository_id','sandbox_repository_id','sandbox_project_key','chat_route_file']){
    const state=structuredClone(f.state);state[key]='injected';
    const result=f.inspect({state});assert.equal(result.status,'BLOCKED');
  }
});

test('handover: immutable installation, owner, E2E Target and original SHA/tree are phase-pinned',t=>{
  const f=fixture(t);
  const variants=[
    s=>s.installation_id='1832f0bb-old',
    s=>s.installation_id='bad',
    s=>s.github_login='other',
    s=>s.target_repository='jackie-water/ChatGPT-Codex-Orchestrator',
    s=>s.macos_receipt_continuity_approval.source_commit='0'.repeat(40),
    s=>s.macos_receipt_continuity_approval.source_tree='0'.repeat(40),
  ];
  for(const mutate of variants){const state=structuredClone(f.state);mutate(state);
    const r=f.inspect({state});assert.equal(r.status,'BLOCKED',JSON.stringify(r));
    assert.equal(Object.hasOwn(r,'approval_challenge'),false);
  }
});
