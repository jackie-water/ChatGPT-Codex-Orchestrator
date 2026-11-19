import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {defaultLocalPaths,MACOS_PRIVATE_CONTROL_LAYOUT_V2 as V2} from '../src/lib/control-render.mjs';

// RV-05: All test repositories are generated in isolated temporary HOMEs.
// These tests never contact GitHub and never invoke the actual installer.
const installationId='192e9295-fixture';
const projectKey='target';
const sourceUrl=new URL('../src/lib/control-env.mjs',import.meta.url);
const realGit=spawnSync('which',['git'],{encoding:'utf8'}).stdout.trim();

function repoFixture(t){
  const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cco-rv05-'));
  fs.chmodSync(home,0o700);
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const paths=defaultLocalPaths({home,installationId,projectKey,platform:'darwin',macosControlLayout:V2});
  const instanceRoot=path.join(home,'.chatgpt-codex-orchestrator','instances','192e9295');
  const sandboxPath=path.join(instanceRoot,'automation','sandbox-192e9295');
  const names={
    Target:'owner/target',
    Sandbox:'owner/chatgpt-codex-orchestrator-sandbox-192e9295',
    Control:'owner/chatgpt-codex-orchestrator-control-192e9295'
  };
  const location={Target:paths.project,Sandbox:sandboxPath,Control:paths.control};
  const git=(cwd,...args)=>{
    const r=spawnSync(realGit,['-C',cwd,...args],{
      encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}
    });
    assert.equal(r.status,0,`${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  function createRepo(role){
    const root=location[role];
    fs.mkdirSync(root,{recursive:true,mode:0o700});fs.chmodSync(root,0o700);
    for(let d=path.dirname(root);d.startsWith(home+path.sep)&&d!==home;d=path.dirname(d))fs.chmodSync(d,0o700);
    git(root,'init','-q','-b','main');
    git(root,'remote','add','origin',`https://github.com/${names[role]}.git`);
    if(role==='Control'){
      const meta={schema_version:1,instance_id:'192e9295',installation_id:installationId,
        platform:'darwin',arch:'arm64',role:'control',trusted_github_username:'owner',
        control_repository:names.Control,sandbox_repository:names.Sandbox,
        origin:`https://github.com/${names.Control}.git`,
        remote_origin:`https://github.com/${names.Control}.git`,macos_control_layout:V2};
      const f=path.join(root,'instance.json');fs.writeFileSync(f,JSON.stringify(meta,null,2)+'\n',{mode:0o600});fs.chmodSync(f,0o600);
    }else fs.writeFileSync(path.join(root,'safe.txt'),'safe\n');
    git(root,'add','-A');
    git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','local fixture');
    return root;
  }
  const fakeBin=path.join(home,'fake-bin');fs.mkdirSync(fakeBin,{mode:0o700});
  const ghLog=path.join(home,'gh-calls.log'),sideEffect=path.join(home,'would-have-created-remote');
  const ghPath=path.join(fakeBin,'gh');
  fs.writeFileSync(ghPath,`#!/bin/sh
printf '%s\n' "$*" >> "$GH_RV05_LOG"
if [ "$1" = api ] && [ "$2" = user ]; then printf 'owner\n'; exit 0; fi
if [ "$1" = repo ] && [ "$2" = view ] && [ "$3" = owner/target ]; then
 printf '%s\n' '{"nameWithOwner":"owner/target","defaultBranchRef":{"name":"main"},"visibility":"PRIVATE"}'; exit 0
fi
printf 'UNAUTHORIZED' >> "$GH_RV05_SIDE_EFFECT"
exit 97
`,{mode:0o700});fs.chmodSync(ghPath,0o700);
  const saved=path.join(home,'saved-g3-setup-011-intent.json');fs.writeFileSync(saved,'{ "status": "BLOCKED", "claim": "retained" }\n',{mode:0o600});
  function prepareChild(){
    const script=`import {prepareControlEnvironment} from ${JSON.stringify(sourceUrl.href)};
Object.defineProperty(process,'platform',{configurable:true,value:'darwin'});
Object.defineProperty(process,'arch',{configurable:true,value:'arm64'});
try{
 prepareControlEnvironment({installationId:${JSON.stringify(installationId)},targetRepository:'owner/target',
  reviewerChatUrl:'https://chatgpt.com/c/pinned',trustedGithubLogin:'owner',macosSetupApproved:true,
  sourceRoot:${JSON.stringify(home)},home:${JSON.stringify(home)},macosControlLayout:${JSON.stringify(V2)}});
 console.log(JSON.stringify({status:'UNEXPECTED_SUCCESS'}));
}catch(error){console.log(JSON.stringify({status:'BLOCKED',error:String(error.message)}));}`;
    const r=spawnSync(process.execPath,['--input-type=module','-e',script],{
      cwd:home,encoding:'utf8',timeout:15000,
      env:{...process.env,GH_RV05_LOG:ghLog,GH_RV05_SIDE_EFFECT:sideEffect,PATH:fakeBin+path.delimiter+process.env.PATH}
    });
    assert.equal(r.status,0,r.stderr);
    return JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  }
  const noEffect=()=>{
    assert.equal(fs.existsSync(sideEffect),false,'no gh repo create/clone/push may occur');
    const requests=fs.readFileSync(ghLog,'utf8').trim().split(/\r?\n/);
    assert.equal(requests.length,2,`unexpected GitHub calls: ${requests}`);
    assert.equal(fs.readFileSync(saved,'utf8'),'{ "status": "BLOCKED", "claim": "retained" }\n');
    assert.equal(fs.existsSync(path.join(instanceRoot,'browser-profile')),false);
    assert.equal(fs.existsSync(path.join(instanceRoot,'pending-wakes')),false);
  };
  return {home,paths,instanceRoot,location,names,git,createRepo,prepareChild,noEffect,sideEffect,ghLog,saved,fakeBin};
}
function externalProgram(f,name){
  const marker=path.join(f.home,name+'-executed');
  const script=path.join(f.home,name+'.sh');
  fs.writeFileSync(script,`#!/bin/sh\nprintf 'EXECUTED' >> ${JSON.stringify(marker)}\nexit 0\n`,{mode:0o700});
  fs.chmodSync(script,0o700);
  return {script,marker};
}

