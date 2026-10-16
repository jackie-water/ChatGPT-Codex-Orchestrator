import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {normalizedGithubRepository,refreshControlRuntime} from "../src/lib/control-env.mjs";
import {renderWorkflow} from "../src/lib/control-render.mjs";

const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeModules=[
  "control-event-normalizer.mjs",
  "run-failure-state.mjs",
  "macos-codex-run-contract.mjs",
  "macos-codex-execution.mjs",
  "macos-postexecution-wrapper.mjs"
];
const workflowRelative=".github/workflows/orchestrator.yml";
const initialHead="a".repeat(40);
const ok=stdout=>({ok:true,stdout:stdout||"",stderr:"",status:0});
const failed=stdout=>({ok:false,stdout:stdout||"",stderr:"fake adapter refusal",status:1});

function write(root,name,value){
  const file=path.join(root,name);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,value);
}

// Read links themselves, never their targets. This also makes a rejected refresh's
// complete temporary tree (including any outside-link canary) comparable.
function snapshot(root){
  const files={};
  const visit=(file,relative)=>{
    const st=fs.lstatSync(file);
    if(st.isSymbolicLink()) files[relative]={link:fs.readlinkSync(file)};
    else if(st.isDirectory()){
      files[relative]={directory:true};
      for(const name of fs.readdirSync(file).sort()) visit(path.join(file,name),relative?relative+"/"+name:name);
    } else files[relative]={data:fs.readFileSync(file).toString("base64")};
  };
  visit(root,"");
  return files;
}

function workingFiles(root){
  return new Map(Object.entries(snapshot(root))
    .filter(([name,value])=>name!==".git"&&!name.startsWith(".git/")&&value.data!==undefined)
    .map(([name,value])=>[name,value.data]));
}

// This adapter has no child_process import, executable lookup, remote, or real
// repository. Commits, remote HEAD and the index exist only in these Maps.
function fakeGit(control,settings={}){
  let head=initialHead;
  let remoteHead=settings.remoteHead??head;
  let headFiles=workingFiles(control);
  for(const name of settings.untrackedPaths??["untracked.txt"]) headFiles.delete(name);
  const history=new Map([[head,new Map(headFiles)]]);
  const index=new Map();
  const calls=[];
  let commits=0;
  let pushFailures=settings.pushFailures||0;
  if(settings.prestaged) index.set("unrelated-staged.txt",Buffer.from("unrelated staged content\n").toString("base64"));
  const changes=()=>[...index.keys()].filter(name=>index.get(name)!==headFiles.get(name));
  const mutation=args=>args[0]==="add"||args[0]==="push"||args[0]==="reset"||args.includes("commit");
  const run=(command,args,options={})=>{
    assert.equal(command,"git");
    assert.equal(options.cwd,control);
    calls.push([...args]);
    const joined=args.join(" ");
    if(joined==="config --get remote.origin.url") return ok(settings.fetchUrl??"https://github.com/Owner/Control.git");
    if(joined==="config --get-all remote.origin.pushurl") return ok((settings.pushUrls??["git@github.com:Owner/Control.git"]).join("\n"));
    if(joined==="rev-parse --show-toplevel") return ok(settings.gitRoot??control);
    if(joined==="branch --show-current") return ok(settings.branch??"main");
    if(joined==="rev-parse HEAD") return ok(settings.localHead??head);
    if(joined==="ls-remote --heads origin refs/heads/main") return settings.remoteFailure?failed(""):ok(remoteHead?remoteHead+"\trefs/heads/main":"");
    if(joined==="diff --cached --quiet") return changes().length?failed(""):ok("");
    if(joined==="diff --cached --name-only") return ok(changes().sort().join("\n"));
    if(args[0]==="ls-files"&&args[1]==="--cached") return ok(args.slice(args.indexOf("--")+1).filter(name=>headFiles.has(name)).join("\n"));
    if(args[0]==="add"){
      const current=workingFiles(control);
      for(const name of args.slice(args.indexOf("--")+1)){
        const names=new Set([name,...[...current.keys(),...headFiles.keys()].filter(file=>file.startsWith(name+"/"))]);
        for(const file of names) if(current.has(file)||headFiles.has(file)) index.set(file,current.get(file));
      }
      return ok("");
    }
    if(args.includes("commit")){
      assert.ok(changes().length,"the fake commit must contain a runtime change");
      for(const [name,value] of index){ if(value===undefined) headFiles.delete(name); else headFiles.set(name,value); }
      head=crypto.createHash("sha1").update("fake-runtime-commit-"+(++commits)).digest("hex");
      history.set(head,new Map(headFiles));
      index.clear();
      return ok("");
    }
    if(joined==="push origin HEAD:main"){
      if(pushFailures-->0) throw new Error("simulated push failure");
      remoteHead=head;
      return ok("");
    }
    if(args[0]==="reset"&&args[1]==="--mixed"){
      assert.ok(history.has(args[2]),"fake reset must address a recorded HEAD");
      head=args[2]; headFiles=new Map(history.get(head)); index.clear();
      return ok("");
    }
    throw new Error("Unsupported fake Git call: "+joined);
  };
  return {run,calls,mutations:()=>calls.filter(mutation),head:()=>head,remoteHead:()=>remoteHead,index:()=>changes(),tracked:()=>new Map(headFiles)};
}

