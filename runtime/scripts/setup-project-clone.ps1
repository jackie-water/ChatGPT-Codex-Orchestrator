param([Parameter(Mandatory=$true)][string]$Project)
$ErrorActionPreference="Stop"
$Root=Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "runtime-context.ps1")
$ConfigPath=Get-OrchestratorConfigPath
$RegistryPath=Join-Path $Root "projects.json"
if(-not (Test-Path $ConfigPath)){throw "Missing local config: $ConfigPath"}
if(-not (Test-Path $RegistryPath)){throw "Missing project registry: $RegistryPath"}
. $ConfigPath
$registry=Get-Content -Raw $RegistryPath|ConvertFrom-Json
$key=$Project.ToLowerInvariant()
$projectProp=$registry.projects.PSObject.Properties[$key]
if(-not $projectProp){throw "Unknown project: $key"}
$p=$projectProp.Value
if($p.PSObject.Properties.Name -contains "enabled" -and -not [bool]$p.enabled){throw "PROJECT_DISABLED: project is not activated yet"}
$pathVar=Get-Variable -Name "PROJECT_LOCAL_PATHS" -ErrorAction SilentlyContinue
$target=$null
if($pathVar -and $pathVar.Value -is [System.Collections.IDictionary] -and $pathVar.Value.Contains([string]$p.local_path_key)){$target=[string]$pathVar.Value[[string]$p.local_path_key]}
if([string]::IsNullOrWhiteSpace($target)){throw "No local clone path configured for project '$key'"}
$target=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($target)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null
if(-not (Test-Path $target)){gh repo clone ([string]$p.repository) $target;if($LASTEXITCODE -ne 0){throw "Repository clone failed"}}
Push-Location $target
try{
  git fetch origin --prune;if($LASTEXITCODE -ne 0){throw "git fetch failed"}
  git checkout ([string]$p.default_branch);if($LASTEXITCODE -ne 0){throw "default branch checkout failed"}
  git reset --hard ("origin/"+[string]$p.default_branch);if($LASTEXITCODE -ne 0){throw "default branch reset failed"}
  $checkpoint=[string]$p.checkpoint_branch
  git show-ref --verify --quiet "refs/remotes/origin/$checkpoint"
  if($LASTEXITCODE -ne 0){
    $bootstrapRef="origin/"+[string]$p.default_branch+":refs/heads/"+$checkpoint
    git push origin $bootstrapRef;if($LASTEXITCODE -ne 0){throw "checkpoint branch bootstrap failed"}
  }
}finally{Pop-Location}
Write-Host "Project clone ready: $key -> $target" -ForegroundColor Green
Write-Host "Codex folder trust must be completed before unattended jobs." -ForegroundColor Yellow
