param([Parameter(Mandatory=$true)][string]$Project)
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$ConfigPath = Join-Path $HOME ".chatgpt-codex-orchestrator\config.ps1"
$RegistryPath = Join-Path $Root "projects.json"
if (-not (Test-Path $ConfigPath)) { throw "Missing local config: $ConfigPath" }

. $ConfigPath
$registry = Get-Content -Raw $RegistryPath | ConvertFrom-Json
$key = $Project.ToLowerInvariant()
$projectProp = $registry.projects.PSObject.Properties[$key]
if (-not $projectProp) { throw "Unknown project: $key" }
$p = $projectProp.Value

if (-not ($p.PSObject.Properties.Name -contains "max_iterations")) { throw "Project max_iterations is required" }
if ([int]$p.max_iterations -lt 1 -or [int]$p.max_iterations -gt 10) { throw "Project max_iterations must be between 1 and 10" }

if ($p.PSObject.Properties.Name -contains "prompt_limits" -and $null -ne $p.prompt_limits) {
  if ([int]$p.prompt_limits.initial_max_chars -lt 1000) { throw "Project initial prompt limit is invalid" }
  if ([int]$p.prompt_limits.revise_max_chars -lt 1000) { throw "Project revise prompt limit is invalid" }
  if ([int]$p.prompt_limits.revise_max_chars -gt [int]$p.prompt_limits.initial_max_chars) {
    throw "Project revise prompt limit must not exceed initial prompt limit"
  }
}

$allowedValidationExecutables = if ($p.PSObject.Properties.Name -contains "allowed_validation_executables" -and $null -ne $p.allowed_validation_executables) {
  @($p.allowed_validation_executables | ForEach-Object { ([string]$_).ToLowerInvariant() })
} else { @("git") }
if ($p.PSObject.Properties.Name -contains "default_validation_steps" -and $null -ne $p.default_validation_steps) {
  foreach ($validationStep in @($p.default_validation_steps)) {
    $cmd = ([string]$validationStep.command).ToLowerInvariant()
    if ($cmd -notin $allowedValidationExecutables) { throw "Project default validation command outside allow-list: $cmd" }
  }
}

if ($p.PSObject.Properties.Name -contains "code_review" -and [bool]$p.code_review.enabled) {
  if ([string]::IsNullOrWhiteSpace([string]$p.code_review.review_model)) { throw "Code review model is required when code review is enabled" }
  if ([string]::IsNullOrWhiteSpace([string]$p.code_review.review_reasoning)) { throw "Code review reasoning is required when code review is enabled" }
}

$missing = @()
foreach ($cmd in @("git","gh","node","codex")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { $missing += $cmd }
}
if ($missing.Count) { throw "Missing commands: $($missing -join ', ')" }

$syntaxFailures = @()
foreach ($scriptName in @(
  "run-codex.ps1",
  "run-code-review.ps1",
  "merge-approved.ps1",
  "publish-checkpoint.ps1",
  "publish-code-review.ps1",
  "wake-chat.ps1",
  "setup-project-clone.ps1",
  "start-orchestrator-session.ps1",
  "retry-pending-callbacks.ps1",
  "start-reviewer-browser.ps1",
  "install-runner.ps1",
  "preflight.ps1"
)) {
  $tokens = $null
  $errors = $null
  $scriptPath = Join-Path $PSScriptRoot $scriptName
  if (-not (Test-Path $scriptPath)) {
    $syntaxFailures += ($scriptName + ": missing required runtime script")
    continue
  }
  [System.Management.Automation.Language.Parser]::ParseFile(
    $scriptPath,
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null

  if ($errors -and $errors.Count -gt 0) {
    foreach ($parseError in $errors) {
      $syntaxFailures += ($scriptName + ":" + $parseError.Extent.StartLineNumber + ": " + $parseError.Message)
    }
  }
}

if ($syntaxFailures.Count -gt 0) {
  throw ("PowerShell parser validation failed:" + [Environment]::NewLine + ($syntaxFailures -join [Environment]::NewLine))
}

$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Node.js 22+ is required for browser wake automation" }

node --check (Join-Path $PSScriptRoot "wake-chat.mjs")
if ($LASTEXITCODE -ne 0) { throw "wake-chat.mjs syntax validation failed" }
node --check (Join-Path $PSScriptRoot "navigate-reviewer-chat.mjs")
if ($LASTEXITCODE -ne 0) { throw "navigate-reviewer-chat.mjs syntax validation failed" }

$pathVar = Get-Variable -Name "PROJECT_LOCAL_PATHS" -ErrorAction SilentlyContinue
$repoPath = $null
if ($pathVar -and $pathVar.Value -is [System.Collections.IDictionary] -and $pathVar.Value.Contains([string]$p.local_path_key)) {
  $repoPath = [string]$pathVar.Value[[string]$p.local_path_key]
}
if ([string]::IsNullOrWhiteSpace($repoPath) -or -not (Test-Path $repoPath)) { throw "Automation clone missing for project '$key'" }

$routeVar = Get-Variable -Name "PROJECT_REVIEW_ROUTES" -ErrorAction SilentlyContinue
$reviewUrl = $null
if ($routeVar -and $routeVar.Value -is [System.Collections.IDictionary] -and $routeVar.Value.Contains($key)) {
  $reviewUrl = [string]$routeVar.Value[$key]
}
if ([string]::IsNullOrWhiteSpace($reviewUrl) -or $reviewUrl -notmatch '^https://chatgpt\.com/') {
  throw "Project reviewer Chat URL missing for '$key'"
}

gh auth status
if ($LASTEXITCODE -ne 0) { throw "GitHub CLI is not authenticated" }

codex --version
if ($LASTEXITCODE -ne 0) { throw "Codex CLI unavailable" }

$reviewHelp = & codex review --help 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($reviewHelp -match "--base")) {
  throw "Installed Codex CLI does not support the required non-interactive 'codex review --base' command"
}

Push-Location $repoPath
try {
  git fetch origin --prune
  if ($LASTEXITCODE -ne 0) { throw "Cannot fetch project origin" }

  $originUrl = (git remote get-url origin).Trim()
  $repoPattern = "(?i)github\.com[:/]" + [regex]::Escape([string]$p.repository) + "(\.git)?$"
  if ($originUrl -notmatch $repoPattern) { throw "Local clone origin mismatch: $originUrl" }

  git show-ref --verify --quiet ("refs/remotes/origin/" + [string]$p.checkpoint_branch)
  if ($LASTEXITCODE -ne 0) { throw "Checkpoint branch missing: $($p.checkpoint_branch)" }
} finally {
  Pop-Location
}

Write-Host "PREFLIGHT PASS project=$key repository=$($p.repository)" -ForegroundColor Green
