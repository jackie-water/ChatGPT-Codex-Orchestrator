import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { isOptionalPushurlQuery, normalizeOptionalPushurlResult, spawnSync as dispatcherSpawnSync, validateSandboxRemotes } from "../runtime/scripts/macos-dispatch.mjs";

const cli = fs.readFileSync("src/cli.mjs", "utf8");
const env = fs.readFileSync("src/lib/control-env.mjs", "utf8");
const dispatch = fs.readFileSync("runtime/scripts/macos-dispatch.mjs", "utf8");

test("macOS setup creates before exact generated-repository confirmation", () => {
  const setup = cli.indexOf("function runSetup() {");
  const start = cli.indexOf('if(process.platform==="darwin")',setup);
  const end = cli.indexOf("\n  state.installation_id ||= crypto.randomUUID();",start);
  assert.ok(setup>=0&&start>setup&&end>start);
  const section = cli.slice(start,end);
  assert.ok(section.indexOf("if(!state.github_plugin_authorized)") < section.indexOf("prepareControlEnvironment"));
  assert.doesNotMatch(section.slice(0, section.indexOf("prepareControlEnvironment")), /github_plugin_authorization_verified!==true/);
});

test("generated Sandbox is instance-scoped and dirty clones are never overwritten", () => {
  assert.match(env, /instances\",short,\"automation\",sandboxProjectKey/);
  assert.match(env, /inspectExistingClone\(sandboxClonePath,"Sandbox"\)/);
  assert.match(env, /inspectExistingClone\(paths\.control,"Control"\)/);
});

test("macOS dispatcher binds the enabled Sandbox to its configured private repository", () => {
  assert.match(dispatch, /project\.repository!==planned\.plan\.repository/);
  assert.match(dispatch, /config\",\"--get-all\",\"remote\.origin\.url/);
  assert.match(dispatch, /config\",\"--get-all\",\"remote\.origin\.pushurl/);
  assert.match(dispatch, /fetch and effective push URLs do not exactly match/);
  assert.match(dispatch, /Sandbox fetch and effective push URLs do not exactly match the private configured repository/);
});

test("macOS dispatcher validates actual local Sandbox remotes and fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-macos-remotes-"));
  const repo = path.join(root, "sandbox");
  const expected = "trusted/sandbox-fixture";
  const git = args => { const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); return result; };
  const makeRepo = () => { fs.mkdirSync(repo, { recursive: true }); assert.equal(spawnSync("git", ["-C", repo, "init", "-q"], { encoding: "utf8" }).status, 0); git(["remote", "add", "origin", `https://github.com/${expected}.git`]); };
  const rejects = (fn, message) => assert.throws(fn, /Sandbox (?:fetch and effective push URLs|remote configuration)/, message);
  try {
    makeRepo();
    const calls = [];
    const observedExec = (command, args, options) => { calls.push([command, args]); assert.notEqual(command, "codex"); return dispatcherSpawnSync(command, args, options); };
    assert.deepEqual(validateSandboxRemotes(repo, expected, observedExec).pushUrls, [`https://github.com/${expected}.git`]);
    assert.deepEqual(calls.map(x => x[1].slice(2)), [["config", "--get-all", "remote.origin.url"], ["config", "--get-all", "remote.origin.pushurl"]]);
    git(["config", "--add", "remote.origin.pushurl", `git@github.com:${expected}.git`]);
    assert.equal(validateSandboxRemotes(repo, expected, observedExec).pushUrls.length, 1);

    git(["config", "--unset-all", "remote.origin.pushurl"]);
    git(["config", "--add", "remote.origin.pushurl", "https://github.com/wrong/repository.git"]);
    rejects(() => validateSandboxRemotes(repo, expected), "wrong pushurl");
    git(["config", "--add", "remote.origin.pushurl", `https://github.com/${expected}.git`]);
    rejects(() => validateSandboxRemotes(repo, expected), "multiple pushurls");
    git(["config", "--unset-all", "remote.origin.pushurl"]);
    git(["config", "--add", "remote.origin.pushurl", "not-a-github-remote"]);
    rejects(() => validateSandboxRemotes(repo, expected), "malformed pushurl");
    git(["config", "--unset-all", "remote.origin.pushurl"]);
    git(["config", "--add", "remote.origin.url", "https://github.com/other/repository.git"]);
    rejects(() => validateSandboxRemotes(repo, expected), "wrong origin");
    git(["config", "--unset-all", "remote.origin.url"]);
    rejects(() => validateSandboxRemotes(repo, expected), "missing origin");
    git(["config", "--add", "remote.origin.url", `https://github.com/${expected}.git`]);
    git(["config", "--add", "remote.origin.url", `https://github.com/${expected}.git`]);
    rejects(() => validateSandboxRemotes(repo, expected), "multiple origins");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("macOS dispatcher recognizes only the exact optional pushurl argv shape", () => {
  const repo = "/isolated/home/.chatgpt-codex-orchestrator/instances/i/automation/sandbox-x";
  assert.equal(isOptionalPushurlQuery("git", ["-C", repo, "config", "--get-all", "remote.origin.pushurl"]), true);
  assert.equal(isOptionalPushurlQuery("git", ["config", "--get-all", "remote.origin.pushurl"]), false);
  assert.equal(isOptionalPushurlQuery("git", ["-C", repo, "config", "--get-all", "remote.origin.pushurl", "extra"]), false);
  assert.equal(isOptionalPushurlQuery("git", ["-C", "", "config", "--get-all", "remote.origin.pushurl"]), false);
  assert.equal(isOptionalPushurlQuery("gh", ["-C", repo, "config", "--get-all", "remote.origin.pushurl"]), false);
  const query = ["-C", repo, "config", "--get-all", "remote.origin.pushurl"];
  assert.equal(normalizeOptionalPushurlResult("git", query, { status: 1, stdout: "", stderr: "" }).status, 0);
  for (const result of [
    { status: 1, stdout: "unexpected\n", stderr: "" },
    { status: 1, stdout: "", stderr: "fatal\n" },
    { status: 2, stdout: "", stderr: "" },
    { status: null, stdout: "", stderr: "", error: new Error("spawn") },
  ]) assert.notEqual(normalizeOptionalPushurlResult("git", query, result).status, 0);
  assert.equal(normalizeOptionalPushurlResult("git", ["-C", repo, "config", "--get-all", "remote.origin.url"], { status: 1, stdout: "", stderr: "" }).status, 1);
});

test("macOS dispatcher rejects remote config status, stderr, and spawn failures", () => {
  const repo = "/isolated/repo";
  const good = (command, args) => ({ status: 0, stdout: args.at(-1) === "remote.origin.url" ? "https://github.com/trusted/sandbox-fixture.git\n" : "", stderr: "" });
  for (const failure of [
    { status: 2, stdout: "", stderr: "" },
    { status: 0, stdout: "", stderr: "fatal\n" },
    { status: null, stdout: "", stderr: "", error: new Error("spawn failed") },
  ]) assert.throws(() => validateSandboxRemotes(repo, "trusted/sandbox-fixture", (command, args) => args.at(-1) === "remote.origin.url" ? failure : good(command, args)), /Sandbox remote configuration could not be read/);
});

test("Darwin authorization records independently verified generated identities without inferring a Chat route", () => {
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"codex-p3-auth-synthetic-"));
  const home=path.join(root,"home"),stateDir=path.join(home,".chatgpt-codex-orchestrator");
  fs.mkdirSync(stateDir,{recursive:true,mode:0o700});
  const stateFile=path.join(stateDir,"install-state.json");
  const chatUrl="https://chatgpt.com/g/project/c/6ad1852c-b7a4-83ec-aeab-6b83a28ea58f";
  const base={schema_version:1,preferred_language:"en",completed:[],installation_id:"abcd1234-install",instance_id:"abcd1234",github_login:"trusted",
    instance_root:path.join(stateDir,"instances","abcd1234"),reviewer_chat_url:chatUrl,control_environment_ready:true,
    control_repository:"trusted/chatgpt-codex-orchestrator-control-abcd1234",sandbox_repository:"trusted/chatgpt-codex-orchestrator-sandbox-abcd1234",target_environment_ready:false};
  const input={};let verificationFailure=false,verificationCalls=0,saves=0;const emissions=[];
  const save=state=>fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
  const context=vm.createContext({
    process:{platform:"darwin",env:{HOME:home}},
    loadState:()=>JSON.parse(fs.readFileSync(stateFile,"utf8")),ensureStateLanguage:()=>"en",valueOf:flag=>input[flag]||"",t:()=>"saved",
    verifyMacosGeneratedRepositories:({state})=>{
      verificationCalls++;assert.equal(state.installation_id,base.installation_id);assert.equal(state.control_repository,base.control_repository);assert.equal(state.sandbox_repository,base.sandbox_repository);
      if(verificationFailure) throw new Error("Synthetic immutable repository identity mismatch");
      return {control_repository_id:"101",sandbox_repository_id:"202"};
    },
    saveState:state=>{saves++;save(state);},emit:(payload,exitCode=0)=>{const emission={payload,exitCode};emissions.push(emission);return emission;}
  });
  const start=cli.indexOf("function answer() {"),end=cli.indexOf("function runSetup() {",start);assert.ok(start>=0&&end>start);
  vm.runInContext(cli.slice(start,end)+"\nthis.invokeAnswer=answer;",context);
  const run=(overrides={},state=base)=>{
    save(state);for(const key of Object.keys(input))delete input[key];
    Object.assign(input,{"--action":"generated_repo_authorization","--control-repository":base.control_repository,"--sandbox-repository":base.sandbox_repository,"--chat-url":chatUrl},overrides);
    context.invokeAnswer();return emissions.at(-1);
  };
  try {
    for(const [overrides,state,error] of [
      [{"--value":"true"},base,"AUTH-005"],
      [{"--control-repository":"evil/control"},base,"AUTH-006"],
      [{"--sandbox-repository":"evil/sandbox"},base,"AUTH-006"],
      [{"--chat-url":"https://chatgpt.com/c/chat-212"},base,"AUTH-007"],
      [{}, {...base,control_environment_ready:false},"AUTH-006"]
    ]){
      const result=run(overrides,state);assert.equal(result.exitCode,1);assert.equal(result.payload.error_id,error);assert.equal(saves,0);assert.equal(verificationCalls,0);
      assert.equal(JSON.parse(fs.readFileSync(stateFile,"utf8")).github_plugin_authorization_verified,undefined);
    }
    verificationFailure=true;let result=run();assert.equal(result.exitCode,1);assert.equal(result.payload.error_id,"AUTH-008");assert.equal(saves,0);assert.equal(verificationCalls,1);
    verificationFailure=false;result=run();assert.equal(result.exitCode,0);assert.equal(result.payload.status,"PASS");assert.equal(saves,1);assert.equal(verificationCalls,2);
    const saved=JSON.parse(fs.readFileSync(stateFile,"utf8"));
    assert.equal(saved.github_plugin_authorization_verified,true);
    assert.equal(saved.github_plugin_authorization_installation_id,base.installation_id);
    assert.equal(saved.github_plugin_authorization_control_repository,base.control_repository);
    assert.equal(saved.github_plugin_authorization_sandbox_repository,base.sandbox_repository);
    assert.equal(saved.github_plugin_authorization_chat_url,chatUrl);
    assert.equal(saved.control_repository_id,"101");assert.equal(saved.sandbox_repository_id,"202");assert.equal(saved.target_environment_ready,false);
    assert.equal(Object.hasOwn(saved,"sandbox_review_route"),false);assert.equal(fs.statSync(stateFile).mode&0o777,0o600);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