for(const role of ['Target','Sandbox','Control']){
  test(`G3-RV-05 ${role} configured fsmonitor is rejected before target/Sandbox/Control remote effects or installer writes`,t=>{
    const f=repoFixture(t),checkout=f.createRepo(role),probe=externalProgram(f,`fsmonitor-${role}`);
    f.git(checkout,'config','core.fsmonitor',probe.script);
    const result=f.prepareChild();
    assert.match(result.error,/MACOS-G3-GIT-EXTENSION-BLOCKED/);
    assert.equal(fs.existsSync(probe.marker),false);
    f.noEffect();
  });
  test(`G3-RV-05 ${role} custom filter and attributes cannot run during setup preflight`,t=>{
    const f=repoFixture(t),checkout=f.createRepo(role),probe=externalProgram(f,`filter-${role}`);
    const attrs=path.join(checkout,'.gitattributes');fs.writeFileSync(attrs,'safe.txt filter=execute\n');
    // A dirty/extension-enabled repo must block before any Git add/filter work.
    if(role==='Control'){
      f.git(checkout,'add','.gitattributes');
      f.git(checkout,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','commit attributes before unsafe driver');
    }
    f.git(checkout,'config','filter.execute.clean',probe.script);
    const result=f.prepareChild();
    assert.match(result.error,/MACOS-G3-GIT-EXTENSION-BLOCKED/);
    assert.equal(fs.existsSync(probe.marker),false);
    f.noEffect();
  });
  test(`G3-RV-05 ${role} executable pre-push hook is refused without execution`,t=>{
    const f=repoFixture(t),checkout=f.createRepo(role),probe=externalProgram(f,`pre-push-${role}`);
    const hook=path.join(checkout,'.git','hooks','pre-push');fs.copyFileSync(probe.script,hook);fs.chmodSync(hook,0o700);
    const result=f.prepareChild();
    assert.match(result.error,/MACOS-G3-GIT-EXTENSION-BLOCKED/);
    assert.equal(fs.existsSync(probe.marker),false);
    f.noEffect();
  });
}
for(const [name,alter] of [
  ['include-path', (f,c)=>f.git(c,'config','include.path',path.join(f.home,'external-config'))],
  ['foreign-pushurl',(f,c)=>f.git(c,'config','remote.origin.pushurl','https://github.com/foreign/wrong.git')],
  ['unsafe-hooks-path',(f,c)=>f.git(c,'config','core.hooksPath',path.join(f.home,'hooks'))],
  ['git-attributes',(f,c)=>fs.writeFileSync(path.join(c,'.gitattributes'),'*.txt filter=untrusted\n')],
  ['dirty-tracked-file',(f,c)=>fs.writeFileSync(path.join(c,'safe.txt'),'dirty\n')],
  ['untracked-file',(f,c)=>fs.writeFileSync(path.join(c,'unknown'),'do not overwrite')]
])test(`G3-RV-05 Target ${name} fails closed before any G3 side effects`,t=>{
  const f=repoFixture(t),clone=f.createRepo('Target');alter(f,clone);
  const result=f.prepareChild();
  assert.equal(result.status,'BLOCKED');
  assert.match(result.error,/MACOS-G3-GIT-EXTENSION-BLOCKED|Target clone contains dirty, unsafe or unverifiable/);
  f.noEffect();
});

// Exercise the real internal functions, without adding a new runtime API.
// The copy rewrites only relative import specifiers to the frozen module's
// original dependencies, then exports helper names for this isolated test.
function isolatedInternalModule(t){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cco-rv05-internals-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const original=fs.readFileSync(sourceUrl,'utf8');
  const text=original.replace(/from "\.\/([^"\n]+)"/g,(_,name)=>
    `from ${JSON.stringify(new URL('../src/lib/'+name,import.meta.url).href)}`)+
    '\nexport {runG3Git,macosG3GitEnvironment,commitAndPush,safeG3CloneCommand,preflightMacosG3ExistingClones};\n';
  const file=path.join(root,'test-only-export.mjs');fs.writeFileSync(file,text);
  return pathToFileURL(file).href;
}

