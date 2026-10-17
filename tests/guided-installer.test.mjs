import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Windows guided installer handles every setup user action",()=>{
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  const installer=fs.readFileSync(new URL("../install.ps1",import.meta.url),"utf8");
  const actions=[...cli.matchAll(/action\(state,"([^"]+)"/g)].map(x=>x[1]);
  const unique=[...new Set(actions)];
  const macOnly=new Set(["macos_setup_approval"]);
  assert.ok(unique.length>0);
  for(const action of unique.filter(action=>!macOnly.has(action))){
    assert.ok(installer.includes('"'+action+'" {'),"Install.ps1 must handle "+action);
  }
  assert.ok(unique.includes("macos_setup_approval"),"Darwin setup action must remain explicit");
});

test("Darwin-only setup action is guarded and handled by CLI answer",()=>{
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  const darwinSetup=cli.indexOf('if(process.platform==="darwin")');
  const macAction=cli.indexOf('action(state,"macos_setup_approval"');
  const answerBranch=cli.indexOf('if (actionId === "macos_setup_approval")');
  assert.ok(darwinSetup>=0,"macOS setup must have an explicit platform guard");
  assert.ok(macAction>darwinSetup,"macOS-only action must be emitted inside the Darwin setup guard");
  assert.ok(answerBranch>=0,"macOS-only action must be handled by CLI answer");
});

test("AI JSON mode remains non-interactive",()=>{
  const installer=fs.readFileSync(new URL("../install.ps1",import.meta.url),"utf8");
  const start=installer.indexOf("if($Json){");
  const end=installer.indexOf("Write-Host $m.Continue",start);
  const jsonBlock=installer.slice(start,end);
  assert.match(jsonBlock,/--json/);
  assert.doesNotMatch(jsonBlock,/Read-Host/);
});
