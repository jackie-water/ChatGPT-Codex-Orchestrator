import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Windows guided installer handles every setup user action",()=>{
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  const installer=fs.readFileSync(new URL("../install.ps1",import.meta.url),"utf8");
  const actions=[...cli.matchAll(/action\(state,"([^"]+)"/g)].map(x=>x[1]);
  const unique=[...new Set(actions)];
  assert.ok(unique.length>0);
  for(const action of unique){
    assert.ok(installer.includes('"'+action+'" {'),"Install.ps1 must handle "+action);
  }
});

test("AI JSON mode remains non-interactive",()=>{
  const installer=fs.readFileSync(new URL("../install.ps1",import.meta.url),"utf8");
  const start=installer.indexOf("if($Json){");
  const end=installer.indexOf("Write-Host $m.Continue",start);
  const jsonBlock=installer.slice(start,end);
  assert.match(jsonBlock,/--json/);
  assert.doesNotMatch(jsonBlock,/Read-Host/);
});