test('G3-RV-05 real macOS Git child ignores inherited external fsmonitor and executable commit hook',async t=>{
  const f=repoFixture(t),clone=f.createRepo('Target'),probe=externalProgram(f,'inherited-global-hook');
  const config=path.join(f.home,'global.gitconfig');
  fs.writeFileSync(config,`[core]\n fsmonitor = ${probe.script}\n hooksPath = ${f.home}/user-hooks\n`,{mode:0o600});
  const hooks=path.join(f.home,'user-hooks');fs.mkdirSync(hooks);
  const commitHook=path.join(hooks,'pre-commit');fs.copyFileSync(probe.script,commitHook);fs.chmodSync(commitHook,0o700);
  // A child is necessary because process.platform is immutable in normal tests.
  const entry=`import {runG3Git} from ${JSON.stringify(isolatedInternalModule(t))};
Object.defineProperty(process,'platform',{configurable:true,value:'darwin'});
const a=runG3Git(['status','--porcelain'],{cwd:${JSON.stringify(clone)}});
if(!a.ok)throw new Error(a.stderr);
const file=${JSON.stringify(path.join(clone,'safe.txt'))};
fs.writeFileSync(file,'change by test\\n');
const b=runG3Git(['add','--','safe.txt'],{cwd:${JSON.stringify(clone)}});
const c=runG3Git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','no user hooks'],{cwd:${JSON.stringify(clone)}});
console.log(JSON.stringify({status:'PASS',a:a.ok,b:b.ok,c:c.ok}));`;
  // One extra import for Node's fs binding, not any external Git executable.
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';\n${entry}`],{
    cwd:f.home,encoding:'utf8',timeout:15000,
    env:{...process.env,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_PARAMETERS:"'core.fsmonitor=bad'"}
  });
  assert.equal(child.status,0,child.stderr);
  assert.match(child.stdout,/"status":"PASS"/);
  assert.equal(fs.existsSync(probe.marker),false);
});

