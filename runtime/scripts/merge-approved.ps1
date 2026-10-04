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

if (-not $TRUSTED_GITHUB_USERS -or [string]$event.issue.user.login -notin @($TRUSTED_GITHUB_USERS)) { throw "Untrusted merge approval author" }
try { $req = ([string]$event.issue.body) | ConvertFrom-Json } catch { throw "Merge approval body must be valid JSON" }

$projectKey = ([string]$req.project).ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($projectKey)) { throw "project is required" }
$projectProp = $registry.projects.PSObject.Properties[$projectKey]
if (-not $projectProp) { throw "Unknown project: $projectKey" }
$project = $projectProp.Value
if ($project.PSObject.Properties.Name -contains "enabled" -and -not [bool]$project.enabled) {
  throw "PROJECT_DISABLED: project '$projectKey' is registered but is not activated yet"
}
$repository = [string]$project.repository
$defaultBranch = [string]$project.default_branch
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

$sourceBranch = [string]$req.source_branch
if ([string]::IsNullOrWhiteSpace($sourceBranch) -or $sourceBranch -in @($defaultBranch,"main","master")) {
  throw "Invalid merge source branch"
}
if ($sourceBranch -notmatch '^(codex|chore|fix|feat|refactor|test|docs|spike)/[A-Za-z0-9._/-]+$') {
  throw "Merge source branch outside allow-list: $sourceBranch"
}

$approvedCommit = ([string]$req.approved_commit).ToLowerInvariant()
if ($approvedCommit -notmatch '^[0-9a-f]{40}$') { throw "approved_commit must be a full 40-character SHA" }

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

Push-Location $repoPath
try {
  $originUrl = (git remote get-url origin).Trim()
  $repoPattern = "(?i)github\.com[:/]" + [regex]::Escape($repository) + "(\.git)?$"
  if ($originUrl -notmatch $repoPattern) { throw "Local clone origin does not match project registry: $originUrl" }

  git fetch origin --prune | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

  git show-ref --verify --quiet "refs/remotes/origin/$sourceBranch"
  if ($LASTEXITCODE -ne 0) { throw "Approved source branch is not on origin" }

  $remoteSourceHead = (git rev-parse "origin/$sourceBranch").Trim().ToLowerInvariant()
  if ($remoteSourceHead -ne $approvedCommit) {
    throw "APPROVAL_STALE: source branch head $remoteSourceHead does not equal approved commit $approvedCommit"
  }

  $resolvedCommit = (git rev-parse "$approvedCommit^{commit}").Trim().ToLowerInvariant()
  if ($resolvedCommit -ne $approvedCommit) { throw "approved_commit does not resolve exactly" }

  $defaultBefore = (git rev-parse "origin/$defaultBranch").Trim().ToLowerInvariant()
  if ($defaultBefore -eq $approvedCommit) {
    Write-Host "MERGE_ALREADY_APPLIED project=$projectKey repository=$repository commit=$approvedCommit"
  } else {
    if ($project.PSObject.Properties.Name -contains "code_review" -and
        [bool]$project.code_review.enabled -and
        [bool]$project.code_review.required_for_code_changes) {
      $changedFiles = @(git diff --name-only "origin/$defaultBranch...$approvedCommit")
      $codeFiles = @($changedFiles | Where-Object {
        $path = [string]$_
        -not ($path -match '^(docs/|README(?:\.md)?$|.*\.md$)')
      })

      if ($codeFiles.Count -gt 0) {
        $checkpointBranch = [string]$project.checkpoint_branch
        git show-ref --verify --quiet "refs/remotes/origin/$checkpointBranch"
        if ($LASTEXITCODE -ne 0) { throw "CODE_REVIEW_REQUIRED: checkpoint branch is unavailable" }

        $reviewEvidencePath = ".codex/reviews/by-commit/$approvedCommit.md"
        $reviewObject = "origin/$checkpointBranch" + ":" + $reviewEvidencePath
        $reviewEvidence = git show $reviewObject 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $reviewEvidence) {
          throw "CODE_REVIEW_REQUIRED: no independent Codex review evidence exists for approved commit $approvedCommit"
        }

        $reviewText = $reviewEvidence -join [Environment]::NewLine
        if ($reviewText -notmatch [regex]::Escape("- reviewed_commit: $approvedCommit")) {
          throw "CODE_REVIEW_REQUIRED: review evidence does not match approved commit"
        }
        if ($reviewText -notmatch "Status:\s*CODE_REVIEW_COMPLETE") {
          throw "CODE_REVIEW_REQUIRED: independent Codex review did not complete successfully for approved commit"
        }
        if ($reviewText -notmatch "code_review_exit_code:\s*0") {
          throw "CODE_REVIEW_REQUIRED: review evidence does not contain a successful review exit code"
        }

        Write-Host "CODE_REVIEW_GATE_PASS commit=$approvedCommit"
      } else {
        Write-Host "CODE_REVIEW_GATE_SKIPPED docs-only commit=$approvedCommit"
      }
    }

    git merge-base --is-ancestor "origin/$defaultBranch" $approvedCommit
    if ($LASTEXITCODE -ne 0) {
      throw "NON_FAST_FORWARD: default branch changed or approved commit is not a descendant. Re-review is required; runner will not rebase or synthesize a merge."
    }

    git diff --check "origin/$defaultBranch...$approvedCommit"
    if ($LASTEXITCODE -ne 0) { throw "Approved diff fails git diff --check" }

    $pushRef = $approvedCommit + ":refs/heads/" + $defaultBranch
    git push origin $pushRef
    if ($LASTEXITCODE -ne 0) {
      throw "MERGE_PUSH_REJECTED: remote default branch may have changed after validation. Nothing was force-pushed."
    }

    git fetch origin $defaultBranch | Out-Null
    $defaultAfter = (git rev-parse "origin/$defaultBranch").Trim().ToLowerInvariant()
    if ($defaultAfter -ne $approvedCommit) { throw "Post-push verification failed" }

    Write-Host "MERGE_APPLIED project=$projectKey repository=$repository branch=$sourceBranch commit=$approvedCommit default=$defaultBranch"
  }
} finally {
  Pop-Location
}

$callbackId = "merge-$projectKey-$($event.issue.number)-$approvedCommit"
$message = "[MERGE-AUTO callback_id=$callbackId] Human-approved merge completed for project '$projectKey'. Repository $repository default branch '$defaultBranch' now contains approved commit $approvedCommit from $sourceBranch. No force-push, rebase, or deployment command was performed."
& (Join-Path $PSScriptRoot "wake-chat.ps1") -ChatUrl $chatUrl -Message $message -CallbackId $callbackId -QueueOnFailure