function fixture(t,{platform="darwin",arch=platform==="darwin"?"arm64":"x64",git={}}={}){
  // macOS may expose /var as a symlink; begin at its canonical temp root so a
  // legitimate fixture does not accidentally exercise the ancestor-link gate.
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"orchestrator-refresh-unit-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const control=path.join(root,"control");
  const sourceRoot=path.join(root,"source");
  fs.mkdirSync(path.join(control,".git"),{recursive:true});
  fs.cpSync(path.join(repositoryRoot,"runtime","scripts"),path.join(sourceRoot,"runtime","scripts"),{recursive:true});
  for(const name of nativeModules) write(sourceRoot,"src/lib/"+name,fs.readFileSync(path.join(repositoryRoot,"src","lib",name)));
  for(const name of ["orchestrator.yml.template","orchestrator.macos.yml.template"]){
    write(sourceRoot,"templates/control-repo/"+name,fs.readFileSync(path.join(repositoryRoot,"templates","control-repo",name)));
  }
  const state={
    control_environment_ready:true,control_repository:"owner/control",control_clone_path:control,
    runner_label:"codex-orchestrator-fixture",github_login:"Trusted-Owner",instance_id:"fixture01",
    instance_platform:platform,instance_arch:arch,
    ...(platform==="darwin"?{launch_agent_label:"com.chatgpt.codex.fixture01"}:{})
  };
  const metadata={
    schema_version:1,instance_id:state.instance_id,trusted_github_username:state.github_login,
    platform,arch,runner_label:state.runner_label,control_repository:state.control_repository,
    launch_agent_label:platform==="darwin"?state.launch_agent_label:null
  };
  const preserved={
    "instance.json":JSON.stringify(metadata,null,2)+"\n",
    "projects.json":'{"projects":{"extra":{"repository":"owner/extra","max_iterations":5}}}\n',
    "config.ps1":"$TRUSTED_GITHUB_USERS = @('Trusted-Owner')\n$extra = 'keep'\n",
    "chat-routes.json":'{"version":1,"routes":{"chat-212":{"chat_url":"https://chatgpt.com/c/registered-route"}}}\n',
    "pending.json":'{"pending":true}\n',
    "scripts/local-extra.ps1":"keep\n",
    "src/lib/local-extra.mjs":"export const local = true;\n",
    "untracked.txt":"keep untracked content\n"
  };
  for(const [name,value] of Object.entries(preserved)) write(control,name,value);
  write(control,"scripts/capture-chat-origins.mjs","retired\n");
  write(control,workflowRelative,"old workflow\n");
  const adapter=fakeGit(control,git);
  return {root,control,sourceRoot,state,metadata,preserved,adapter,
    run:()=>refreshControlRuntime({state,sourceRoot,gitRun:adapter.run}),
    writeMetadata:()=>write(control,"instance.json",JSON.stringify(metadata,null,2)+"\n")};
}

