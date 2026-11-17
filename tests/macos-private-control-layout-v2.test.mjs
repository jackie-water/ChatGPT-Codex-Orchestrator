import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
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

// G3-RV-01/RV-02: a directory mode cannot authorize a pre-existing checkout.
// The Git fixture is confined to a per-test temporary HOME and never fetches
// or pushes. The historical 476 Mac test result is not replayed here.
function localControlFixture(t,{layout=null,mode=0o700}={}) {
  const f=makeFixture(t);
  const control=layout===V2?f.modern.control:f.legacy.control;
  mk(control,0o700);
  const repo='owner/chatgpt-codex-orchestrator-control-192e9295';
  const sandbox='owner/chatgpt-codex-orchestrator-sandbox-192e9295';
  const metadata={schema_version:1,instance_id:'192e9295',installation_id:installationId,
    platform:'darwin',arch:'arm64',role:'control',trusted_github_username:'owner',
    control_repository:repo,sandbox_repository:sandbox,
    origin:`https://github.com/${repo}.git`,remote_origin:`https://github.com/${repo}.git`,
    ...(layout===V2?{macos_control_layout:V2}:{})};
  const args=['init','-q'];
  const git=(...argv)=>{
    const child=spawnSync('git',['-C',control,...argv],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}});
    assert.equal(child.status,0,`${argv.join(' ')}: ${child.stderr}`);
    return child.stdout.trim();
  };
  git(...args);
  git('remote','add','origin',`https://github.com/${repo}.git`);
  const metadataFile=path.join(control,'instance.json');
  fs.writeFileSync(metadataFile,JSON.stringify(metadata,null,2)+'\n',{mode:0o600});
  fs.chmodSync(metadataFile,0o600);
  git('add','instance.json');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','local fixture only');
  fs.chmodSync(control,mode);
  const audit=(extra={})=>auditMacosPrivatePreparationPaths({
    ...f.options,macosControlLayout:layout,expectedGithubLogin:'owner',...extra
  });
  return {...f,control,metadata,metadataFile,repo,sandbox,git,audit};
}

test('G3-RV-01 allows exactly bound legacy v1 Control checkout 0755 under private parent, without chmod or git mutation',t=>{
  const f=localControlFixture(t,{mode:0o755});
  assert.equal(fs.lstatSync(path.dirname(f.control)).mode&0o777,0o700);
  const before={mode:fs.statSync(f.control).mode,index:fs.statSync(path.join(f.control,'.git','index')).mtimeMs,
    metadata:fs.readFileSync(f.metadataFile)};
  const x=f.audit();
  assert.equal(x.status,'PASS',JSON.stringify(x.issues));
  assert.deepEqual(x.issues,[]);
  assert.equal(x.mutations_performed,false);
  assert.equal(fs.statSync(f.control).mode,before.mode);
  assert.equal(fs.statSync(path.join(f.control,'.git','index')).mtimeMs,before.index);
  assert.deepEqual(fs.readFileSync(f.metadataFile),before.metadata);
  assert.ok(!JSON.stringify(x).includes(f.home));
});

test('G3-RV-01 v1 allowlist does not extend to v2 Control checkout 0755',t=>{
  const f=localControlFixture(t,{layout:V2,mode:0o755});
  assert.deepEqual(roleIssues(f.audit(),'control_clone'),[{role:'control_clone',reason:'existing_leaf_not_private'}]);
});

test('G3-RV-01 approved v1 0755 directory can be traversed by private preparer without changing its mode',async t=>{
  const f=localControlFixture(t,{mode:0o755});
  const vm=await import('node:vm');
  const src=fs.readFileSync(new URL('../src/lib/control-env.mjs',import.meta.url),'utf8');
  const start=src.indexOf('function preparePrivateMacDirectory('),end=src.indexOf('\nfunction ensureClone(',start);
  assert.ok(start>=0&&end>start);
  const fn=vm.runInNewContext(src.slice(start,end)+'\npreparePrivateMacDirectory;',{fs,path,process,Error});
  const mode=fs.statSync(f.control).mode;
  fn(f.control,f.home,{verifiedLegacyControl:f.control});
  assert.equal(fs.statSync(f.control).mode,mode);
  assert.throws(()=>fn(f.control,f.home,{}),/Unsafe macOS private installation path/);
});

