import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { macosPrerequisites, parseNodeMajor, migrationInventory, migrationPreflight, renderLaunchAgent, macosRuntimeAction } from "../src/lib/macos-platform.mjs";

test("Node prerequisite parser accepts supported majors and rejects v21",()=>{
  assert.equal(parseNodeMajor("v21.9.0"),21);
  assert.equal(parseNodeMajor("v22.0.0"),22);
  assert.equal(parseNodeMajor("v24.22.0"),24);
  assert.equal(typeof macosPrerequisites,"function");
});

test("macOS migration inventory is read-only and keeps credential locations private",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-home-"));
  const before=fs.readdirSync(home);
  const result=migrationInventory({home,state:{browser_port:9333}});
  assert.equal(result.platform,process.platform);
  assert.equal(result.browser.port,9333);
  assert.deepEqual(fs.readdirSync(home),before);
  assert.doesNotMatch(JSON.stringify(result),/token|secret|oauth|password/i);
});

test("migration preflight reports conflicts without stopping or switching runners",()=>{
  const result=migrationPreflight({home:fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-home-")),state:{runner_label:"never-present"}});
  assert.equal(result.mutations_performed,false);
  assert.equal(result.rollback.automatic,false);
  assert.ok(Array.isArray(result.conflicts));
});

test("LaunchAgent rendering separates reverse-DNS labels from filesystem paths",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-home-"));
  const previousHome=process.env.HOME;
  process.env.HOME=home;
  try {
    const runner=path.join(home,"runner");
    const instance=path.join(home,"instance");
    fs.mkdirSync(runner,{mode:0o700});
    fs.mkdirSync(instance,{mode:0o700});

    assert.throws(()=>renderLaunchAgent({label:"x",runnerPath:runner,instanceRoot:instance}),/reverse-DNS/);
    assert.throws(()=>renderLaunchAgent({label:"com.example.orchestrator",runnerPath:"/tmp/runner",instanceRoot:"/tmp/instance"}),/HOME-scoped/);

    const plist=renderLaunchAgent({
      label:"com.example.orchestrator",
      runnerPath:runner,
      instanceRoot:instance,
      programArguments:["--value", "a&b<c>d\"e'e"]
    });
    assert.match(plist,/com\.example\.orchestrator/);
    assert.match(plist,/a&amp;b&lt;c&gt;d&quot;e&apos;e/);
  } finally {
    if(previousHome===undefined) delete process.env.HOME;
    else process.env.HOME=previousHome;
  }
});

test("runtime install renders native identity only for a verified same-instance capability",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-runtime-"));
  const previousHome=process.env.HOME; process.env.HOME=home;
  const instance=path.join(home,"instance"), runner=path.join(instance,"runner");
  fs.mkdirSync(instance,{recursive:true,mode:0o700}); fs.writeFileSync(runner,"runner\n",{mode:0o700});
  const state={sandbox_only:true,target_environment_ready:false,instance_id:"instance-1",installation_id:"install-1",runner_owner:"install-1",runner_label:"runner-1",launch_agent_label:"com.chatgpt.codex.runner",runner_path:runner,instance_root:instance,macos_setup_approved:true,macos_action_approval:"install"};
  const helper=path.join(instance,"runtime","native","macos","process-identity");
  const commandRunner=(command,args)=>command==="launchctl"&&args[0]==="list"?{ok:true,output:""}:{ok:false,output:"unexpected"};
  try {
    const result=macosRuntimeAction("install",{state,home,platform:"darwin",commandRunner,capabilityVerifier:()=>({status:"PASS",installation_id:"install-1",instance_path:instance,helper_path:helper})});
    assert.equal(result.status,"PASS");
    const plist=fs.readFileSync(result.plist,"utf8");
    assert.match(plist,/ORCHESTRATOR_MACOS_NATIVE_HELPER/); assert.ok(plist.includes(helper));
    assert.match(plist,/ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY/);
  } finally { if(previousHome===undefined) delete process.env.HOME; else process.env.HOME=previousHome; }
});

test("runtime install rejects forged or wrong-instance native capability before rendering",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-runtime-reject-"));
  const previousHome=process.env.HOME; process.env.HOME=home;
  const instance=path.join(home,"instance"), runner=path.join(instance,"runner");
  fs.mkdirSync(instance,{recursive:true,mode:0o700}); fs.writeFileSync(runner,"runner\n",{mode:0o700});
  const state={sandbox_only:true,target_environment_ready:false,instance_id:"instance-1",installation_id:"install-1",runner_owner:"install-1",runner_label:"runner-1",launch_agent_label:"com.chatgpt.codex.runner",runner_path:runner,instance_root:instance,macos_setup_approved:true,macos_action_approval:"install"};
  const commandRunner=(command,args)=>command==="launchctl"&&args[0]==="list"?{ok:true,output:""}:{ok:false,output:"unexpected"};
  try {
    for(const capability of [{status:"ERROR",error_id:"MACOS-NATIVE-CAPABILITY-CORRUPT"},{status:"PASS",installation_id:"other",instance_path:instance,helper_path:path.join(instance,"runtime","native","macos","process-identity")},{status:"PASS",installation_id:"install-1",instance_path:path.join(home,"other"),helper_path:path.join(home,"other","runtime","native","macos","process-identity")}]) {
      const result=macosRuntimeAction("install",{state,home,platform:"darwin",commandRunner,capabilityVerifier:()=>capability});
      assert.equal(result.status,"ERROR"); assert.equal(fs.existsSync(path.join(home,"Library","LaunchAgents","com.chatgpt.codex.runner.plist")),false);
    }
  } finally { if(previousHome===undefined) delete process.env.HOME; else process.env.HOME=previousHome; }
});

