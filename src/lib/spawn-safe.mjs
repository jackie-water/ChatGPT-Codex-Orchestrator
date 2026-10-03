import {spawnSync} from "node:child_process";

const WINDOWS_EXECUTABLES={
  codex:"codex.cmd",
  gh:"gh.exe",
  git:"git.exe",
  node:"node.exe",
  powershell:"powershell.exe",
  "powershell.exe":"powershell.exe"
};

export function resolveExecutable(command){
  const value=String(command||"");
  if(process.platform!=="win32") return value;
  return WINDOWS_EXECUTABLES[value.toLowerCase()]||value;
}

export function spawnSafeSync(command,args=[],options={}){
  return spawnSync(resolveExecutable(command),args,{
    ...options,
    shell:false
  });
}
