import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareMigrationIntent, migrationIntentPath, renderLaunchAgent, macosRuntimeAction } from "../src/lib/macos-platform.mjs";
import { defaultLocalPaths } from "../src/lib/control-render.mjs";

test("P3 migration intent uses the shared exact-eight identity and isolates installations",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-p3-home-"));
  const source=fs.mkdtempSync(path.join(os.tmpdir(),"orch-p3-source-"));
  const old=process.env.HOME; process.env.HOME=home;
  try {
    const a={installation_id:"4f28a5e3-c801-4e2b-9c00-000000000001",target_repository:"organization/app",github_login:"owner"};
    const b={installation_id:"9a77bc11-2222-4e2b-9c00-000000000002",target_repository:"organization/app",github_login:"owner"};
    const ia=prepareMigrationIntent({home,sourceRoot:source,state:a});
    const ib=prepareMigrationIntent({home,sourceRoot:source,state:b});
    assert.equal(ia.path,migrationIntentPath({home,installationId:a.installation_id}));
    assert.notEqual(ia.path,ib.path);
    assert.match(ia.path,/instances\/4f28a5e3\/migration-intent\.json$/);
    assert.equal(ia.generated_repositories.control,"owner/chatgpt-codex-orchestrator-control-4f28a5e3");
    assert.equal(defaultLocalPaths({home,installationId:a.installation_id,projectKey:"app"}).runner,
      path.join(home,"ChatGPTCodexOrchestrator","runner-4f28a5e3"));
    assert.deepEqual(prepareMigrationIntent({home,sourceRoot:source,state:a}).path,ia.path);
    assert.throws(()=>prepareMigrationIntent({home,sourceRoot:source,state:{...a,target_repository:"other/app"}}),/conflicts/);
    assert.throws(()=>prepareMigrationIntent({home,sourceRoot:source,state:{...a,github_login:"other"}}),/conflicts/);
    const missing={...a,installation_id:"missing-login"};
    const invalid={...a,installation_id:"invalid-login",github_login:"not valid"};
    assert.throws(()=>prepareMigrationIntent({home,sourceRoot:source,state:{...missing,github_login:""}}),/Verified GitHub login/);
    assert.throws(()=>prepareMigrationIntent({home,sourceRoot:source,state:invalid}),/Verified GitHub login/);
    assert.equal(fs.existsSync(migrationIntentPath({home,installationId:missing.installation_id})),false);
    assert.equal(fs.existsSync(migrationIntentPath({home,installationId:invalid.installation_id})),false);
  } finally { if(old===undefined) delete process.env.HOME; else process.env.HOME=old; fs.rmSync(home,{recursive:true,force:true}); fs.rmSync(source,{recursive:true,force:true}); }
});

test("P3 migration intent refuses a symlinked instance ancestor",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-p3-home-"));
  const root=path.join(home,".chatgpt-codex-orchestrator");
  fs.mkdirSync(home,{recursive:true});
  const old=process.env.HOME; process.env.HOME=home;
  try { fs.symlinkSync(os.tmpdir(),root);
    assert.throws(()=>prepareMigrationIntent({home,sourceRoot:home,state:{installation_id:"abc-123",target_repository:"owner/app",github_login:"owner"}}),/unsafe|symlink/i);
  } finally { if(old===undefined) delete process.env.HOME; else process.env.HOME=old; fs.rmSync(home,{recursive:true,force:true}); }
});

test("P3 launchctl refuses unknown initial state without side effects",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-p3-home-"));
  const commands=[];
  const fake=(name,args)=>{ commands.push(args); return {ok:false,output:"unknown"}; };
  const state={sandbox_only:true,target_environment_ready:false,installation_id:"abc12345",instance_id:"abc12345",runner_owner:"abc12345",runner_label:"codex-orchestrator-abc12345",launch_agent_label:"com.chatgpt.codex.abc12345",runner_path:path.join(home,"runner"),instance_root:path.join(home,"instance"),macos_setup_approved:true,macos_action_approval:"start"};
  const old=process.env.HOME; process.env.HOME=home;
  try {
    const result=macosRuntimeAction("start",{state,commandRunner:fake});
    assert.equal(result.status,"NEEDS_USER_ACTION");
    assert.equal(result.action_id,"resolve_runner_ownership");
    assert.equal(result.launchctl_state,"unknown");
    assert.equal(commands.filter(x=>x[0]==="bootstrap").length,0);
  } finally { if(old===undefined) delete process.env.HOME; else process.env.HOME=old; fs.rmSync(home,{recursive:true,force:true}); }
});