test("runtime start verifies the same helper and persisted plist before bootstrap",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-start-")); const previousHome=process.env.HOME; process.env.HOME=home;
  const instance=path.join(home,"instance"), runner=path.join(instance,"runner"), helper=path.join(instance,"runtime","native","macos","process-identity"), plistDir=path.join(home,"Library","LaunchAgents"), plist=path.join(plistDir,"com.chatgpt.codex.runner.plist");
  fs.mkdirSync(path.dirname(helper),{recursive:true,mode:0o700}); fs.mkdirSync(plistDir,{recursive:true,mode:0o700}); fs.mkdirSync(instance,{recursive:true,mode:0o700}); fs.writeFileSync(runner,"runner\n",{mode:0o700}); fs.writeFileSync(helper,"helper\n",{mode:0o700});
  const state={sandbox_only:true,target_environment_ready:false,instance_id:"instance-1",installation_id:"install-1",runner_owner:"install-1",runner_label:"runner-1",launch_agent_label:"com.chatgpt.codex.runner",runner_path:runner,instance_root:instance,macos_setup_approved:true,macos_action_approval:"start"};
  const capability={status:"PASS",installation_id:"install-1",instance_path:instance,helper_path:helper,receipt_path:path.join(instance,"macos-native-helper-capability.json")}; let launches=[];
  const commandRunner=(command,args)=>{ launches.push(args); return command==="launchctl"&&args[0]==="list"?{ok:true,output:""}:{ok:false,output:"unexpected"}; };
  try {
    fs.writeFileSync(plist,`<string>${helper}</string><key>ORCHESTRATOR_MACOS_NATIVE_HELPER</key><key>ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY</key>`,{mode:0o600});
    const blocked=macosRuntimeAction("start",{state,home,platform:"darwin",commandRunner,capabilityVerifier:()=>({...capability, status:"ERROR",error_id:"tampered"})}); assert.equal(blocked.status,"ERROR"); assert.equal(launches.some(args=>args[0]==="bootstrap"),false);
    launches=[]; fs.writeFileSync(plist,"<string>/foreign/helper</string>",{mode:0o600}); const mismatch=macosRuntimeAction("start",{state,home,platform:"darwin",commandRunner,capabilityVerifier:()=>capability}); assert.equal(mismatch.status,"ERROR"); assert.equal(mismatch.error_id,"MACOS-PLIST-NATIVE-PATH-MISMATCH"); assert.equal(launches.some(args=>args[0]==="bootstrap"),false);
  } finally { if(previousHome===undefined) delete process.env.HOME; else process.env.HOME=previousHome; }
});

test("runtime start accepts the renderer's XML-escaped helper path and rejects raw or injected variants",()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"orch-macos-ampersand-&lt;-home-")); const previousHome=process.env.HOME; process.env.HOME=home;
  const instance=path.join(home,"instance & < > \" '"); const runner=path.join(instance,"runner"); const helper=path.join(instance,"runtime","native","macos","process-identity"); const plistDir=path.join(home,"Library","LaunchAgents"); const plist=path.join(plistDir,"com.chatgpt.codex.runner.plist");
  fs.mkdirSync(path.dirname(helper),{recursive:true,mode:0o700}); fs.mkdirSync(plistDir,{recursive:true,mode:0o700}); fs.writeFileSync(runner,"runner\n",{mode:0o700}); fs.writeFileSync(helper,"helper\n",{mode:0o700});
  const state={sandbox_only:true,target_environment_ready:false,instance_id:"instance-xml",installation_id:"install-xml",runner_owner:"install-xml",runner_label:"runner-xml",launch_agent_label:"com.chatgpt.codex.runner",runner_path:runner,instance_root:instance,macos_setup_approved:true,macos_action_approval:"start"};
  const capability={status:"PASS",installation_id:state.installation_id,instance_path:instance,helper_path:helper,receipt_path:path.join(instance,"macos-native-helper-capability.json")}; let bootstraps=0;
  const commandRunner=(command,args)=>{ if(command==="launchctl"&&args[0]==="list") return {ok:true,output:""}; if(args[0]==="bootstrap") { bootstraps++; return {ok:true,output:"started"}; } if(args[0]==="print") return {ok:true,output:"verified"}; return {ok:false,output:"unexpected"}; };
  try {
    fs.writeFileSync(plist,renderLaunchAgent({label:state.launch_agent_label,runnerPath:runner,instanceRoot:instance,nativeHelperPath:helper,nativeProcessIdentity:true}),{mode:0o600});
    const accepted=macosRuntimeAction("start",{state,home,platform:"darwin",commandRunner,capabilityVerifier:()=>capability}); assert.equal(accepted.status,"PASS"); assert.equal(bootstraps,1);
    bootstraps=0;
    fs.writeFileSync(plist,`<key>ORCHESTRATOR_MACOS_NATIVE_HELPER</key><string>${helper}</string><key>ORCHESTRATOR_MACOS_NATIVE_PROCESS_IDENTITY</key><string>1</string>`,{mode:0o600});
    const rejected=macosRuntimeAction("start",{state,home,platform:"darwin",commandRunner,capabilityVerifier:()=>capability}); assert.equal(rejected.error_id,"MACOS-PLIST-NATIVE-PATH-MISMATCH"); assert.equal(bootstraps,0);
  } finally { if(previousHome===undefined) delete process.env.HOME; else process.env.HOME=previousHome; }
});