test('G3-RV-01 rejects wrong legacy metadata, owner, layout, origin and unsafe modes',t=>{
  const f=localControlFixture(t,{mode:0o755});
  for(const [key,wrong] of [['installation_id','wrong-identity'],['instance_id','different'],['role','sandbox'],
    ['trusted_github_username','intruder'],['control_repository','owner/wrong-control'],
    ['sandbox_repository','owner/wrong-sandbox'],['origin','https://github.com/foreign/repo.git'],
    ['remote_origin','https://github.com/foreign/repo.git'],['macos_control_layout',V2]]){
    fs.writeFileSync(f.metadataFile,JSON.stringify({...f.metadata,[key]:wrong})+'\n',{mode:0o600});
    assert.ok(roleIssues(f.audit(),'control_clone').some(x=>x.reason==='existing_control_metadata_mismatch'),key);
  }
  fs.writeFileSync(f.metadataFile,JSON.stringify(f.metadata)+'\n',{mode:0o600});
  const original=fs.lstatSync;
  const owned={...fs,lstatSync(p){const st=original(p);return p===f.control?Object.assign(Object.create(Object.getPrototypeOf(st)),st,{uid:(process.getuid?.()??0)+231}):st;}};
  assert.ok(roleIssues(f.audit({fsImpl:owned}),'control_clone').some(x=>x.reason==='foreign_owner'));
  for(const mode of [0o777,0o775,0o1755,0o6755]){
    fs.chmodSync(f.control,mode);
    assert.equal(f.audit().status,'BLOCKED',`mode=${mode.toString(8)}`);
  }
  fs.chmodSync(f.control,0o755);
  assert.equal(fs.statSync(f.control).mode&0o777,0o755);
});

test('G3-RV-01 rejects symlink metadata, unsafe metadata mode and an unbound 0755 v1 directory',t=>{
  const f=localControlFixture(t,{mode:0o755});
  fs.chmodSync(f.metadataFile,0o644);
  assert.ok(roleIssues(f.audit(),'control_clone').some(x=>x.reason==='existing_control_identity_unsafe'));
  fs.chmodSync(f.metadataFile,0o600);
  const saved=fs.readFileSync(f.metadataFile);
  fs.unlinkSync(f.metadataFile);
  fs.symlinkSync(path.join(f.home,'missing-other'),f.metadataFile);
  assert.ok(roleIssues(f.audit(),'control_clone').some(x=>x.reason==='existing_control_identity_unsafe'));
  fs.unlinkSync(f.metadataFile);
  fs.writeFileSync(f.metadataFile,saved,{mode:0o600});
  fs.unlinkSync(f.metadataFile);
  assert.ok(roleIssues(f.audit(),'control_clone').some(x=>x.reason==='existing_control_unbound'));
});

test('G3-RV-02 rejects missing v2 instance marker before any target/Sandbox directory exists',t=>{
  const f=makeFixture(t);
  mk(path.join(f.modern.control,'.git'));
  fs.writeFileSync(path.join(f.modern.control,'.git','config'),'[remote "origin"]\n url = https://github.com/foreign/another-repo.git\n');
  const x=f.audit();
  assert.equal(x.status,'BLOCKED');
  assert.deepEqual(roleIssues(x,'control_clone'),[{role:'control_clone',reason:'existing_control_unbound'}]);
  assert.equal(fs.existsSync(f.modern.project),false);
  assert.equal(fs.existsSync(path.join(f.base,'automation','sandbox-192e9295')),false);
});

test('G3-RV-02 rejects foreign Git remote even with valid metadata before side effects',t=>{
  const f=localControlFixture(t,{layout:V2});
  f.git('remote','set-url','origin','https://github.com/foreign/wrong.git');
  assert.deepEqual(roleIssues(f.audit(),'control_clone'),[{role:'control_clone',reason:'existing_control_foreign_origin'}]);
  assert.equal(fs.existsSync(f.modern.project),false);
});

test('G3-RV-02 rejects dirty or partially initialized checkout and supports clean marker-bound v2 recovery',t=>{
  const f=localControlFixture(t,{layout:V2});
  assert.equal(f.audit().status,'PASS');
  fs.writeFileSync(path.join(f.control,'unfinished.txt'),'preserve');
  assert.deepEqual(roleIssues(f.audit(),'control_clone'),[{role:'control_clone',reason:'existing_control_dirty'}]);
  assert.equal(fs.readFileSync(path.join(f.control,'unfinished.txt'),'utf8'),'preserve');
});

