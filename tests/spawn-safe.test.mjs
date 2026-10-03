import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {spawnSafeSync} from "../src/lib/spawn-safe.mjs";

test("safe spawn never needs a shell for argument passing",()=>{
  const r=spawnSafeSync(process.execPath,["-e","process.stdout.write(process.argv[1])","hello world"],{encoding:"utf8"});
  assert.equal(r.status,0);
  assert.equal(r.stdout,"hello world");
});

test("core Node runtime contains no shell-true child process invocation",()=>{
  for(const file of [
    "src/cli.mjs",
    "src/lib/control-env.mjs",
    "src/lib/sandbox-smoke.mjs",
    "src/lib/reporting.mjs",
    "src/lib/spawn-safe.mjs"
  ]){
    const text=fs.readFileSync(new URL("../"+file,import.meta.url),"utf8");
    assert.doesNotMatch(text,/shell\s*:\s*(?:true|process\.platform)/,file+" must not enable command shells");
  }
});


test("Windows shim runner transports arguments as Base64 JSON instead of shell text",()=>{
  const text=fs.readFileSync(new URL("../src/lib/spawn-safe.mjs",import.meta.url),"utf8");
  assert.match(text,/ORCH_SAFE_ARGS_B64/);
  assert.match(text,/Buffer\.from\(JSON\.stringify\(args\)/);
  assert.doesNotMatch(text,/cmd\.exe|\/c/i);
  assert.doesNotMatch(text,/shell\s*:\s*true/);
});
