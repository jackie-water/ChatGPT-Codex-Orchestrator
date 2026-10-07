import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createServer} from "node:http";
import path from "node:path";

const script=path.resolve("runtime/scripts/start-reviewer-browser.ps1");
const source = await import("node:fs").then(fs => fs.readFileSync(script,"utf8"));
const powershell=(assignments,args="")=>{
  const setup=assignments.map(([name,value])=>
    `[Environment]::SetEnvironmentVariable('${name}',${value === null ? "$null" : `'${value}'`},'Process')`
  ).join("; ");
  try {
    execFileSync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",`${setup}; & '${script}' ${args}`],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
    return "";
  } catch(error) {
    return `${error.message ?? ""}${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
};

test("already-running browser is probed before Edge and profile discovery",()=>{
  assert.ok(source.indexOf('Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version"') < source.indexOf('Get-Command msedge.exe'));
  assert.match(source,/Port -notmatch '\^\\d\+\$'/);
});

test("already-up debug endpoint succeeds without Edge discovery",async()=>{
  const server=createServer((request,response)=>{
    if(request.url === "/json/version") { response.end('{"Browser":"Edge/1"}'); return; }
    response.statusCode=404; response.end();
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const port=server.address().port;
    const output=powershell([
      ["ProgramFiles(x86)",null], ["ProgramFiles",null], ["LOCALAPPDATA",null],
      ["ORCHESTRATOR_BROWSER_PROFILE",null]
    ],`-Port '${port}'`);
    assert.equal(output,"");
  } finally { server.close(); }
},{skip: process.platform !== "win32"});

for(const missing of ["ProgramFiles(x86)","ProgramFiles","LOCALAPPDATA"]){
  test(`missing ${missing} does not cause a Join-Path parameter error`,{skip: process.platform !== "win32"},()=>{
    const output=powershell([
      ["ProgramFiles(x86)",missing === "ProgramFiles(x86)" ? null : "C:\\missing-edge-x86"],
      ["ProgramFiles",missing === "ProgramFiles" ? null : "C:\\missing-edge"],
      ["LOCALAPPDATA",missing === "LOCALAPPDATA" ? null : "C:\\missing-localappdata"],
      ["ORCHESTRATOR_BROWSER_PROFILE","C:\\reviewer-profile"]
    ]);
    assert.match(output,/Microsoft Edge was not found/);
    assert.doesNotMatch(output,/Cannot bind argument to parameter 'Path' because it is null/);
  });
}

test("missing LOCALAPPDATA makes the default profile path error explicit",{skip: process.platform !== "win32"},()=>{
  const output=powershell([
    ["ProgramFiles(x86)",null],
    ["ProgramFiles",null],
    ["LOCALAPPDATA",null],
    ["ORCHESTRATOR_BROWSER_PROFILE",null]
  ]);
  assert.match(output,/A browser profile path is required when LOCALAPPDATA is unavailable/);
  assert.doesNotMatch(output,/Cannot bind argument to parameter 'Path' because it is null/);
});