function assertRejected(f,pattern){
  const before=snapshot(f.root);
  if(pattern) assert.throws(f.run,pattern); else assert.throws(f.run);
  assert.deepEqual(snapshot(f.root),before,"rejection must not change any fixture, metadata, runtime, route or outside-link target");
  assert.deepEqual(f.adapter.mutations(),[],"rejection must precede even fake Git writes");
}

function replaceWithLink(f,relative,{source=false,directory=false}={}){
  const base=source?f.sourceRoot:f.control;
  const target=path.join(base,relative);
  const outside=path.join(f.root,"outside-"+crypto.randomUUID());
  if(directory){fs.mkdirSync(outside,{recursive:true});write(outside,"canary.txt","outside must remain unchanged\n");}
  else fs.writeFileSync(outside,"outside must remain unchanged\n");
  fs.rmSync(target,{recursive:true,force:true});
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.symlinkSync(outside,target,directory?"dir":"file");
}

test("runtime refresh accepts exact GitHub HTTPS and SSH remotes",()=>{
  assert.equal(normalizedGithubRepository("https://github.com/Owner/Control.git"),"owner/control");
  assert.equal(normalizedGithubRepository("git@github.com:Owner/Control.git"),"owner/control");
  assert.equal(normalizedGithubRepository("ssh://git@github.com/Owner/Control.git"),"owner/control");
  assert.equal(normalizedGithubRepository("https://github.com/Owner/Other.git"),"owner/other");
  assert.equal(normalizedGithubRepository("https://github.com/Owner/Control/extra"),null);
});

test("runtime refresh validates fetch and every explicit push URL before mutation",async t=>{
  for(const [fetchUrl,pushUrls] of [
    ["https://github.com/Owner/Other.git",["git@github.com:Owner/Control.git"]],
    ["not-a-github-url",[]],
    ["https://github.com/Owner/Control.git",["git@github.com:Owner/Control.git","https://github.com/Owner/Other.git"]],
    ["https://github.com/Owner/Control.git",["not-a-github-url"]]
  ]) await t.test(fetchUrl+" / "+pushUrls.join(","),t=>{
    const f=fixture(t,{git:{fetchUrl,pushUrls}});
    assertRejected(f,/push destination/);
    assert.equal(f.adapter.calls.filter(args=>args[0]==="config").length,2);
  });
});

test("macOS runtime refresh keeps native workflow, static identity, registered routes and idempotence",async t=>{
  for(const arch of ["arm64","x64"]) await t.test(arch,t=>{
    const f=fixture(t,{arch});
    f.state.issue_author="Untrusted-Issue-Author";
    const first=f.run();
    assert.equal(first.changed,true);
    assert.notEqual(f.adapter.head(),initialHead);
    assert.equal(f.adapter.remoteHead(),f.adapter.head());
    assert.equal(f.adapter.tracked().has("untracked.txt"),false);
    const workflow=fs.readFileSync(path.join(f.control,workflowRelative),"utf8");
    assert.match(workflow,new RegExp("runs-on: \\[self-hosted, macOS, "+(arch==="arm64"?"ARM64":"X64")+", codex-orchestrator-fixture\\]"));
    assert.match(workflow,/node scripts\/macos-dispatch\.mjs/);
    assert.match(workflow,/--trusted-github-username "Trusted-Owner"/);
    assert.doesNotMatch(workflow,/powershell|Windows|Untrusted-Issue-Author|github\.event\.issue\.user\.login|\{\{TRUSTED_GITHUB_USERNAME\}\}/);
    for(const [name,value] of Object.entries(f.preserved)) assert.equal(fs.readFileSync(path.join(f.control,name),"utf8"),value,name);
    assert.equal(fs.existsSync(path.join(f.control,"scripts/capture-chat-origins.mjs")),false);
    for(const name of nativeModules) assert.ok(fs.statSync(path.join(f.control,"src/lib",name)).isFile(),name);
    const allowed=name=>name.startsWith("scripts/")||nativeModules.some(module=>name==="src/lib/"+module)||name===workflowRelative;
    for(const args of f.adapter.calls.filter(args=>args[0]==="add")){
      assert.ok(args.slice(args.indexOf("--")+1).every(allowed),"only runtime-owned paths may be staged");
    }
    const refreshed=snapshot(f.control);
    const head=f.adapter.head();
    assert.equal(f.run().changed,false);
    assert.deepEqual(snapshot(f.control),refreshed);
    assert.equal(f.adapter.head(),head);
    assert.equal(f.adapter.remoteHead(),head);
    assert.equal(f.adapter.calls.filter(args=>args.includes("commit")).length,1);
  });
});

