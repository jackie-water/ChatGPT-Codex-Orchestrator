param(
  [Parameter(Mandatory=$true)][string]$RepoPath,
  [Parameter(Mandatory=$true)][string]$ProjectKey,
  [Parameter(Mandatory=$true)][string]$Repository,
  [Parameter(Mandatory=$true)][string]$CheckpointBranch,
  [Parameter(Mandatory=$true)][string]$SourceBranch,
  [Parameter(Mandatory=$true)][string]$SourceCommit,
  [Parameter(Mandatory=$true)][string]$ReportPath
)
$ErrorActionPreference = "Stop"

if ($SourceBranch -in @("main","master")) { throw "PROTECTED_BRANCH_ATTEMPT: review source branch cannot be protected" }
if ($SourceCommit -notmatch '^[0-9a-fA-F]{40}$') { throw "SourceCommit must be a full 40-character SHA" }
if (-not (Test-Path $ReportPath)) { throw "Code review report missing" }

Push-Location $RepoPath
try {
  git fetch origin --prune | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

  git show-ref --verify --quiet "refs/remotes/origin/$SourceBranch"
  if ($LASTEXITCODE -ne 0) { throw "source branch is not on origin" }

  $remoteSourceHead = (git rev-parse "origin/$SourceBranch").Trim().ToLowerInvariant()
  if ($remoteSourceHead -ne $SourceCommit.ToLowerInvariant()) { throw "source branch moved before review publication" }

  git show-ref --verify --quiet "refs/remotes/origin/$CheckpointBranch"
  if ($LASTEXITCODE -ne 0) { throw "checkpoint branch missing for project '$ProjectKey'" }

  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
  $published = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $short = $SourceCommit.Substring(0,12).ToLowerInvariant()
  $safeBranch = $SourceBranch -replace '[^A-Za-z0-9._-]','-'
  $historyRel = ".codex/reviews/history/" + $stamp + "__" + $safeBranch + "__" + $short + ".md"
  $byCommitRel = ".codex/reviews/by-commit/" + $SourceCommit.ToLowerInvariant() + ".md"
  $temp = Join-Path $env:TEMP ("codex-review-checkpoint-" + [guid]::NewGuid().ToString("N"))

  git worktree add --detach $temp "origin/$CheckpointBranch" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "review checkpoint worktree creation failed" }

  try {
    $history = Join-Path $temp $historyRel
    $byCommit = Join-Path $temp $byCommitRel
    New-Item -ItemType Directory -Force -Path (Split-Path $history -Parent) | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path $byCommit -Parent) | Out-Null

    $body = Get-Content -Raw $ReportPath
    $headerLines = @(
      "<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->",
      "# Codex Code Review",
      "",
      "- project: $ProjectKey",
      "- repository: $Repository",
      "- published_at_utc: $published",
      "- source_branch: $SourceBranch",
      "- reviewed_commit: $SourceCommit",
      "- checkpoint_branch: $CheckpointBranch",
      "- history_file: $historyRel",
      "- by_commit_file: $byCommitRel",
      "- publisher: Codex-Orchestrator",
      "",
      "---",
      "",
      $body
    )
    $content = $headerLines -join [Environment]::NewLine

    Set-Content -Path (Join-Path $temp ".codex/latest-review.md") -Value $content -Encoding utf8
    Set-Content -Path $history -Value $content -Encoding utf8
    Set-Content -Path $byCommit -Value $content -Encoding utf8

    Push-Location $temp
    try {
      git add .codex/latest-review.md $historyRel $byCommitRel
      git -c user.name="Codex Orchestrator" -c user.email="codex-orchestrator@users.noreply.github.com" commit -m "chore(code-review): $SourceBranch@$short" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "code review checkpoint commit failed" }
      git push origin "HEAD:refs/heads/$CheckpointBranch" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "code review checkpoint push failed" }
    } finally {
      Pop-Location
    }
  } finally {
    git worktree remove --force $temp 2>$null
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
  }
} finally {
  Pop-Location
}
