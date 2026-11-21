import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const cli=fs.readFileSync(new URL('../src/cli.mjs',import.meta.url),'utf8');
const setupSource=cli.slice(cli.indexOf('function runSetup()'),cli.indexOf('function codexLogin()',cli.indexOf('function runSetup()')));
const answerSource=cli.slice(cli.indexOf('function answer()'),cli.indexOf('function runSetup()',cli.indexOf('function answer()')));
const drySource=cli.slice(cli.indexOf('function dryRun()'),cli.indexOf('function answer()',cli.indexOf('function dryRun()')));
function state(){return {installation_id:'192e9295-versioned',github_login:'owner',
  macos_setup_approved:true,target_repository:'owner/ChatGPT-Codex-Orchestrator-E2E-Target',
  reviewer_chat_url:'https://chatgpt.com/c/one',migration_intent_path:'/home/instance/migration-intent.json',
  migration_intent_phase:'PREPARED',last_error:{error_id:'SETUP-011',message:'previous'},
  macos_official_fresh_preparation_approval:{schema_version:1,challenge:'historic'},
  completed:[],github_plugin_authorized:true,macos_native_setup:'PREPARING'};}
function contextFor(opts={}){
  const current=opts.state||state(),events=[],calls=[],saved=[];
  const context={
    process:{platform:'darwin',arch:'arm64',cwd:()=>'/frozen-source'},
    os:{homedir:()=>'/home'},
    path:{join:(...x)=>x.join('/'),dirname:x=>x.split('/').slice(0,-1).join('/')},
    crypto:{randomUUID:()=> 'operation-01'},
    loadState:()=>current,ensureStateLanguage:()=> 'en',
    hasTrustedSingleUserReadinessProfileMarker:()=>false,
    hasTrustedSingleUserReadinessProfile:()=>true,
    isMacosReceiptContinuityCandidate:()=>true,
    isMacosChatHandoverCandidate:()=>false,
    macosReceiptContinuityInspection:()=>opts.inspection||{status:'PASS',authorized:true,
      source_commit:'c'.repeat(40),source_tree:'d'.repeat(40),binding_sha256:'e'.repeat(64)},
    emit:(value,code=0)=>{events.push({value,code});return {value,code};},
    emitMacosContinuityGate:value=>{events.push({value,code:1});return {value,code:1};},
    macosRecoveryReport:()=>({status:'CONFLICT',legacy_evidence_isolation:{reason:'rejected_partial_identity'}}),
    isMacosFreshFirstInstallBootstrap:()=>false,macosTrustedRecoveryEvidence:()=>({status:'ABSENT'}),
    macosFreshBootstrapMayAdvance:()=>false,macosBootstrapMayAdvance:()=>false,
    macosStateBound:()=>false,macosSelectedAwaitingFirstRoute:()=>false,
    findRegisteredChatRoute:()=>null,
    macosPrerequisites:()=>({node:true,git:true,gh:true,codex:true,session_auth:true,
      legacy_native_helper_gate:'NOT_APPLICABLE_SUPERSEDED',github_auth:true}),
    migrationPreflight:()=>assert.fail('Old migration preflight must not substitute for frozen old intent'),
    prepareMigrationIntent:()=>assert.fail('Old migration intent must not be regenerated'),
    authenticatedGithubLogin:()=> 'owner',
    safeKey:()=> 'e2e-target',
    auditMacosPrivatePreparationPaths:()=>({status:'PASS',issues:[]}),
    saveState:s=>{calls.push('persist');saved.push(structuredClone(s));},
    prepareControlEnvironment:()=>{calls.push('prepare Control/Sandbox');if(opts.throwPrepare)throw Error('synthetic failure');
      return {control_repository:'owner/control',sandbox_repository:'owner/sandbox',control_repository_id:'101',sandbox_repository_id:'202'};},
    verifyMacosGeneratedRepositories:()=>assert.fail('No connector authority yet'),
    MACOS_PRIVATE_CONTROL_LAYOUT_V2:'private-v2',
    commandExists:()=>({ok:true}),action:(s,a)=>({status:'NEEDS_USER_ACTION',action_id:a}),
    t:()=> 'synthetic',
    fs:{lstatSync:()=>{const e=new Error('missing');e.code='ENOENT';throw e;}},
    valueOf:()=>null,
    makeMacosReceiptContinuityReceipt:()=>null,
    MACOS_RECEIPT_CONTINUITY_ACTION:'macos_receipt_continuity_approval',
    MACOS_CHAT_HANDOVER_ACTION:'macos_chat_handover_approval',
    MACOS_CHAT_HANDOVER_RESUME_ACTION:'macos_chat_handover_resume_approval',
  };
  const global=vm.createContext(context);
  vm.runInContext(setupSource+'\nthis.execute=runSetup;',global);
  return {global,current,events,calls,saved};
}
test('G3 continuity CLI rejects missing new-source authority before any setup, journal, Git or Runner',()=>{
  for(const status of ['BLOCKED','NEEDS_USER_ACTION']){
    const f=contextFor({inspection:{status,error_id:'G3-CONTINUITY-REMOTE_EFFECTS_UNVERIFIED',
      action_id:status==='NEEDS_USER_ACTION'?'macos_receipt_continuity_approval':undefined}});
    f.global.execute();
    assert.equal(f.events.length,1);
    assert.equal(f.events[0].value.status,status);
    assert.deepEqual(f.calls,[]);
    assert.equal(Object.hasOwn(f.current,'macos_receipt_continuity_attempt'),false);
  }
});
test('G3 continuity CLI persists exact unique attempt BEFORE Control/Sandbox action, retaining original intent and approval',()=>{
  const f=contextFor(),oldApproval=JSON.stringify(f.current.macos_official_fresh_preparation_approval),oldIntent=f.current.migration_intent_path;
  f.global.execute();
  assert.deepEqual(f.calls,['persist','prepare Control/Sandbox','persist']);
  assert.equal(f.saved[0].macos_receipt_continuity_attempt.phase,'INTENT_RECORDED');
  assert.equal(f.saved[1].macos_receipt_continuity_attempt.phase,'CONTROL_PREPARED_AWAITING_CONNECTOR');
  assert.equal(f.saved[0].macos_receipt_continuity_attempt.operation_id,'operation-01');
  assert.equal(f.current.migration_intent_path,oldIntent);
  assert.equal(JSON.stringify(f.current.macos_official_fresh_preparation_approval),oldApproval);
  assert.equal(f.current.control_environment_ready,true);
  assert.equal(f.current.target_environment_ready,false);
  assert.equal(f.events.at(-1).value.action_id,'generated_repo_authorization');
});
test('G3 continuity CLI failed preparation records UNRECONCILED, never retries',()=>{
  const f=contextFor({throwPrepare:true});f.global.execute();
  assert.deepEqual(f.calls,['persist','prepare Control/Sandbox','persist']);
  assert.equal(f.current.macos_receipt_continuity_attempt.phase,'UNRECONCILED_AFTER_ATTEMPT');
  assert.equal(f.events.at(-1).value.error_id,'SETUP-011');
  assert.equal(f.events.at(-1).value.recoverable,false);
  assert.equal(f.current.control_environment_ready,undefined);
});
test('G3 CLI answer uses a new action and does not rewrite old approval',()=>{
  const start=state(),fresh={schema_version:1,action_id:'macos_receipt_continuity_approval',
    scope:'g3-failed-setup-retry-private-control-sandbox-only-v1',challenge:'exact',
    source_commit:'a'.repeat(40),source_tree:'b'.repeat(40),binding_sha256:'c'.repeat(64),approved_at:'2026-11-19T00:00:00Z'};
  const snapshot=JSON.stringify(start.macos_official_fresh_preparation_approval),saved=[],events=[];
  const context=vm.createContext({loadState:()=>start,ensureStateLanguage:()=> 'en',
    valueOf:name=>name==='--action'?'macos_receipt_continuity_approval':name==='--value'?'exact':null,
    isMacosReceiptContinuityCandidate:()=>true,
    MACOS_CHAT_HANDOVER_ACTION:'macos_chat_handover_approval',
    MACOS_CHAT_HANDOVER_RESUME_ACTION:'macos_chat_handover_resume_approval',
    macosReceiptContinuityInspection:()=>({status:'NEEDS_USER_ACTION',approval_challenge:'exact'}),
    makeMacosReceiptContinuityReceipt:()=>fresh,
    MACOS_RECEIPT_CONTINUITY_ACTION:'macos_receipt_continuity_approval',
    emit:v=>events.push(v),saveState:s=>saved.push(structuredClone(s)),t:()=> 'saved',
    process:{platform:'darwin'},os:{homedir:()=>'/home'}});
  vm.runInContext(answerSource+'\nthis.answerNow=answer;',context);
  context.answerNow();
  assert.equal(saved.length,1);
  assert.equal(JSON.stringify(start.macos_official_fresh_preparation_approval),snapshot);
  assert.equal(start.macos_receipt_continuity_approval,fresh);
  assert.equal(events[0].status,'PASS');
});
test('G3 CLI dry-run checks continuity before legacy processing or prerequisites',()=>{
  const events=[],ctx=vm.createContext({process:{platform:'darwin'},loadState:()=>state(),
    ensureStateLanguage:()=> 'en',isMacosReceiptContinuityCandidate:()=>true,
    isMacosChatHandoverCandidate:()=>false,
    macosReceiptContinuityInspection:()=>({status:'BLOCKED',error_id:'G3-CONTINUITY-REMOTE_EFFECTS_UNVERIFIED'}),
    emitMacosContinuityGate:v=>events.push(v),macosRecoveryReport:()=>assert.fail('unexpected legacy fallback')});
  vm.runInContext(drySource+'\nthis.check=dryRun;',ctx);ctx.check();
  assert.equal(events.length,1);assert.equal(events[0].status,'BLOCKED');
});