test('G3-RV-02 refuses unknown nonempty v2 directory while accepting an empty 0700 checkout',t=>{
  const f=makeFixture(t);
  mk(f.modern.control);
  assert.equal(f.audit().status,'PASS');
  fs.writeFileSync(path.join(f.modern.control,'orphan.bin'),'intact');
  assert.deepEqual(roleIssues(f.audit(),'control_clone'),[{role:'control_clone',reason:'existing_control_unbound'}]);
  assert.equal(fs.readFileSync(path.join(f.modern.control,'orphan.bin'),'utf8'),'intact');
});

test('G3-RV-02 a symlinked Git config or .git directory never supplies Control authority',t=>{
  const f=localControlFixture(t,{layout:V2});
  const config=path.join(f.control,'.git','config'),bytes=fs.readFileSync(config);
  fs.unlinkSync(config); fs.symlinkSync(path.join(f.home,'foreign-config'),config);
  assert.ok(roleIssues(f.audit(),'control_clone').some(x=>x.reason==='existing_control_identity_unsafe'));
  fs.unlinkSync(config);fs.writeFileSync(config,bytes);
  const gitdir=path.join(f.control,'.git'), moved=path.join(f.home,'moved-git');
  fs.renameSync(gitdir,moved);fs.symlinkSync(moved,gitdir);
  assert.ok(roleIssues(f.audit(),'control_clone').some(x=>x.reason==='existing_control_identity_unsafe'));
});

test('G3-RV-02 production prepare rejects orphan Control before gh remote create/clone and before new private directories',t=>{
  const f=makeFixture(t),fakeBin=path.join(f.home,'synthetic-bin'),log=path.join(f.home,'mock-gh-requests.txt');
  fs.mkdirSync(fakeBin,{mode:0o700});
  const gh=path.join(fakeBin,'gh');
  fs.writeFileSync(gh,`#!/bin/sh\nprintf '%s\\n' "$*" >> "$GH_LOG"\nif [ "$1" = api ] && [ "$2" = user ]; then printf 'owner\\n'; exit 0; fi\nif [ "$1" = repo ] && [ "$2" = view ]; then printf '%s\\n' '{"nameWithOwner":"owner/target","defaultBranchRef":{"name":"main"},"visibility":"PRIVATE"}'; exit 0; fi\nexit 95\n`,{mode:0o700});fs.chmodSync(gh,0o700);
  mk(path.join(f.modern.control,'.git'));
  fs.writeFileSync(path.join(f.modern.control,'.git','config'),'[remote "origin"]\n url = https://github.com/foreign/another-repo.git\n');
  const script=`import {prepareControlEnvironment} from ${JSON.stringify(new URL('../src/lib/control-env.mjs',import.meta.url).href)};
Object.defineProperty(process,'platform',{configurable:true,value:'darwin'});
Object.defineProperty(process,'arch',{configurable:true,value:'arm64'});
try{prepareControlEnvironment({installationId:${JSON.stringify(installationId)},targetRepository:'owner/target',
reviewerChatUrl:'https://chatgpt.com/c/original',trustedGithubLogin:'owner',macosSetupApproved:true,
sourceRoot:${JSON.stringify(f.home)},home:${JSON.stringify(f.home)},macosControlLayout:${JSON.stringify(V2)}});
console.log(JSON.stringify({status:'UNEXPECTED_PASS'}));}
catch(error){console.log(JSON.stringify({status:'BLOCKED',code:String(error.message).split(':')[0],
reason:String(error.message).includes('existing_control_unbound')?'existing_control_unbound':'OTHER'}));}`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:f.home,encoding:'utf8',env:{...process.env,PATH:fakeBin+path.delimiter+process.env.PATH,GH_LOG:log},timeout:15000
  });
  assert.equal(child.status,0,child.stderr);
  const result=JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(result,{status:'BLOCKED',code:'MACOS-PRIVATE-PATH-AUDIT',reason:'existing_control_unbound'});
  assert.equal(fs.readFileSync(log,'utf8').trim().split(/\r?\n/).length,2);
  assert.doesNotMatch(fs.readFileSync(log,'utf8'),/repo create|repo clone|git fetch/);
  assert.equal(fs.existsSync(f.modern.project),false);
  assert.equal(fs.existsSync(path.join(f.base,'browser-profile')),false);
  assert.equal(fs.existsSync(path.join(f.base,'pending-wakes')),false);
  assert.equal(fs.existsSync(path.join(f.base,'automation')),false);
});