test("P3 launchctl rejects an unverified post-start state",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-p3-home-"));
  const commands=[];
  const fake=(name,args)=>{ commands.push(args); if(args[0]==="list") return {ok:true,output:""}; if(args[0]==="bootstrap") return {ok:true,output:"started"}; return {ok:false,output:"not-proven"}; };
  const state={sandbox_only:true,target_environment_ready:false,installation_id:"abc12345",instance_id:"abc12345",runner_owner:"abc12345",runner_label:"codex-orchestrator-abc12345",launch_agent_label:"com.chatgpt.codex.abc12345",runner_path:path.join(home,"runner"),instance_root:path.join(home,"instance"),macos_setup_approved:true,macos_action_approval:"start"};
  const helper=path.join(state.instance_root,"runtime","native","macos","process-identity");
  const plistDir=path.join(home,"Library","LaunchAgents");
  const plist=path.join(plistDir,`${state.launch_agent_label}.plist`);
  const capability={status:"PASS",installation_id:state.installation_id,instance_path:state.instance_root,helper_path:helper,receipt_path:path.join(state.instance_root,"macos-native-helper-capability.json")};
  const old=process.env.HOME; process.env.HOME=home;
  try {
    fs.mkdirSync(plistDir,{recursive:true,mode:0o700});
    fs.writeFileSync(plist,renderLaunchAgent({label:state.launch_agent_label,runnerPath:state.runner_path,instanceRoot:state.instance_root,nativeHelperPath:helper,nativeProcessIdentity:true}),{mode:0o600});
    const result=macosRuntimeAction("start",{state,home,platform:"darwin",commandRunner:fake,capabilityVerifier:()=>capability});
    assert.equal(result.status,"ERROR"); assert.equal(result.launchctl_state,"unknown");
    assert.equal(commands.filter(x=>x[0]==="bootstrap").length,1);
  } finally { if(old===undefined) delete process.env.HOME; else process.env.HOME=old; fs.rmSync(home,{recursive:true,force:true}); }
});

test("P3 launchctl rejects start with an invalid capability or mismatched plist",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-p3-home-"));
  const commands=[];
  const fake=(name,args)=>{ commands.push(args); return args[0]==="list"?{ok:true,output:""}:{ok:false,output:"unexpected"}; };
  const state={sandbox_only:true,target_environment_ready:false,installation_id:"abc12345",instance_id:"abc12345",runner_owner:"abc12345",runner_label:"codex-orchestrator-abc12345",launch_agent_label:"com.chatgpt.codex.abc12345",runner_path:path.join(home,"runner"),instance_root:path.join(home,"instance"),macos_setup_approved:true,macos_action_approval:"start"};
  const helper=path.join(state.instance_root,"runtime","native","macos","process-identity");
  const plistDir=path.join(home,"Library","LaunchAgents");
  const plist=path.join(plistDir,`${state.launch_agent_label}.plist`);
  const capability={status:"PASS",installation_id:state.installation_id,instance_path:state.instance_root,helper_path:helper,receipt_path:path.join(state.instance_root,"macos-native-helper-capability.json")};
  const old=process.env.HOME; process.env.HOME=home;
  try {
    fs.mkdirSync(plistDir,{recursive:true,mode:0o700});
    fs.writeFileSync(plist,`<string>${helper}</string><key>ORCHESTRATOR_MACOS_NATIVE_HELPER</key><key>ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY</key>`,{mode:0o600});
    const invalidCapability=macosRuntimeAction("start",{state,home,platform:"darwin",commandRunner:fake,capabilityVerifier:()=>({status:"ERROR",error_id:"MACOS-NATIVE-CAPABILITY-CORRUPT"})});
    assert.equal(invalidCapability.status,"ERROR");
    assert.equal(commands.filter(x=>x[0]==="bootstrap").length,0);
    fs.writeFileSync(plist,"<string>/foreign/helper</string>",{mode:0o600});
    const mismatch=macosRuntimeAction("start",{state,home,platform:"darwin",commandRunner:fake,capabilityVerifier:()=>capability});
    assert.equal(mismatch.status,"ERROR");
    assert.equal(mismatch.error_id,"MACOS-PLIST-NATIVE-PATH-MISMATCH");
    assert.equal(commands.filter(x=>x[0]==="bootstrap").length,0);
  } finally { if(old===undefined) delete process.env.HOME; else process.env.HOME=old; fs.rmSync(home,{recursive:true,force:true}); }
});

test("Windows default paths preserve historical case while Mac identity is lowercase",()=>{
  const p=defaultLocalPaths({home:"/tmp/home",installationId:"ABcd1234-rest",projectKey:"app"});
  assert.match(p.control,/control-ABcd1234$/);
  assert.match(p.runner,/runner-ABcd1234$/);
  assert.match(p.runnerLabel,/codex-orchestrator-abcd1234$/);
});
