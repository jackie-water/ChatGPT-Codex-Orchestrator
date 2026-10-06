param([Parameter(Mandatory=$true)][string]$EventPath)
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "runtime-context.ps1")
$ConfigPath = Get-OrchestratorConfigPath
$RegistryPath = Join-Path $Root "projects.json"

if (-not (Test-Path $ConfigPath)) { throw "Missing local config: $ConfigPath" }
if (-not (Test-Path $RegistryPath)) { throw "Missing project registry: $RegistryPath" }

. $ConfigPath
. (Join-Path $PSScriptRoot "chat-route-registry.ps1")
$registry = Get-Content -Raw $RegistryPath | ConvertFrom-Json
$event = Get-Content -Raw $EventPath | ConvertFrom-Json

if (-not $TRUSTED_GITHUB_USERS -or [string]$event.issue.user.login -notin @($TRUSTED_GITHUB_USERS)) { throw "Untrusted code review issue author" }
try { $req = ([string]$event.issue.body) | ConvertFrom-Json } catch { throw "Code review issue body must be valid JSON" }

$projectKey = ([string]$req.project).ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($projectKey)) { throw "project is required" }
$projectProp = $registry.projects.PSObject.Properties[$projectKey]
if (-not $projectProp) { throw "Unknown project: $projectKey" }
$project = $projectProp.Value
if ($project.PSObject.Properties.Name -contains "enabled" -and -not [bool]$project.enabled) {
  throw "PROJECT_DISABLED: project '$projectKey' is registered but is not activated yet"
}

if (-not ($project.PSObject.Properties.Name -contains "code_review") -or -not [bool]$project.code_review.enabled) {
  throw "Code review is not enabled for project '$projectKey'"
}

$repository = [string]$project.repository
$defaultBranch = [string]$project.default_branch
$checkpointBranch = [string]$project.checkpoint_branch
$localPathKey = [string]$project.local_path_key

$repoPath = $null
$pathVar = Get-Variable -Name "PROJECT_LOCAL_PATHS" -ErrorAction SilentlyContinue
if ($pathVar -and $pathVar.Value -is [System.Collections.IDictionary] -and $pathVar.Value.Contains($localPathKey)) {
  $repoPath = [string]$pathVar.Value[$localPathKey]
}
if ([string]::IsNullOrWhiteSpace($repoPath) -or -not (Test-Path $repoPath)) {
  throw "Local automation clone is not configured for project '$projectKey'"
}
$repoPath = (Resolve-Path $repoPath).Path