// G3-RV-04: A clean-state check is NOT allowed to execute Git extensions.
// All fixtures are per-test local Git repositories; no network or real setup.
function rv04ExternalProgram(f,name,marker){
  const file=path.join(f.home,`${name}.sh`);
  fs.writeFileSync(file,`#!/bin/sh\nprintf 'EXECUTED' >> ${JSON.stringify(marker)}\ncat >/dev/null\nprintf 'same\\n'\n`,{mode:0o700});
  fs.chmodSync(file,0o700);
  return file;
}

for(const [layout,mode] of [[null,0o755],[V2,0o700]]){
  const label=layout===V2?'v2-private':'v1-legacy';
  test(`G3-RV-04 ${label} clean checkout with configured executable fsmonitor never starts hook`,t=>{
    const f=localControlFixture(t,{layout,mode});
    const sentinel=path.join(f.home,'fsmonitor-executed');
    const script=rv04ExternalProgram(f,'fsmonitor',sentinel);
    f.git('config','core.fsmonitor',script);
    const index=fs.readFileSync(path.join(f.control,'.git','index'));
    const result=f.audit();
    assert.equal(result.status,'PASS',JSON.stringify(result.issues));
    assert.equal(result.mutations_performed,false);
    assert.equal(fs.existsSync(sentinel),false,'Git fsmonitor must never run');
    assert.deepEqual(fs.readFileSync(path.join(f.control,'.git','index')),index);
  });
}

test('G3-RV-04 injected global fsmonitor config cannot override safe plumbing inspection',t=>{
  const f=localControlFixture(t,{mode:0o755});
  const sentinel=path.join(f.home,'global-hook-executed');
  const script=rv04ExternalProgram(f,'global-monitor',sentinel);
  const config=path.join(f.home,'external-gitconfig');
  fs.writeFileSync(config,`[core]\n fsmonitor = ${script}\n`,{mode:0o600});
  const old=process.env.GIT_CONFIG_GLOBAL;
  try{
    process.env.GIT_CONFIG_GLOBAL=config;
    const report=f.audit();
    assert.equal(report.status,'PASS',JSON.stringify(report.issues));
    assert.equal(fs.existsSync(sentinel),false);
  }finally{
    if(old===undefined)delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL=old;
  }
});

test('G3-RV-04 configured clean filter remains inert for a clean v2 checkout',t=>{
  const f=localControlFixture(t,{layout:V2});
  const sentinel=path.join(f.home,'clean-filter-executed');
  const script=rv04ExternalProgram(f,'clean-filter',sentinel);
  fs.writeFileSync(path.join(f.control,'.gitattributes'),'note.txt filter=rv04\n');
  fs.writeFileSync(path.join(f.control,'note.txt'),'same\n');
  f.git('add','.gitattributes','note.txt');
  f.git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','clean filter fixture');
  f.git('config','filter.rv04.clean',script);
  f.git('config','core.fsmonitor','false');
  const report=f.audit();
  assert.equal(report.status,'PASS',JSON.stringify(report.issues));
  assert.equal(fs.existsSync(sentinel),false,'Git clean filter must never run');
});

test('G3-RV-04 modified tracked bytes cannot be hidden by clean filter even with fsmonitor false',t=>{
  const f=localControlFixture(t,{layout:V2});
  const sentinel=path.join(f.home,'clean-filter-executed');
  const script=rv04ExternalProgram(f,'dirty-filter',sentinel);
  fs.writeFileSync(path.join(f.control,'.gitattributes'),'note.txt filter=rv04\n');
  fs.writeFileSync(path.join(f.control,'note.txt'),'same\n');
  f.git('add','.gitattributes','note.txt');
  f.git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','raw fixture');
  f.git('config','filter.rv04.clean',script);
  f.git('config','core.fsmonitor','false');
  fs.writeFileSync(path.join(f.control,'note.txt'),'evil\n');
  const report=f.audit();
  assert.deepEqual(roleIssues(report,'control_clone'),[{role:'control_clone',reason:'existing_control_dirty'}]);
  assert.equal(report.mutations_performed,false);
  assert.equal(fs.existsSync(sentinel),false,'Dirty check cannot run filter to hide changed bytes');
});

