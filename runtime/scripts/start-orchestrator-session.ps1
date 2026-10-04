param([Parameter(Mandatory=$true)][string]$Project,[string]$RunnerPath)
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
if(-not $registry.projects.PSObject.Properties[$key]){throw "Unknown project: $key"}
if([string]::IsNullOrWhiteSpace($RunnerPath)){$RunnerPath=if($env:CODEX_ORCHESTRATOR_RUNNER_PATH){$env:CODEX_ORCHESTRATOR_RUNNER_PATH}else{"C:\actions-runner-codex-orchestrator"}}
if(-not (Test-Path $RunnerPath)){throw "GitHub runner directory not found: $RunnerPath"}
$RunnerPath=(Resolve-Path $RunnerPath).Path
if(-not (Test-Path (Join-Path $RunnerPath "run.cmd"))){throw "GitHub runner run.cmd not found: $RunnerPath"}

function Get-OrchestratorRunnerProcess{
  $root=$RunnerPath.TrimEnd('\')+'\'
  @(Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'" -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase)})
}
$runnerProcesses=@(Get-OrchestratorRunnerProcess)
if($runnerProcesses.Count -eq 0){
  Write-Host "Starting isolated interactive GitHub runner..." -ForegroundColor Yellow
  $escaped=$RunnerPath.Replace("'","''")
  $runnerCommand="Set-Location '$escaped'; .\run.cmd"
  Start-Process -FilePath "powershell.exe" -WorkingDirectory $RunnerPath -ArgumentList @("-NoLogo","-NoExit","-ExecutionPolicy","Bypass","-Command",$runnerCommand)|Out-Null
  $deadline=(Get-Date).AddSeconds(15)
  do{Start-Sleep -Milliseconds 500;$runnerProcesses=@(Get-OrchestratorRunnerProcess)}while($runnerProcesses.Count -eq 0 -and (Get-Date)-lt $deadline)
  if($runnerProcesses.Count -eq 0){throw "Runner.Listener.exe was not detected within 15 seconds"}
}
& (Join-Path $PSScriptRoot "start-reviewer-browser.ps1")
& (Join-Path $PSScriptRoot "retry-pending-callbacks.ps1")
& (Join-Path $PSScriptRoot "preflight.ps1") -Project $Project
Write-Host "ORCHESTRATOR SESSION READY project=$Project" -ForegroundColor Green