test('G3-RV-05 direct HTTPS git clone uses fixed Git extension policy without gh repo clone',t=>{
  const f=repoFixture(t),mod=isolatedInternalModule(t);
  const fakeGit=path.join(f.fakeBin,'git');
  fs.writeFileSync(fakeGit,`#!/bin/sh
printf 'count=%s;first=%s;global=%s;template=%s;protocol=%s;hooks=%s;args=%s\n' "$GIT_CONFIG_COUNT" "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_GLOBAL" "$GIT_TEMPLATE_DIR" "$GIT_ALLOW_PROTOCOL" "$GIT_CONFIG_VALUE_0" "$*"
`,{mode:0o700});fs.chmodSync(fakeGit,0o700);
  const script=`import {safeG3CloneCommand} from ${JSON.stringify(mod)};
Object.defineProperty(process,'platform',{configurable:true,value:'darwin'});
const out=safeG3CloneCommand('owner/target',${JSON.stringify(path.join(f.home,'absent'))});
console.log(out.stdout);`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{
    cwd:f.home,encoding:'utf8',timeout:15000,
    env:{...process.env,PATH:f.fakeBin+path.delimiter+process.env.PATH,
      GIT_CONFIG_GLOBAL:path.join(f.home,'attacker-config'),GIT_CONFIG_COUNT:'1',
      GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'evil'}
  });
  assert.equal(child.status,0,child.stderr);
  assert.match(child.stdout,/count=15;first=core.hooksPath;global=\/dev\/null;template=\/dev\/null;protocol=https;hooks=\/dev\/null/);
  assert.match(child.stdout,/clone --no-recurse-submodules https:\/\/github\.com\/owner\/target\.git/);
  assert.equal(fs.existsSync(f.ghLog),false,'new clones must not take an unpinned gh repo clone path');
});

test('G3-RV-05 three clean identity-matched checkouts pass the pre-side-effect Git gate without writes',t=>{
  const f=repoFixture(t),mod=isolatedInternalModule(t);
  for(const role of ['Target','Sandbox','Control'])f.createRepo(role);
  const before=fs.readFileSync(f.saved),state={};
  for(const role of ['Target','Sandbox','Control']){
    const index=fs.readFileSync(path.join(f.location[role],'.git','index'));
    state[role]=index.toString('hex');
  }
  const script=`import {preflightMacosG3ExistingClones} from ${JSON.stringify(mod)};
Object.defineProperty(process,'platform',{configurable:true,value:'darwin'});
preflightMacosG3ExistingClones({targetPath:${JSON.stringify(f.location.Target)},targetRepository:${JSON.stringify(f.names.Target)},
  sandboxPath:${JSON.stringify(f.location.Sandbox)},sandboxRepository:${JSON.stringify(f.names.Sandbox)},
  controlPath:${JSON.stringify(f.location.Control)},controlRepository:${JSON.stringify(f.names.Control)}});
console.log('PASS_THREE_CLONES');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:f.home,encoding:'utf8',timeout:15000});
  assert.equal(child.status,0,child.stderr);
  assert.match(child.stdout,/PASS_THREE_CLONES/);
  for(const role of ['Target','Sandbox','Control']){
    assert.equal(fs.readFileSync(path.join(f.location[role],'.git','index')).toString('hex'),state[role]);
  }
  assert.deepEqual(fs.readFileSync(f.saved),before);
  assert.equal(fs.existsSync(f.sideEffect),false);
});

test('G3-RV-05 freshly cloned Target with untrusted attributes is rejected before any generated Sandbox/Control remote writes',t=>{
  const f=repoFixture(t),repo=f.names.Target;
  const wrapper=path.join(f.fakeBin,'git');
  fs.writeFileSync(wrapper,`#!/bin/sh
for arg in "$@"; do
 if [ "$arg" = clone ]; then
  for last; do :; done
  "${realGit}" init -q -b main "$last"
  "${realGit}" -C "$last" remote add origin 'https://github.com/${repo}.git'
  printf 'safe\n' > "$last/safe.txt"
  printf '*.txt filter=unsafe\n' > "$last/.gitattributes"
  "${realGit}" -C "$last" add -A
  "${realGit}" -C "$last" -c user.name=Fixture -c user.email=fixture@example.test commit -qm initial
  exit 0
 fi
done
exec "${realGit}" "$@"
`,{mode:0o700});fs.chmodSync(wrapper,0o700);
  const report=f.prepareChild();
  assert.match(report.error,/MACOS-G3-GIT-EXTENSION-BLOCKED:attributes/);
  const requests=fs.readFileSync(f.ghLog,'utf8');
  assert.doesNotMatch(requests,/repo clone|repo create/);
  assert.equal(fs.existsSync(f.sideEffect),false);
  assert.equal(fs.existsSync(f.location.Sandbox),false);
  assert.equal(fs.existsSync(f.location.Control),true,'pre-approved empty private leaf may already be prepared');
  assert.deepEqual(fs.readdirSync(f.location.Control),[],'no Control checkout, metadata or workflow may be created');
  assert.equal(fs.readFileSync(f.saved,'utf8'),'{ "status": "BLOCKED", "claim": "retained" }\n');
});