test('G3-RV-04 staged change, untracked file and changed executable mode all fail closed',t=>{
  const f=localControlFixture(t,{layout:V2});
  assert.equal(f.audit().status,'PASS');
  const state=f.metadataFile;
  fs.writeFileSync(state,JSON.stringify({...f.metadata,arch:'x86_64'})+'\n',{mode:0o600});
  assert.deepEqual(roleIssues(f.audit(),'control_clone'),[{role:'control_clone',reason:'existing_control_dirty'}]);
  // The staging operation must not make a modified checkout appear clean.
  f.git('add','instance.json');
  assert.deepEqual(roleIssues(f.audit(),'control_clone'),[{role:'control_clone',reason:'existing_control_dirty'}]);
  f.git('reset','-q','HEAD','--','instance.json');
  fs.writeFileSync(state,JSON.stringify(f.metadata,null,2)+'\n',{mode:0o600});
  assert.equal(f.audit().status,'PASS');
  fs.writeFileSync(path.join(f.control,'untracked'), 'do not delete');
  assert.deepEqual(roleIssues(f.audit(),'control_clone'),[{role:'control_clone',reason:'existing_control_dirty'}]);
  fs.unlinkSync(path.join(f.control,'untracked'));
  fs.chmodSync(state,0o700);
  assert.deepEqual(roleIssues(f.audit(),'control_clone'),[{role:'control_clone',reason:'existing_control_dirty'}]);
});

test('G3-RV-04 malformed plumbing output, command failure and unsupported index fail without side effects',t=>{
  const f=localControlFixture(t,{layout:V2});
  const allowed=['remote','ls-tree','ls-files'];
  let calls=[];
  const runner=(cmd,args,options)=>{
    assert.equal(cmd,'git');
    assert.equal(options.cwd,f.control);
    assert.equal(options.allowFailure,true);
    const sub=args.includes('remote')?'remote':args.includes('ls-tree')?'ls-tree':args.includes('ls-files')?'ls-files':'INVALID';
    assert.ok(allowed.includes(sub),JSON.stringify(args));
    if(sub==='ls-files'||sub==='ls-tree'){
      assert.ok(args.includes('core.fsmonitor=false'));
      assert.ok(args.includes('core.untrackedCache=false'));
      assert.ok(!args.includes('status'));
    }
    calls.push(sub);
    return {ok:true,stdout:sub==='remote'?`https://github.com/${f.repo}.git`:'bad line without NUL',stderr:'',status:0};
  };
  assert.deepEqual(roleIssues(f.audit({gitRunner:runner}),'control_clone'),[{role:'control_clone',reason:'existing_control_git_unverified'}]);
  assert.deepEqual(calls,['remote','ls-tree']);
  assert.equal(f.audit({gitRunner:()=>({ok:false,stdout:'',status:1})}).status,'BLOCKED');
});

test('G3-RV-04 preserved state is not overwritten when Git identity is dirty or unsafe',t=>{
  const f=localControlFixture(t,{layout:V2});
  const statePath=path.join(f.base,'install-state.json');
  fs.mkdirSync(f.base,{recursive:true,mode:0o700});
  fs.writeFileSync(statePath,'saved-G3-SETUP-011-state\n',{mode:0o600});
  const original=fs.readFileSync(statePath);
  const beforeNames=fs.readdirSync(f.base);
  fs.writeFileSync(path.join(f.control,'dirty-new-file'),'retain as forensic evidence');
  const result=f.audit();
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.mutations_performed,false);
  assert.deepEqual(fs.readFileSync(statePath),original);
  assert.deepEqual(fs.readdirSync(f.base),beforeNames);
  assert.equal(fs.existsSync(path.join(f.base,'automation')),false);
  assert.equal(fs.readFileSync(path.join(f.control,'dirty-new-file'),'utf8'),'retain as forensic evidence');
});


test('G3-RV-04 an ignored untracked identity marker cannot authenticate an otherwise clean Control',t=>{
  const f=localControlFixture(t,{layout:V2});
  f.git('rm','--cached','-q','instance.json');
  f.git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','untrack authority marker');
  fs.writeFileSync(path.join(f.control,'.git','info','exclude'),'instance.json\n');
  assert.equal(f.git('status','--porcelain'),'','Git considers ignored local marker clean');
  assert.equal(fs.existsSync(f.metadataFile),true);
  const report=f.audit();
  assert.deepEqual(roleIssues(report,'control_clone'),[{role:'control_clone',reason:'existing_control_git_unverified'}]);
  assert.equal(report.mutations_performed,false);
});
