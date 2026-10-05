param([Parameter(Mandatory=$true)][string]$Project)
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "runtime-context.ps1")
$ConfigPath = Get-OrchestratorConfigPath
$RegistryPath = Join-Path $Root "projects.json"
if (-not (Test-Path $ConfigPath)) { throw "Missing local config: $ConfigPath" }

. $ConfigPath
. (Join-Path $PSScriptRoot "chat-route-registry.ps1")
$registry = Get-Content -Raw $RegistryPath | ConvertFrom-Json
$key = $Project.ToLowerInvariant()
$projectProp = $registry.projects.PSObject.Properties[$key]
if (-not $projectProp) { throw "Unknown project: $key" }
$p = $projectProp.Value
if ($p.PSObject.Properties.Name -contains "enabled" -and -not [bool]$p.enabled) { throw "PROJECT_DISABLED: project is not activated yet" }

if (-not ($p.PSObject.Properties.Name -contains "max_iterations")) { throw "Project max_iterations is required" }
if ([int]$p.max_iterations -lt 1 -or [int]$p.max_iterations -gt 20) { throw "Project max_iterations must be between 1 and 20" }

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
  "runtime-context.ps1",
  "chat-route-registry.ps1",
  "register-chat.ps1",
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

$chatRouteFile = Get-ChatRouteRegistryPath
if (Test-Path $chatRouteFile) {
  $chatRouteRegistry = Read-ChatRouteRegistry
  foreach ($route in @($chatRouteRegistry.routes)) {
    if ([string]$route.status -eq "active") {
      if ([string]::IsNullOrWhiteSpace([string]$route.route)) { throw "Active Chat route missing route name" }
      if (-not (Test-ChatConversationUrl ([string]$route.chat_url))) { throw "Active Chat route has invalid URL: $($route.route)" }
    }
  }
}

$previousChatRouteFile = $env:CODEX_CHAT_ROUTE_FILE
$routeSmokeFile = Join-Path $env:TEMP ("orchestrator-chat-route-smoke-" + [guid]::NewGuid().ToString("N") + ".json")
try {
  $env:CODEX_CHAT_ROUTE_FILE = $routeSmokeFile
  $urlA = "https://chatgpt.com/c/00000000-0000-0000-0000-000000000001"
  $urlB = "https://chatgpt.com/c/00000000-0000-0000-0000-000000000002"

  $a1 = Register-ChatRoute -ProjectKey $key -ChatUrl $urlA -RegistrationIssue 900001
  $a2 = Register-ChatRoute -ProjectKey $key -ChatUrl $urlA -RegistrationIssue 900002
  $b1 = Register-ChatRoute -ProjectKey $key -ChatUrl $urlB -RegistrationIssue 900003

  if ([string]$a1.route -ne [string]$a2.route) { throw "Chat route registration is not idempotent for the same URL" }
  if ([string]$a1.route -eq [string]$b1.route) { throw "Different Chat URLs received the same route" }

  $resolvedA = Resolve-RegisteredChatRoute -ProjectKey $key -Route ([string]$a1.route)
  $resolvedB = Resolve-RegisteredChatRoute -ProjectKey $key -Route ([string]$b1.route)
  if (-not $resolvedA -or [string]$resolvedA.chat_url -ne $urlA) { throw "Chat route A did not resolve to its registered URL" }
  if (-not $resolvedB -or [string]$resolvedB.chat_url -ne $urlB) { throw "Chat route B did not resolve to its registered URL" }
} finally {
  $env:CODEX_CHAT_ROUTE_FILE = $previousChatRouteFile
  Remove-Item -Force $routeSmokeFile -ErrorAction SilentlyContinue
}

gh auth status
if ($LASTEXITCODE -ne 0) { throw "GitHub CLI is not authenticated" }

codex --version
if ($LASTEXITCODE -ne 0) { throw "Codex CLI unavailable" }

$execHelp = & codex exec --help 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($execHelp -match "--ignore-user-config")) {
  throw "Installed Codex CLI does not support isolated 'codex exec --ignore-user-config' execution"
}

$workspaceProbeDirectory = Join-Path $env:TEMP ("codex-workspace-profile-probe-" + [guid]::NewGuid().ToString("N"))
$workspaceProbeMarker = Join-Path $workspaceProbeDirectory "marker.txt"
try {
  New-Item -ItemType Directory -Path $workspaceProbeDirectory -Force | Out-Null
  $workspaceProbeCommand = "Set-Content -LiteralPath '$workspaceProbeMarker' -Value 'workspace-profile-ok' -NoNewline"
  & codex --ignore-user-config -c 'default_permissions=":workspace"' sandbox -C $workspaceProbeDirectory --include-managed-config -- powershell.exe -NoProfile -NonInteractive -Command $workspaceProbeCommand 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $workspaceProbeMarker) -or (Get-Content -Raw -LiteralPath $workspaceProbeMarker) -ne "workspace-profile-ok") {
    throw "workspace permission-profile probe did not create the expected marker"
  }
} catch {
  throw "Codex workspace-permission-profile compatibility error: $($_.Exception.Message)"
} finally {
  Remove-Item -LiteralPath $workspaceProbeDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

$reviewHelp = & codex exec review --help 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($reviewHelp -match "--base")) {
  throw "Installed Codex CLI does not support the required non-interactive 'codex exec review --base' command"
}

$featureList = & codex features list 2>&1
if ($LASTEXITCODE -ne 0) { throw "Could not inspect the installed Codex feature surface" }
$requiredFeatures = @("plugins", "apps", "hooks", "memories", "goals", "skill_search", "skip_host_skill_discovery")
foreach ($feature in $requiredFeatures) {
  if (-not ($featureList -match ("(?m)^\s*" + [regex]::Escape($feature) + "\s"))) {
    throw "Installed Codex CLI does not expose required feature key: $feature"
  }
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
