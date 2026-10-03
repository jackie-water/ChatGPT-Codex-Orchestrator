import {spawnSync} from "node:child_process";

const WINDOWS_EXECUTABLES={
  gh:"gh.exe",
  git:"git.exe",
  node:"node.exe",
  powershell:"powershell.exe",
  "powershell.exe":"powershell.exe"
};

const WINDOWS_SHIMS=new Set(["codex","npm","npx"]);

const POWERSHELL_SHIM_RUNNER=[
  "$ErrorActionPreference='Stop'",
  "$name=$env:ORCH_SAFE_COMMAND",
  "$json=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORCH_SAFE_ARGS_B64))",
  "$argv=@(ConvertFrom-Json $json)",
  "$cmd=Get-Command ($name+'.cmd') -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
  "if(-not $cmd){$cmd=Get-Command $name -ErrorAction Stop | Select-Object -First 1}",
  "& $cmd.Source @argv",
  "if($null -ne $LASTEXITCODE){exit $LASTEXITCODE}else{exit 0}"
].join("; ");

export function resolveExecutable(command){
  const value=String(command||"");
  if(process.platform!=="win32") return value;
  return WINDOWS_EXECUTABLES[value.toLowerCase()]||value;
}

function spawnWindowsShim(command,args,options){
  const encodedArgs=Buffer.from(JSON.stringify(args),"utf8").toString("base64");
  const env={
    ...process.env,
    ...(options.env||{}),
    ORCH_SAFE_COMMAND:String(command),
    ORCH_SAFE_ARGS_B64:encodedArgs
  };
  return spawnSync("powershell.exe",[
    "-NoProfile",
    "-ExecutionPolicy","Bypass",
    "-Command",POWERSHELL_SHIM_RUNNER
  ],{
    ...options,
    env,
    shell:false
  });
}

export function spawnSafeSync(command,args=[],options={}){
  const name=String(command||"").toLowerCase();
  if(process.platform==="win32"&&WINDOWS_SHIMS.has(name)){
    return spawnWindowsShim(name,args,options);
  }

  return spawnSync(resolveExecutable(command),args,{
    ...options,
    shell:false
  });
}
