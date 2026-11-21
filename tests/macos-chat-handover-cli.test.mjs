import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const cli=fs.readFileSync(new URL('../src/cli.mjs',import.meta.url),'utf8');
const setup=cli.slice(cli.indexOf('function runSetup()'),cli.indexOf('function codexLogin()',cli.indexOf('function runSetup()')));
const answer=cli.slice(cli.indexOf('function answer()'),cli.indexOf('function runSetup()',cli.indexOf('function answer()')));
const dry=cli.slice(cli.indexOf('function dryRun()'),cli.indexOf('function answer()',cli.indexOf('function dryRun()')));
const recovery=cli.slice(cli.indexOf('function recoveryPreflight()'),cli.indexOf('function reportProblem()',cli.indexOf('function recoveryPreflight()')));
const FORMER='https://chatgpt.com/g/my-project/c/11111111-1111-1111-1111-111111111111';
const NEW='https://chatgpt.com/g/my-project/c/22222222-2222-2222-2222-222222222222';
function state(){return {installation_id:'192e9295-frozen',github_login:'owner',
  macos_setup_approved:true,target_repository:'owner/ChatGPT-Codex-Orchestrator-E2E-Target',
  reviewer_chat_url:FORMER,migration_intent_path:'/home/instance/migration-intent.json',
  migration_intent_phase:'PREPARED',last_error:{error_id:'SETUP-011',message:'old'},
  macos_official_fresh_preparation_approval:{schema_version:1,challenge:'old-unmodified'},
  macos_receipt_continuity_approval:{schema_version:1,challenge:'old-version-unmodified'},
  completed:[],github_plugin_authorized:true,macos_native_setup:'PREPARING'};}
function inspected({status='PASS',authorized=true}={}){return {status,authorized,source_commit:'3'.repeat(40),
  source_tree:'4'.repeat(40),binding_sha256:'5'.repeat(64),handover_challenge:'macos-chat-handover-v1:'+'6'.repeat(64),
  predecessor_chat_url:FORMER,successor_chat_url:NEW};}
function setupCtx(opts={}){
  const current=opts.state||state(),calls=[],saved=[],events=[];
  const inspect=()=>opts.inspection||inspected();
  const context=vm.createContext({
    process:{platform:'darwin',arch:'arm64',cwd:()=>'/approved-new-source'},
    os:{homedir:()=>'/home'},
    path:{join:(...parts)=>parts.join('/'),dirname:p=>p.split('/').slice(0,-1).join('/')},
    crypto:{randomUUID:()=> 'attempt-unique',createHash:()=>({update(text){this.text=text;return this;},digest:()=> 'a'.repeat(64)})},
    loadState:()=>current,ensureStateLanguage:()=> 'en',
    hasTrustedSingleUserReadinessProfileMarker:()=>false,
    hasTrustedSingleUserReadinessProfile:()=>true,
    isMacosChatHandoverCandidate:()=>true,macosChatHandoverInspection:inspect,
    isMacosReceiptContinuityCandidate:()=>true,macosReceiptContinuityInspection:()=>assert.fail('No old receipt may authorize new Chat'),
    emit:(value,code=0)=>{events.push({value,code});return {value,code};},
    emitMacosHandoverGate:value=>{events.push({value,code:1});return {value,code:1};},
    emitMacosContinuityGate:()=>assert.fail('No continuity route fallback'),
    macosRecoveryReport:()=>({status:'CONFLICT',legacy_evidence_isolation:{reason:'rejected_historical'}}),
    isMacosFreshFirstInstallBootstrap:()=>false,macosTrustedRecoveryEvidence:()=>({status:'ABSENT'}),
    macosFreshBootstrapMayAdvance:()=>false,macosBootstrapMayAdvance:()=>false,
    macosStateBound:()=>false,macosSelectedAwaitingFirstRoute:()=>false,findRegisteredChatRoute:()=>null,
    macosPrerequisites:()=>({node:true,git:true,gh:true,codex:true,session_auth:true,
      legacy_native_helper_gate:'NOT_APPLICABLE_SUPERSEDED',github_auth:true}),
    migrationPreflight:()=>assert.fail('No new intent'),
    prepareMigrationIntent:()=>assert.fail('Do not overwrite historical intent'),
    authenticatedGithubLogin:()=> 'owner',safeKey:()=> 'e2e-target',
    auditMacosPrivatePreparationPaths:()=>({status:'PASS',issues:[]}),
    saveState:s=>{calls.push('persist');saved.push(structuredClone(s));},
    prepareControlEnvironment:params=>{calls.push('prepare');
      assert.equal(params.reviewerChatUrl,NEW,'never register exhausted predecessor');
      assert.equal(saved[0].reviewer_chat_url,NEW,'successor recorded before any external effect');
      assert.equal(saved[0].macos_chat_handover_applied.source_commit,'3'.repeat(40));
      assert.equal(saved[0].macos_receipt_continuity_attempt.phase,'INTENT_RECORDED');
      if(opts.throwPrepare)throw Error('fixture-side-effect-unknown');
      return {control_repository:'owner/new-control',sandbox_repository:'owner/new-sandbox'};},
    MACOS_PRIVATE_CONTROL_LAYOUT_V2:'private-v2',
    commandExists:()=>({ok:true}),action:(s,a)=>({status:'NEEDS_USER_ACTION',action_id:a}),
    t:()=> 'fixture',
    fs:{lstatSync:()=>{const x=new Error('missing');x.code='ENOENT';throw x;}},
    valueOf:()=>undefined,
    MACOS_CHAT_HANDOVER_ACTION:'macos_chat_handover_approval',
    MACOS_CHAT_HANDOVER_RESUME_ACTION:'macos_chat_handover_resume_approval'
  });
  vm.runInContext(setup+'\nthis.execute=runSetup;',context);
  return {context,current,calls,saved,events};
}

