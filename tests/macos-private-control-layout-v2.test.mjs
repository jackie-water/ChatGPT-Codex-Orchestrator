import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultLocalPaths, MACOS_PRIVATE_CONTROL_LAYOUT_V2 as V2 } from '../src/lib/control-render.mjs';
import { auditMacosPrivatePreparationPaths } from '../src/lib/control-env.mjs';
import { inspectMacosExistingInstanceRecovery } from '../src/lib/macos-existing-instance-recovery.mjs';

const installationId='192e9295-fixture';
const projectKey='chatgpt-codex-orchestrator-e2e-target';
function makeFixture(t) {
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cco-private-control-v2-'));
  fs.chmodSync(home,0o700);
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const options={home,installationId,projectKey};
  const base=path.join(home,'.chatgpt-codex-orchestrator','instances','192e9295');
  const legacy=defaultLocalPaths({...options,platform:'darwin'});
  const modern=defaultLocalPaths({...options,platform:'darwin',macosControlLayout:V2});
  const audit=()=>auditMacosPrivatePreparationPaths({...options,macosControlLayout:V2});
  return {home,base,options,legacy,modern,audit};
}
function mk(dir,mode=0o700){fs.mkdirSync(dir,{recursive:true,mode});fs.chmodSync(dir,mode)}
function roleIssues(result,role){return result.issues.filter(x=>x.role===role)}

test('v2 private Control is in canonical instance and historical v1 and Windows remain byte-for-byte path-compatible',t=>{
  const f=makeFixture(t);
  assert.equal(f.modern.control,path.join(f.base,'control'));
  assert.equal(f.legacy.control,path.join(f.home,'ChatGPTCodexOrchestrator','control-192e9295'));
  assert.equal(f.modern.project,f.legacy.project);
  const win=defaultLocalPaths({...f.options,platform:'win32'});
  assert.equal(win.control,f.legacy.control);
  assert.equal(win.runner,path.join(f.home,'ChatGPTCodexOrchestrator','runner-192e9295'));
  assert.equal(win.project,path.join(f.home,'ChatGPTCodexProjects',projectKey));
});

test('v2 rejects invalid versions and cross-platform use without changing state',t=>{
  const f=makeFixture(t);
  for (const invalid of ['v2','V2','legacy-v1','',true,0]) {
    assert.throws(()=>defaultLocalPaths({...f.options,platform:'darwin',macosControlLayout:invalid}),/Unrecognized/);
  }
  assert.throws(()=>defaultLocalPaths({...f.options,platform:'win32',macosControlLayout:V2}),/cross-platform/);
});

test('read-only inventory includes all six scoped path roles, does not create missing leaves and is JSON-data safe',t=>{
  const f=makeFixture(t);
  const before=fs.readdirSync(f.home);
  const report=f.audit();
  assert.equal(report.status,'PASS');
  assert.deepEqual(report.issues,[]);
  assert.deepEqual(report.observed.map(x=>x.role),['instance_root','automation_parent','control_parent','control_clone','browser_profile','pending_wakes']);
  assert.deepEqual(fs.readdirSync(f.home),before);
  assert.equal(report.mutations_performed,false);
  assert.ok(!JSON.stringify(report).includes(f.home));
});

test('unrelated pre-existing v1 shared parent stays untouched and does not veto v2',t=>{
  const f=makeFixture(t);
  const dir=path.join(f.home,'ChatGPTCodexOrchestrator');mk(dir,0o755);
  fs.writeFileSync(path.join(dir,'historical-unrelated.txt'),'preserve');
  const before=fs.lstatSync(dir);
  assert.equal(f.audit().status,'PASS');
  assert.equal(fs.lstatSync(dir).mode,before.mode);
  assert.equal(fs.readFileSync(path.join(dir,'historical-unrelated.txt'),'utf8'),'preserve');
});

test('exact same-installation v1 clone refuses a v2 takeover even if privately owned',t=>{
  const f=makeFixture(t);mk(f.legacy.control);
  assert.deepEqual(roleIssues(f.audit(),'legacy_control_clone'),[{role:'legacy_control_clone',reason:'existing_v1_binding_requires_separate_migration'}]);
});