if (-not ($req.PSObject.Properties.Name -contains "review_route") -or [string]::IsNullOrWhiteSpace([string]$req.review_route)) {
  throw "ROUTE-001 CHAT_ROUTE_REQUIRED: review_route must be supplied by the originating registered Chat"
}
$reviewRoute = [string]$req.review_route
if ($reviewRoute -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') { throw "Invalid review_route: $reviewRoute" }

$routeRecord = Resolve-RegisteredChatRoute -ProjectKey $projectKey -Route $reviewRoute
if (-not $routeRecord) {
  throw "ROUTE-002 CHAT_ROUTE_UNREGISTERED: route '$reviewRoute' is not an active registered Chat for project '$projectKey'"
}
$chatUrl = [string]$routeRecord.chat_url

$sourceBranch = [string]$req.source_branch
if ([string]::IsNullOrWhiteSpace($sourceBranch) -or $sourceBranch -in @($defaultBranch,"main","master")) {
  throw "Invalid code review source branch"
}
if ($sourceBranch -notmatch '^(codex|chore|fix|feat|refactor|test|docs|spike)/[A-Za-z0-9._/-]+$') {
  throw "Code review source branch outside allow-list: $sourceBranch"
}

$reviewedCommit = ([string]$req.reviewed_commit).ToLowerInvariant()
if ($reviewedCommit -notmatch '^[0-9a-f]{40}$') { throw "reviewed_commit must be a full 40-character SHA" }

$reviewModel = if ($project.code_review.PSObject.Properties.Name -contains "review_model" -and -not [string]::IsNullOrWhiteSpace([string]$project.code_review.review_model)) {
  [string]$project.code_review.review_model
} else {
  "gpt-5.6-luna"
}
$reviewReasoning = if ($project.code_review.PSObject.Properties.Name -contains "review_reasoning" -and -not [string]::IsNullOrWhiteSpace([string]$project.code_review.review_reasoning)) {
  [string]$project.code_review.review_reasoning
} else {
  "medium"
}
$docsOnlySkip = ($project.code_review.PSObject.Properties.Name -contains "docs_only_skip" -and [bool]$project.code_review.docs_only_skip)

function Get-ReviewEvidenceField {
  param([string]$Content, [string]$Name, [string]$Path)
  $matches = [regex]::Matches($Content, "(?m)^- " + [regex]::Escape($Name) + ": ([^\r\n]+)$")
  if ($matches.Count -ne 1) { throw "Malformed code review evidence at $Path`: expected exactly one $Name field" }
  return $matches[0].Groups[1].Value.Trim()
}

function Get-ExistingReviewEvidenceStatus {
  param([string]$Content, [string]$Path, [string]$ExpectedCommit, [string]$ExpectedBranch, [bool]$DocsOnlyPolicy)
  $lines = $Content -split "\r?\n"
  if ($lines.Count -lt 1 -or $lines[0] -ne "<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->") {
    throw "Malformed code review evidence at $Path`: unsupported evidence marker/version"
  }
  $reviewedCommit = (Get-ReviewEvidenceField -Content $Content -Name "reviewed_commit" -Path $Path).ToLowerInvariant()
  $sourceBranch = Get-ReviewEvidenceField -Content $Content -Name "source_branch" -Path $Path
  $statusMatches = [regex]::Matches($Content, "(?m)^Status: ([A-Z0-9_]+)$")
  if ($statusMatches.Count -ne 1) { throw "Malformed code review evidence at $Path`: expected exactly one status" }
  $status = $statusMatches[0].Groups[1].Value
  if ($reviewedCommit -ne $ExpectedCommit -or $sourceBranch -ne $ExpectedBranch) {
    throw "Conflicting code review evidence at $Path`: source context does not match requested review"
  }
  if ($status -eq "CODE_REVIEW_COMPLETE") { return $status }
  if ($status -eq "CODE_REVIEW_FAILED") { return $status }
  if ($status -eq "CODE_REVIEW_SKIPPED_DOCS_ONLY" -and $DocsOnlyPolicy) { return $status }
  if ($status -eq "CODE_REVIEW_SKIPPED_DOCS_ONLY") { throw "Code review evidence at $Path is docs-only but project policy does not allow that skip" }
  throw "Unknown or invalid code review evidence status at $Path`: $status"
}

$reviewFile = Join-Path $env:TEMP ("codex-review-" + [guid]::NewGuid().ToString("N") + ".txt")
$logFile = Join-Path $env:TEMP ("codex-review-log-" + [guid]::NewGuid().ToString("N") + ".txt")
$reportFile = Join-Path $env:TEMP ("codex-review-report-" + [guid]::NewGuid().ToString("N") + ".md")

Push-Location $repoPath
try {
  $originUrl = (git remote get-url origin).Trim()
  $repoPattern = "(?i)github\.com[:/]" + [regex]::Escape($repository) + "(\.git)?$"
  if ($originUrl -notmatch $repoPattern) { throw "Local clone origin does not match project registry: $originUrl" }

  git fetch origin --prune | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

  git show-ref --verify --quiet "refs/remotes/origin/$sourceBranch"
  if ($LASTEXITCODE -ne 0) { throw "Review source branch is not on origin" }

  $remoteSourceHead = (git rev-parse "origin/$sourceBranch").Trim().ToLowerInvariant()
  if ($remoteSourceHead -ne $reviewedCommit) {
    throw "REVIEW_STALE: remote source head $remoteSourceHead does not equal requested reviewed commit $reviewedCommit"
  }

  git merge-base --is-ancestor "origin/$defaultBranch" $reviewedCommit
  if ($LASTEXITCODE -ne 0) { throw "Reviewed commit is not a descendant of origin/$defaultBranch" }

  $reviewEvidencePath = ".codex/reviews/by-commit/$reviewedCommit.md"
  git show-ref --verify --quiet "refs/remotes/origin/$checkpointBranch"
  if ($LASTEXITCODE -eq 0) {
    $reviewObject = "origin/$checkpointBranch" + ":" + $reviewEvidencePath
    $previousProbePreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      git cat-file -e $reviewObject 2>$null
      $reviewEvidenceExists = ($LASTEXITCODE -eq 0)
    } finally {
      $ErrorActionPreference = $previousProbePreference
    }
    if ($reviewEvidenceExists) {
      $checkpointCommit = (git rev-parse "origin/$checkpointBranch").Trim().ToLowerInvariant()
      $reviewEvidenceContent = git show $reviewObject 2>$null
      if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($reviewEvidenceContent -join [Environment]::NewLine))) {
        throw "Could not read code review evidence from exact checkpoint object $reviewObject"
      }
      $existingStatus = Get-ExistingReviewEvidenceStatus -Content ($reviewEvidenceContent -join [Environment]::NewLine) -Path $reviewEvidencePath -ExpectedCommit $reviewedCommit -ExpectedBranch $sourceBranch -DocsOnlyPolicy $docsOnlySkip
      if ($existingStatus -eq "CODE_REVIEW_FAILED") {
        Write-Host "CODE_REVIEW_RETRYABLE_FAILED commit=$reviewedCommit checkpoint=$checkpointCommit"
      } else {
        $callbackId = "code-review-existing-$projectKey-$reviewedCommit"
        $message = "[CODE-REVIEW-AUTO callback_id=$callbackId] Independent Codex code review evidence already exists for project '$projectKey', branch $sourceBranch, commit $reviewedCommit. Authoritative review: checkpoint_commit=$checkpointCommit path=$reviewEvidencePath. Read that exact file from the checkpoint commit and adjudicate the findings. Do not rerun Code Review for this exact commit."
        & (Join-Path $PSScriptRoot "wake-chat.ps1") -ChatUrl $chatUrl -Message $message -CallbackId $callbackId -QueueOnFailure
        Write-Host "CODE_REVIEW_ALREADY_EXISTS commit=$reviewedCommit checkpoint=$checkpointCommit"
        return
      }
    }
  }

  git reset --hard | Out-Null
  git clean -fd | Out-Null
  git checkout -B $sourceBranch "origin/$sourceBranch" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not prepare review branch" }

  $head = (git rev-parse HEAD).Trim().ToLowerInvariant()
  if ($head -ne $reviewedCommit) { throw "Review checkout does not match exact requested commit" }

  $changedFiles = @(git diff --name-only "origin/$defaultBranch...HEAD")
  if ($changedFiles.Count -eq 0) { throw "No changes exist between reviewed commit and origin/$defaultBranch" }

  $codeFiles = @($changedFiles | Where-Object {
    $path = [string]$_
    -not ($path -match '^(docs/|README(?:\.md)?$|.*\.md$)')
  })

  if ($docsOnlySkip -and $codeFiles.Count -eq 0) {
    $fileText = "- " + ($changedFiles -join ([Environment]::NewLine + "- "))
    $reportLines = @(
      "## Result",
      "",
      "Status: CODE_REVIEW_SKIPPED_DOCS_ONLY",
      "",
      "## Review target",
      "",
      "- orchestrator_issue: $($event.issue.number)",
      "- source_branch: $sourceBranch",
      "- reviewed_commit: $reviewedCommit",
      "- base_branch: $defaultBranch",
      "- code_review_tokens_used: 0",
      "",
      "## Changed files",
      "",
      $fileText,
      "",
      "## Reviewer next action",
      "",
      "All changed files are documentation-only under the project policy, so independent Codex code review was skipped. Chat may continue its final review for this exact commit."
    )
    Set-Content -Path $reportFile -Value ($reportLines -join [Environment]::NewLine) -Encoding utf8
    $publishOutput = @(& (Join-Path $PSScriptRoot "publish-code-review.ps1") -RepoPath $repoPath -ProjectKey $projectKey -Repository $repository -CheckpointBranch $checkpointBranch -SourceBranch $sourceBranch -SourceCommit $reviewedCommit -ReportPath $reportFile)
    foreach ($line in $publishOutput) { Write-Host $line }
    $publishLine = @($publishOutput | Where-Object { [string]$_ -match '^CODE_REVIEW_PUBLISHED ' } | Select-Object -Last 1)
    if ($publishLine.Count -eq 0) { throw "Code review publication did not return immutable coordinates" }
    $checkpointCommitMatch = [regex]::Match([string]$publishLine[0],'commit=([0-9a-fA-F]{40})')
    $reviewFileMatch = [regex]::Match([string]$publishLine[0],'review_file=([^\s]+)')
    if (-not $checkpointCommitMatch.Success -or -not $reviewFileMatch.Success) { throw "Code review publication coordinates are malformed" }
    $checkpointCommit = $checkpointCommitMatch.Groups[1].Value.ToLowerInvariant()
    $reviewEvidencePath = $reviewFileMatch.Groups[1].Value

    $callbackId = "code-review-docs-$projectKey-$reviewedCommit"
    $message = "[CODE-REVIEW-AUTO callback_id=$callbackId] Code Review was skipped as docs-only for project '$projectKey', branch $sourceBranch, commit $reviewedCommit. Authoritative review: checkpoint_commit=$checkpointCommit path=$reviewEvidencePath. Read that exact file and continue final Chat review."
    & (Join-Path $PSScriptRoot "wake-chat.ps1") -ChatUrl $chatUrl -Message $message -CallbackId $callbackId -QueueOnFailure
    return
  }

  $codexCommand = Get-Command codex.cmd -CommandType Application -ErrorAction SilentlyContinue
  if (-not $codexCommand) { $codexCommand = Get-Command codex -ErrorAction Stop }

  $reviewModelCfg = 'review_model="' + $reviewModel + '"'
  $effortCfg = 'model_reasoning_effort="' + $reviewReasoning + '"'
  $projectDocsCfg = 'project_doc_max_bytes=0'
  $approvalCfg = 'approval_policy="never"'
  $sandboxCfg = 'sandbox_mode="read-only"'

  Write-Host "CODE_REVIEW_START project=$projectKey branch=$sourceBranch commit=$reviewedCommit base=$defaultBranch model=$reviewModel reasoning=$reviewReasoning"

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $codexCommand.Source exec --ignore-user-config -m $reviewModel -c $reviewModelCfg -c $effortCfg -c $projectDocsCfg -c $approvalCfg -c $sandboxCfg -c 'windows.sandbox="unelevated"' -c 'features.plugins=false' -c 'features.apps=false' -c 'features.hooks=false' -c 'features.memories=false' -c 'features.goals=false' -c 'features.skill_search=false' -c 'features.skip_host_skill_discovery=true' -c 'cloud.skills.enabled=false' -c 'skills.include_instructions=false' review --base "origin/$defaultBranch" 1> $reviewFile 2> $logFile
    $reviewExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  $reviewLog = if (Test-Path $logFile) { Get-Content -Raw $logFile -ErrorAction SilentlyContinue } else { "" }
  if ($reviewLog) { Write-Host $reviewLog }

  $tokenMatches = [regex]::Matches($reviewLog, '(?im)tokens used\s*\r?\n\s*([\d,]+)')
  $reviewTokens = if ($tokenMatches.Count -gt 0) { ($tokenMatches[$tokenMatches.Count - 1].Groups[1].Value -replace ',','') } else { "unknown" }

  $reviewOutput = if (Test-Path $reviewFile) { Get-Content -Raw $reviewFile -ErrorAction SilentlyContinue } else { "" }
  if ($null -eq $reviewOutput) { $reviewOutput = "" }
  $reviewOutput = $reviewOutput -replace '(?im)(api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*\S+','$1=[REDACTED]'
  if ($reviewOutput.Length -gt 20000) { $reviewOutput = $reviewOutput.Substring(0,20000) + [Environment]::NewLine + "[TRUNCATED]" }

  $headAfter = (git rev-parse HEAD).Trim().ToLowerInvariant()
  if ($headAfter -ne $reviewedCommit) { throw "Code review changed HEAD unexpectedly" }

  $dirty = @(git status --porcelain)
  if ($dirty.Count -gt 0) {
    git reset --hard HEAD | Out-Null
    git clean -fd | Out-Null
    throw "Code review modified the working tree unexpectedly"
  }

  $fileText = "- " + ($changedFiles -join ([Environment]::NewLine + "- "))
  $status = if ($reviewExit -eq 0) { "CODE_REVIEW_COMPLETE" } else { "CODE_REVIEW_FAILED" }

  $reportLines = @(
    "## Result",
    "",
    "Status: $status",
    "",
    "## Review target",
    "",
    "- orchestrator_issue: $($event.issue.number)",
    "- source_branch: $sourceBranch",
    "- reviewed_commit: $reviewedCommit",
    "- base_branch: $defaultBranch",
    "- code_review_model: $reviewModel",
    "- code_review_reasoning: $reviewReasoning",
    "- code_review_exit_code: $reviewExit",
    "- code_review_tokens_used: $reviewTokens",
    "",
    "## Changed files",
    "",
    $fileText,
    "",
    "## Independent Codex review",
    "",
    $reviewOutput,
    "",
    "## Reviewer next action",
    "",
    "Chat must adjudicate the independent technical findings against the exact reviewed commit. Deterministic blocking findings -> REVISE with one consolidated delta-only CODEX-RUN. Product/architecture/security-policy decisions -> NEEDS_HUMAN. If there are no blocking findings, or findings are demonstrably non-blocking/false positives, Chat may issue final PASS for this exact commit. PASS still does not authorize merge."
  )
  Set-Content -Path $reportFile -Value ($reportLines -join [Environment]::NewLine) -Encoding utf8

  $publishOutput = @(& (Join-Path $PSScriptRoot "publish-code-review.ps1") -RepoPath $repoPath -ProjectKey $projectKey -Repository $repository -CheckpointBranch $checkpointBranch -SourceBranch $sourceBranch -SourceCommit $reviewedCommit -ReportPath $reportFile)
  foreach ($line in $publishOutput) { Write-Host $line }
  $publishLine = @($publishOutput | Where-Object { [string]$_ -match '^CODE_REVIEW_PUBLISHED ' } | Select-Object -Last 1)
  if ($publishLine.Count -eq 0) { throw "Code review publication did not return immutable coordinates" }
  $checkpointCommitMatch = [regex]::Match([string]$publishLine[0],'commit=([0-9a-fA-F]{40})')
  $reviewFileMatch = [regex]::Match([string]$publishLine[0],'review_file=([^\s]+)')
  if (-not $checkpointCommitMatch.Success -or -not $reviewFileMatch.Success) { throw "Code review publication coordinates are malformed" }
  $checkpointCommit = $checkpointCommitMatch.Groups[1].Value.ToLowerInvariant()
  $reviewEvidencePath = $reviewFileMatch.Groups[1].Value

  $callbackId = "code-review-$projectKey-$($event.issue.number)-$reviewedCommit"
  $message = "[CODE-REVIEW-AUTO callback_id=$callbackId] Independent Codex code review finished for project '$projectKey', branch $sourceBranch, commit $reviewedCommit. Review exit=$reviewExit, tokens=$reviewTokens. Authoritative review: checkpoint_commit=$checkpointCommit path=$reviewEvidencePath. Read that exact file from the checkpoint commit and independently adjudicate every finding before final PASS/REVISE/NEEDS_HUMAN. Treat this review as valid only for commit $reviewedCommit."
  & (Join-Path $PSScriptRoot "wake-chat.ps1") -ChatUrl $chatUrl -Message $message -CallbackId $callbackId -QueueOnFailure

  if ($reviewExit -ne 0) { throw "Codex code review failed with exit code $reviewExit; review evidence and Chat callback were published." }
} finally {
  Pop-Location
  Remove-Item $reviewFile,$logFile,$reportFile -Force -ErrorAction SilentlyContinue
}