test('CLI successor: absent or unapproved handover blocks before journal or Github effects',()=>{
  for(const report of [inspected({status:'BLOCKED',authorized:false}),
    {...inspected({status:'NEEDS_USER_ACTION',authorized:false}),action_id:'macos_chat_handover_approval'},
    {...inspected({status:'NEEDS_USER_ACTION',authorized:false}),action_id:'macos_chat_handover_resume_approval'}]){
    const f=setupCtx({inspection:report});f.context.execute();
    assert.deepEqual(f.calls,[]);assert.equal(f.events.length,1);
    assert.equal(f.events[0].value.status,report.status);
    assert.equal(f.current.reviewer_chat_url,FORMER);
    assert.equal(f.current.macos_receipt_continuity_attempt,undefined);
  }
});

test('CLI successor: original URL and receipts retained until same atomic write as once-attempt',()=>{
  const f=setupCtx(),oldReceipt=structuredClone(f.current.macos_receipt_continuity_approval);
  f.context.execute();
  assert.deepEqual(f.calls,['persist','prepare','persist']);
  assert.equal(f.saved[0].reviewer_chat_url,NEW);
  assert.equal(f.saved[0].macos_receipt_continuity_attempt.operation_id,'attempt-unique');
  assert.equal(f.saved[0].macos_receipt_continuity_attempt.phase,'INTENT_RECORDED');
  assert.equal(f.saved[1].macos_receipt_continuity_attempt.phase,'CONTROL_PREPARED_AWAITING_CONNECTOR');
  assert.equal(f.current.target_environment_ready,false);
  assert.equal(f.current.review_route,undefined);
  assert.equal(f.current.sandbox_review_route,undefined);
  assert.equal(f.current.macos_runner_bootstrap,undefined);
  assert.equal(f.current.macos_runner_activation,undefined);
  assert.deepEqual(f.current.macos_receipt_continuity_approval,oldReceipt);
  assert.equal(f.events.at(-1).value.action_id,'generated_repo_authorization');
});

test('CLI successor: failed Control preparation preserves UNRECONCILED attempt, no fallback or retry',()=>{
  const f=setupCtx({throwPrepare:true});f.context.execute();
  assert.deepEqual(f.calls,['persist','prepare','persist']);
  assert.equal(f.current.macos_receipt_continuity_attempt.phase,'UNRECONCILED_AFTER_ATTEMPT');
  assert.equal(f.events.at(-1).value.error_id,'SETUP-011');
  assert.equal(f.events.at(-1).value.recoverable,false);
  assert.equal(f.current.reviewer_chat_url,NEW);
});