test("Windows runtime refresh uses the unchanged Windows rendering on any host",t=>{
  const f=fixture(t,{platform:"win32"});
  assert.equal(f.run().changed,true);
  const expected=renderWorkflow(fs.readFileSync(path.join(f.sourceRoot,"templates/control-repo/orchestrator.yml.template"),"utf8"),{runnerLabel:f.state.runner_label,platform:"win32"});
  const workflow=fs.readFileSync(path.join(f.control,workflowRelative),"utf8");
  assert.equal(workflow,expected);
  assert.match(workflow,/runs-on: \[self-hosted, Windows, X64, codex-orchestrator-fixture\]/);
  assert.match(workflow,/shell: powershell/);
  assert.match(workflow,/\.\/scripts\/run-codex\.ps1/);
  for(const [name,value] of Object.entries(f.preserved)) assert.equal(fs.readFileSync(path.join(f.control,name),"utf8"),value,name);
  assert.equal(f.run().changed,false);
});

test("runtime refresh rolls back only the fake commit on a failed push and can retry",t=>{
  const f=fixture(t,{git:{pushFailures:1}});
  assert.throws(f.run,/simulated push failure/);
  assert.equal(f.adapter.head(),initialHead);
  assert.equal(f.adapter.remoteHead(),initialHead);
  assert.deepEqual(f.adapter.index(),[]);
  assert.ok(f.adapter.calls.some(args=>args.join(" ")==="reset --mixed "+initialHead));
  assert.match(fs.readFileSync(path.join(f.control,workflowRelative),"utf8"),/macos-dispatch/);
  for(const [name,value] of Object.entries(f.preserved)) assert.equal(fs.readFileSync(path.join(f.control,name),"utf8"),value,name);
  assert.equal(f.run().changed,true);
  assert.equal(f.adapter.remoteHead(),f.adapter.head());
});

test("runtime refresh rejects remote HEAD mismatch, missing or malformed remote main before mutation",async t=>{
  for(const remoteHead of ["b".repeat(40),"","not-a-sha"]) await t.test(remoteHead||"missing",t=>{
    assertRejected(fixture(t,{git:{remoteHead}}),/local HEAD must match remote main/);
  });
  await t.test("failed remote read",t=>assertRejected(fixture(t,{git:{remoteFailure:true}}),/local HEAD must match remote main/));
});

test("runtime refresh rejects pre-staged changes before copying",t=>{
  const f=fixture(t,{git:{prestaged:true}});
  const index=f.adapter.index();
  assertRejected(f,/pre-staged/);
  assert.deepEqual(f.adapter.index(),index);
  assert.equal(f.adapter.head(),initialHead);
  assert.equal(f.adapter.remoteHead(),initialHead);
});

