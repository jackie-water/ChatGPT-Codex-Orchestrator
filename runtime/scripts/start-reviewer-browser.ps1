param(
  [Parameter(Mandatory=$true)][string]$ChatUrl,
  [string]$Port,
  [string]$ProfilePath
)
$ErrorActionPreference="Stop"

if($ChatUrl -notmatch '^https://chatgpt\.com/(?:g/[^/]+/)?c/[A-Za-z0-9-]+(?:[/?#].*)?$'){
  throw "Reviewer URL is not a normal ChatGPT conversation URL"
}
if([string]::IsNullOrWhiteSpace($Port)){
  $Port=if($env:ORCHESTRATOR_BROWSER_DEBUG_PORT){$env:ORCHESTRATOR_BROWSER_DEBUG_PORT}else{"9333"}
}
if([string]::IsNullOrWhiteSpace($ProfilePath)){
  $ProfilePath=if($env:ORCHESTRATOR_BROWSER_PROFILE){$env:ORCHESTRATOR_BROWSER_PROFILE}else{Join-Path $env:LOCALAPPDATA "ChatGPTCodexOrchestratorReviewer"}
}

$edge=$null
$edgeCmd=Get-Command msedge.exe -ErrorAction SilentlyContinue
if($edgeCmd){$edge=$edgeCmd.Source}
if(-not $edge){
  $programFilesX86=[Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $candidates=@(
    (Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
  )|Where-Object{$_ -and (Test-Path $_)}
  $edge=$candidates|Select-Object -First 1
}
if(-not $edge){throw "Microsoft Edge was not found"}

$up=$false
try{Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2|Out-Null;$up=$true}catch{}
if(-not $up){
  Start-Process -FilePath $edge -ArgumentList @("--remote-debugging-port=$Port","--user-data-dir=$ProfilePath","--no-first-run","https://chatgpt.com/")
  Start-Sleep -Seconds 4
}

$env:ORCHESTRATOR_BROWSER_DEBUG_PORT=$Port
node (Join-Path $PSScriptRoot "navigate-reviewer-chat.mjs") $ChatUrl
if($LASTEXITCODE -ne 0){throw "Could not navigate the dedicated reviewer browser. On first use, sign into ChatGPT in that browser profile, then retry."}
Write-Host "Reviewer browser ready on isolated debug port $Port." -ForegroundColor Green
Write-Host "Profile: $ProfilePath"