test('v2 existing empty private Control can be retained without mutation',t=>{
  const f=makeFixture(t);mk(f.modern.control);
  const before=fs.lstatSync(f.modern.control);
  assert.equal(f.audit().status,'PASS');
  assert.equal(fs.lstatSync(f.modern.control).ino,before.ino);
});

for(const [name,make,reason] of [
  ['world-readable Control',f=>{mk(f.modern.control,0o755)},'existing_leaf_not_private'],
  ['group-writable Control',f=>{mk(f.modern.control,0o770)},'unsafe_writable_ancestor'],
  ['non-directory Control',f=>{mk(f.base);fs.writeFileSync(f.modern.control,'x')},'not_directory'],
  ['symlink Control',f=>{mk(f.base);const outside=path.join(f.home,'outside');mk(outside);fs.symlinkSync(outside,f.modern.control)},'symlink'],
  ['symlink ancestor',f=>{mk(path.dirname(f.base));const outside=path.join(f.home,'outside');mk(outside);fs.symlinkSync(outside,f.base)},'symlink'],
  ['world-writable instance',f=>{mk(f.base,0o777)},'unsafe_writable_ancestor'],
  ['unreadable automation parent',f=>{mk(path.dirname(f.modern.project),0o755)},'existing_leaf_not_private'],
  ['browser profile unsafe',f=>{mk(path.join(f.base,'browser-profile'),0o755)},'existing_leaf_not_private'],
  ['pending outbox unsafe',f=>{mk(path.join(f.base,'pending-wakes'),0o755)},'existing_leaf_not_private'],
]) test(`v2 audit rejects ${name} before mutation`,t=>{
  const f=makeFixture(t);try{make(f)}catch(e){if(['EPERM','EACCES'].includes(e.code))return t.skip('symlinks unavailable');throw e}
  const report=f.audit();
  assert.equal(report.status,'BLOCKED');
  assert.ok(report.issues.some(x=>x.reason===reason),JSON.stringify(report.issues));
  assert.equal(report.mutations_performed,false);
});

test('v2 inventory enumerates independent violations instead of only reporting the first',t=>{
  const f=makeFixture(t);
  mk(path.dirname(f.modern.project),0o755);
  mk(path.join(f.base,'browser-profile'),0o755);
  mk(path.join(f.base,'pending-wakes'),0o755);
  const report=f.audit();
  assert.equal(report.status,'BLOCKED');
  for(const role of ['automation_parent','browser_profile','pending_wakes'])
    assert.ok(report.issues.some(x=>x.role===role),role);
  assert.equal(report.mutations_performed,false);
});

test('v2 inventory rejects fabricated read-error and foreign-owner stat metadata',t=>{
  const f=makeFixture(t);mk(f.base);
  const original=fs.lstatSync;
  const statImpl={lstatSync(p){const st=original(p);if(p===f.base) return Object.assign(Object.create(Object.getPrototypeOf(st)),st,{uid:(process.getuid?.()??0)+4567});return st;}};
  const report=auditMacosPrivatePreparationPaths({...f.options,macosControlLayout:V2,fsImpl:statImpl});
  assert.equal(report.status,'BLOCKED');
  assert.ok(report.issues.some(x=>x.reason==='foreign_owner'));
  const deny={lstatSync(p){if(p===f.base){const e=new Error('Denied');e.code='EACCES';throw e;}return original(p)}};
  const x=auditMacosPrivatePreparationPaths({...f.options,macosControlLayout:V2,fsImpl:deny});
  assert.ok(x.issues.some(y=>y.reason==='stat_failed'));
});

test('v2 inventory rejects noncanonical HOME without touching directories',t=>{
  const f=makeFixture(t);
  const x=auditMacosPrivatePreparationPaths({...f.options,home:f.home+'/../'+path.basename(f.home),macosControlLayout:V2});
  assert.deepEqual(x.issues,[{role:'home',reason:'noncanonical_home'}]);
});

