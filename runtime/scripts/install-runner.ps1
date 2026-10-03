param(
  [Parameter(Mandatory=$true)][string]$ControlRepository,
  [Parameter(Mandatory=$true)][string]$RunnerPath,
  [Parameter(Mandatory=$true)][string]$RunnerLabel,
  [string]$RunnerName
)
$ErrorActionPreference="Stop"

if($ControlRepository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'){throw "Invalid control repository"}
if($RunnerLabel -notmatch '^[A-Za-z0-9._-]{1,64}$'){throw "Invalid runner label"}
if([string]::IsNullOrWhiteSpace($RunnerName)){$RunnerName="codex-orchestrator-"+$env:COMPUTERNAME}

gh auth status
if($LASTEXITCODE -ne 0){throw "GitHub CLI is not authenticated"}

$RunnerPath=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RunnerPath)
New-Item -ItemType Directory -Force -Path $RunnerPath|Out-Null

$configCmd=Join-Path $RunnerPath "config.cmd"
if(Test-Path $configCmd){
  Write-Host "GitHub Actions runner files already exist: $RunnerPath"
}else{
  $release=Invoke-RestMethod -Uri "https://api.github.com/repos/actions/runner/releases/latest" -Headers @{"User-Agent"="ChatGPT-Codex-Orchestrator"}
  $tag=[string]$release.tag_name
  if($tag -notmatch '^v([0-9]+\.[0-9]+\.[0-9]+)$'){throw "Could not determine GitHub Actions runner version"}
  $version=$Matches[1]
  $asset="actions-runner-win-x64-$version.zip"
  $url="https://github.com/actions/runner/releases/download/$tag/$asset"
  $zip=Join-Path $env:TEMP $asset
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $RunnerPath -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}

$settings=Join-Path $RunnerPath ".runner"
if(Test-Path $settings){
  Write-Host "Runner is already configured. Existing registration is preserved." -ForegroundColor Green
  return
}

$token=(& gh api -X POST "repos/$ControlRepository/actions/runners/registration-token" --jq .token).Trim()
if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)){throw "Could not obtain runner registration token"}

Push-Location $RunnerPath
try{
  & .\config.cmd --unattended --url "https://github.com/$ControlRepository" --token $token --name $RunnerName --labels $RunnerLabel --work "_work" --replace
  if($LASTEXITCODE -ne 0){throw "GitHub Actions runner configuration failed"}
}finally{Pop-Location}

Write-Host "Runner configured successfully." -ForegroundColor Green
Write-Host "Runner path: $RunnerPath"
Write-Host "Runner label: $RunnerLabel"
Write-Host "The runner is intentionally NOT installed as a Windows service because browser callback automation requires an interactive user session."