test('CLI successor: two answer actions write distinct receipts without changing predecessor or intent',()=>{
  for(const action of ['macos_chat_handover_approval','macos_chat_handover_resume_approval']){
    const current=state(),events=[],saved=[];
    const record={action_id:action,challenge:'exact',approved_at:'2026-11-20T00:00:00Z'};
    const context=vm.createContext({
      loadState:()=>current,ensureStateLanguage:()=> 'en',
      valueOf:k=>k==='--action'?action:k==='--value'?'exact':k==='--successor-chat-url'?NEW:null,
      isMacosChatHandoverCandidate:()=>true,
      macosChatHandoverInspection:()=>({status:'NEEDS_USER_ACTION',action_id:action,approval_challenge:'exact'}),
      makeMacosChatHandoverReceipt:()=>record,
      makeMacosChatHandoverResumeReceipt:()=>record,
      MACOS_CHAT_HANDOVER_ACTION:'macos_chat_handover_approval',
      MACOS_CHAT_HANDOVER_RESUME_ACTION:'macos_chat_handover_resume_approval',
      saveState:s=>saved.push(structuredClone(s)),emit:v=>events.push(v),t:()=> 'saved',
      process:{platform:'darwin'},os:{homedir:()=>'/home'}
    });
    vm.runInContext(answer+'\nthis.execute=answer;',context);context.execute();
    assert.equal(saved.length,1);assert.equal(events[0].status,'PASS');
    assert.equal(current.reviewer_chat_url,FORMER);
    assert.equal(current.migration_intent_path,'/home/instance/migration-intent.json');
    assert.equal(current.macos_receipt_continuity_approval.challenge,'old-version-unmodified');
    const savedField=action==='macos_chat_handover_approval'?'macos_chat_handover_approval':'macos_chat_handover_resume_approval';
    assert.equal(current[savedField],record);
  }
});

test('CLI successor: dry-run/recovery preflight prioritize the successor gate, not original Chat continuity',()=>{
  for(const [source,fn] of [[dry,'dryRun'],[recovery,'recoveryPreflight']]){
    const events=[],context=vm.createContext({
      process:{platform:'darwin'},loadState:()=>state(),ensureStateLanguage:()=> 'en',
      isMacosChatHandoverCandidate:()=>true,
      macosChatHandoverInspection:()=>({status:'NEEDS_USER_ACTION',action_id:'macos_chat_successor_url'}),
      emitMacosHandoverGate:result=>events.push(result),
      isMacosReceiptContinuityCandidate:()=>assert.fail('old continuity fallback'),
      macosRecoveryReport:()=>assert.fail('legacy recovery fallback')
    });
    vm.runInContext(source+`\nthis.verify=${fn};`,context);context.verify();
    assert.equal(events[0].action_id,'macos_chat_successor_url');
  }
});

test('CLI successor: failure during journal persistence cannot call prepareControlEnvironment',()=>{
  const f=setupCtx();
  f.context.saveState=()=>{throw Error('state revision conflict');};
  f.context.execute();
  assert.deepEqual(f.calls,[]);
  assert.equal(f.events.at(-1).value.error_id,'MACOS-MIGRATION-INTENT');
});

test('CLI successor: private URLs are removed from emitted JSON, never default to previous Chat route',()=>{
  const a=cli.indexOf('function emitMacosHandoverGate('),b=cli.indexOf('function emitMacosContinuityGate(',a);
  assert.ok(a>0&&b>a);
  const expr=cli.slice(a,b);
  const emitted=[];
  const context=vm.createContext({emit:(x,code)=>{emitted.push({x,code});return x;}});
  vm.runInContext(expr+'\nthis.show=emitMacosHandoverGate;',context);
  context.show(inspected());
  assert.equal(JSON.stringify(emitted).includes(FORMER),false);
  assert.equal(JSON.stringify(emitted).includes(NEW),false);
  assert.equal(emitted[0].x.installation_authorized,true);
});