test('existing-instance classification keeps the old no-marker contract for v1 trees',t=>{
  const f=makeFixture(t);const root=path.join(f.home,'.chatgpt-codex-orchestrator');mk(root);mk(path.join(root,'instances'));
  const result=inspectMacosExistingInstanceRecovery({home:f.home});
  assert.equal(result.status,'ABSENT');
});

test('actual Darwin file types and modes match v2 private directory rules', {skip:process.platform!=='darwin'}, t=>{
  const f=makeFixture(t);mk(f.modern.control);
  assert.equal(f.audit().status,'PASS');
  fs.chmodSync(f.modern.control,0o755);
  assert.equal(f.audit().status,'BLOCKED');
});

test('instance inventory accepts passive Control checkout only when v2 marker binds current instance',t=>{
  const f=makeFixture(t);
  mk(path.join(f.home,'.chatgpt-codex-orchestrator'));
  mk(path.join(f.home,'.chatgpt-codex-orchestrator','instances'));
  mk(f.modern.control);
  mk(path.join(f.modern.control,'.git'),0o755);
  fs.writeFileSync(path.join(f.modern.control,'.git','HEAD'),'ref: refs/heads/main\n',{mode:0o644});
  fs.chmodSync(path.join(f.modern.control,'.git','HEAD'),0o644);
  fs.writeFileSync(path.join(f.modern.control,'README.md'),'inert private checkout',{mode:0o644});
  fs.chmodSync(path.join(f.modern.control,'README.md'),0o644);
  const baseState={instance_id:'192e9295',installation_id:installationId};
  const v2=inspectMacosExistingInstanceRecovery({home:f.home,state:{...baseState,macos_control_layout:V2}});
  assert.equal(v2.status,'NEEDS_VERIFICATION');
  const v1=inspectMacosExistingInstanceRecovery({home:f.home,state:baseState});
  assert.equal(v1.status,'CONFLICT');
});

test('new layout cannot become a trusted path without a persisted exact marker',t=>{
  const f=makeFixture(t);
  const state={instance_id:'192e9295',installation_id:installationId,macos_control_layout:'invalid-v7'};
  mk(path.join(f.home,'.chatgpt-codex-orchestrator'));
  mk(path.join(f.home,'.chatgpt-codex-orchestrator','instances'));
  mk(f.base);
  const result=inspectMacosExistingInstanceRecovery({home:f.home,state});
  assert.equal(result.status,'CONFLICT');
  assert.ok(result.missing_verification_gates.includes('control_layout_version'));
});

test('CLI official setup selects v2 only for a validated fresh continuation and preserves a pinned layout', async t=>{
  const vm=await import('node:vm');
  const script=fs.readFileSync(new URL('../src/cli.mjs',import.meta.url),'utf8');
  const begin=script.indexOf('const control=prepareControlEnvironment({installationId:state.installation_id');
  const finish=script.indexOf('}); Object.assign(state,control',begin);
  assert.ok(begin>0&&finish>begin);
  const fragment=script.slice(begin,finish+2);
  const capture=(fresh,layout)=>{
    const state={installation_id:installationId,target_repository:'owner/target',reviewer_chat_url:'https://chatgpt.com/c/current',github_login:'owner',macos_setup_approved:true};
    if(layout!==undefined)state.macos_control_layout=layout;
    let answer;
    const context={state,freshFirstInstallAfterApproval:fresh,MACOS_PRIVATE_CONTROL_LAYOUT_V2:V2,
      process:{cwd:()=>'/synthetic/source'},os:{homedir:()=>'/synthetic/home'},prepareControlEnvironment:x=>{answer=x;return x}};
    vm.runInNewContext(fragment,context);
    return answer;
  };
  assert.equal(capture(true).macosControlLayout,V2);
  assert.equal(capture(false).macosControlLayout,null);
  assert.equal(capture(false,V2).macosControlLayout,V2);
  assert.equal(capture(true,'bad-version').macosControlLayout,'bad-version');
});