test("runtime refresh requires complete persistent state and never trusts the Issue author",async t=>{
  for(const field of ["control_environment_ready","control_repository","control_clone_path","runner_label","github_login","instance_id","instance_platform","instance_arch","launch_agent_label"]){
    await t.test("missing state "+field,t=>{
      const f=fixture(t); delete f.state[field];
      f.state.issue_author="Trusted-Owner";
      assertRejected(f);
    });
  }
  for(const [field,value] of [
    ["control_environment_ready",false],["control_repository","owner/control/extra"],
    ["runner_label","runner with spaces"],["github_login","user;echo injected"],
    ["github_login",["Trusted-Owner","Other"]],["instance_id","../other"],
    ["instance_platform","linux"],["instance_platform",["darwin","win32"]],
    ["instance_arch","unknown"],["instance_arch",["arm64","x64"]],
    ["launch_agent_label",""]
  ]) await t.test("invalid state "+field+" "+JSON.stringify(value),t=>{
    const f=fixture(t); f.state[field]=value; assertRejected(f);
  });
  await t.test("Windows ARM64 is unsupported",t=>assertRejected(fixture(t,{platform:"win32",arch:"arm64"})));
  for(const environment of [{platform:"win32",arch:"arm64"},{platform:"darwin",arch:"x64"}]){
    await t.test("conflicting persisted environment "+JSON.stringify(environment),t=>{
      const f=fixture(t); f.state.environment=environment; assertRejected(f);
    });
  }
});

test("runtime refresh rejects missing, legacy, malformed and conflicting instance metadata",async t=>{
  for(const field of ["schema_version","instance_id","trusted_github_username","platform","arch","runner_label","control_repository","launch_agent_label"]){
    await t.test("missing persisted "+field,t=>{
      const f=fixture(t); delete f.metadata[field]; f.writeMetadata(); assertRejected(f);
    });
  }
  for(const [field,value] of [
    ["schema_version",2],["instance_id","other01"],["trusted_github_username","Issue-Author"],
    ["platform","win32"],["arch","x64"],["runner_label","other-runner"],
    ["control_repository","owner/other"],["launch_agent_label","com.chatgpt.codex.other01"]
  ]) await t.test("conflicting persisted "+field,t=>{
    const f=fixture(t); f.metadata[field]=value; f.writeMetadata(); assertRejected(f);
  });
  await t.test("legacy metadata without platform provenance",t=>{
    const f=fixture(t); write(f.control,"instance.json",JSON.stringify({schema_version:1,instance_id:f.state.instance_id,trusted_github_username:f.state.github_login,launch_agent_label:f.state.launch_agent_label})); assertRejected(f);
  });
  await t.test("missing metadata",t=>{
    const f=fixture(t); fs.rmSync(path.join(f.control,"instance.json")); assertRejected(f);
  });
  await t.test("malformed metadata",t=>{
    const f=fixture(t); write(f.control,"instance.json","{invalid json"); assertRejected(f);
  });
  await t.test("Windows persisted launch identity must be null",t=>{
    const f=fixture(t,{platform:"win32"}); f.metadata.launch_agent_label="com.chatgpt.codex.other"; f.writeMetadata(); assertRejected(f);
  });
  await t.test("Windows cannot accept a matching but foreign macOS launch identity",t=>{
    const f=fixture(t,{platform:"win32"}); f.state.launch_agent_label="com.chatgpt.codex.other"; f.metadata.launch_agent_label=f.state.launch_agent_label; f.writeMetadata(); assertRejected(f);
  });
  await t.test("Windows metadata must explicitly record a null launch identity",t=>{
    const f=fixture(t,{platform:"win32"}); delete f.metadata.launch_agent_label; f.writeMetadata(); assertRejected(f);
  });
});

test("runtime refresh rejects the wrong clone path, Git root, branch and invalid HEAD",async t=>{
  await t.test("relative clone root",t=>{
    const f=fixture(t); f.state.control_clone_path=path.relative(process.cwd(),f.control); assertRejected(f);
  });
  await t.test("missing clone root",t=>{
    const f=fixture(t); f.state.control_clone_path=path.join(f.root,"absent"); assertRejected(f);
  });
  await t.test("different Git top level",t=>{
    const f=fixture(t,{git:{gitRoot:"/unrelated/checkout"}}); assertRejected(f);
  });
  await t.test("different branch",t=>assertRejected(fixture(t,{git:{branch:"feature"}}),/main/));
  await t.test("invalid local HEAD",t=>assertRejected(fixture(t,{git:{localHead:"not-a-sha"}}),/HEAD/));
});

test("runtime refresh rejects all symlinked destination paths before writing",async t=>{
  for(const [relative,directory] of [
    [".git",true],["instance.json",false],["scripts",true],["scripts/macos-dispatch.mjs",false],
    ["src",true],["src/lib",true],["src/lib/control-event-normalizer.mjs",false],
    [".github",true],[".github/workflows",true],[workflowRelative,false]
  ]) await t.test(relative,t=>{
    const f=fixture(t); replaceWithLink(f,relative,{directory}); assertRejected(f);
  });
  await t.test("symlinked clone root",t=>{
    const f=fixture(t); const alias=path.join(f.root,"control-link"); fs.symlinkSync(f.control,alias,"dir"); f.state.control_clone_path=alias; assertRejected(f);
  });
  await t.test("symlinked clone ancestor",t=>{
    const f=fixture(t); const alias=path.join(f.root,"ancestor-link"); fs.symlinkSync(f.root,alias,"dir"); f.state.control_clone_path=path.join(alias,"control"); assertRejected(f);
  });
});

test("runtime refresh rejects symlinked and incomplete source bundles before writing",async t=>{
  for(const [relative,directory] of [
    ["runtime",true],["runtime/scripts",true],["runtime/scripts/macos-dispatch.mjs",false],
    ["src",true],["src/lib",true],["src/lib/control-event-normalizer.mjs",false],
    ["templates",true],["templates/control-repo",true],["templates/control-repo/orchestrator.macos.yml.template",false]
  ]) await t.test(relative,t=>{
    const f=fixture(t); replaceWithLink(f,relative,{source:true,directory}); assertRejected(f);
  });
  await t.test("source root link",t=>{
    const f=fixture(t); const alias=path.join(f.root,"source-link"); fs.symlinkSync(f.sourceRoot,alias,"dir");
    f.run=()=>refreshControlRuntime({state:f.state,sourceRoot:alias,gitRun:f.adapter.run}); assertRejected(f);
  });
  await t.test("source ancestor link",t=>{
    const f=fixture(t); const alias=path.join(f.root,"source-ancestor-link"); fs.symlinkSync(f.root,alias,"dir");
    f.run=()=>refreshControlRuntime({state:f.state,sourceRoot:path.join(alias,"source"),gitRun:f.adapter.run}); assertRejected(f);
  });
  await t.test("source and destination cannot overlap",t=>{
    const f=fixture(t);
    f.run=()=>refreshControlRuntime({state:f.state,sourceRoot:f.control,gitRun:f.adapter.run}); assertRejected(f);
  });
  for(const relative of ["runtime/scripts/macos-dispatch.mjs","src/lib/macos-codex-execution.mjs","templates/control-repo/orchestrator.macos.yml.template"]){
    await t.test("missing "+relative,t=>{
      const f=fixture(t); fs.rmSync(path.join(f.sourceRoot,relative)); assertRejected(f);
    });
  }
});

test("runtime refresh rejects path type confusion before copying",async t=>{
  for(const [relative,shouldBeDirectory] of [
    [".git",true],["scripts",true],["src",true],[".github/workflows",true],
    ["instance.json",false],["scripts/macos-dispatch.mjs",false],["src/lib/macos-codex-execution.mjs",false],[workflowRelative,false]
  ]) await t.test("destination "+relative,t=>{
    const f=fixture(t); const file=path.join(f.control,relative); fs.rmSync(file,{recursive:true,force:true});
    if(shouldBeDirectory) write(f.control,relative,"wrong file type\n"); else fs.mkdirSync(file,{recursive:true});
    assertRejected(f);
  });
  for(const [relative,shouldBeDirectory] of [["runtime/scripts",true],["src/lib",true],["templates/control-repo/orchestrator.macos.yml.template",false]]){
    await t.test("source "+relative,t=>{
      const f=fixture(t); const file=path.join(f.sourceRoot,relative); fs.rmSync(file,{recursive:true,force:true});
      if(shouldBeDirectory) write(f.sourceRoot,relative,"wrong file type\n"); else fs.mkdirSync(file,{recursive:true});
      assertRejected(f);
    });
  }
});
