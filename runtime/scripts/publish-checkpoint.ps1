param(
  [Parameter(Mandatory=$true)][string]$RepoPath,
  [Parameter(Mandatory=$true)][string]$ProjectKey,
  [Parameter(Mandatory=$true)][string]$Repository,
  [Parameter(Mandatory=$true)][string]$CheckpointBranch,
  [Parameter(Mandatory=$true)][string]$SourceBranch,
  [Parameter(Mandatory=$true)][string]$SourceCommit,
  [Parameter(Mandatory=$true)][int]$OrchestratorIssue,
  [Parameter(Mandatory=$true)][int]$Iteration,
  [Parameter(Mandatory=$true)][string]$ReportPath
)
$ErrorActionPreference = "Stop"

if ($SourceBranch -in @("main","master")) { throw "PROTECTED_BRANCH_ATTEMPT: checkpoint source branch cannot be protected" }
if (-not (Test-Path $ReportPath)) { throw "Run report missing" }
if ($OrchestratorIssue -lt 1) { throw "OrchestratorIssue must be positive" }
if ($Iteration -lt 1) { throw "Iteration must be positive" }

Push-Location $RepoPath
try {
  git fetch origin --prune | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

  git fetch origin "refs/heads/$SourceBranch`:refs/remotes/origin/$SourceBranch" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "source branch is not on origin" }
  git show-ref --verify --quiet "refs/remotes/origin/$SourceBranch"
  if ($LASTEXITCODE -ne 0) { throw "source branch is not on origin" }

  $remoteSourceHead = (git rev-parse "origin/$SourceBranch").Trim()
  if ($remoteSourceHead -ne $SourceCommit) { throw "source branch moved after wrapper push" }

  git fetch origin "refs/heads/$CheckpointBranch`:refs/remotes/origin/$CheckpointBranch" | Out-Null
  git show-ref --verify --quiet "refs/remotes/origin/$CheckpointBranch"
  if ($LASTEXITCODE -ne 0) { throw "checkpoint branch missing for project '$ProjectKey'" }

  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
  $published = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $short = $SourceCommit.Substring(0,[Math]::Min(12,$SourceCommit.Length))
  $safeBranch = $SourceBranch -replace '[^A-Za-z0-9._-]','-'
  $historyRel = ".codex/history/" + $stamp + "__" + $safeBranch + "__" + $short + ".md"
  $runRel = ".codex/runs/by-issue/" + $OrchestratorIssue + "/iteration-" + $Iteration + "__" + $short + ".md"
  $temp = Join-Path $env:TEMP ("codex-checkpoint-" + [guid]::NewGuid().ToString("N"))

  git worktree add --detach $temp "origin/$CheckpointBranch" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "checkpoint worktree creation failed" }

  try {
    $history = Join-Path $temp $historyRel
    $runFile = Join-Path $temp $runRel
    New-Item -ItemType Directory -Force -Path (Split-Path $history -Parent) | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path $runFile -Parent) | Out-Null
    $body = Get-Content -Raw $ReportPath

    $headerLines = @(
      "<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->",
      "# Codex Latest Run",
      "",
      "- project: $ProjectKey",
      "- repository: $Repository",
      "- published_at_utc: $published",
      "- source_branch: $SourceBranch",
      "- source_commit: $SourceCommit",
      "- checkpoint_branch: $CheckpointBranch",
      "- history_file: $historyRel",
      "- run_file: $runRel",
      "- orchestrator_issue: $OrchestratorIssue",
      "- iteration: $Iteration",
      "- publisher: Codex-Orchestrator",
      "",
      "---",
      "",
      $body
    )
    $content = $headerLines -join [Environment]::NewLine

    Set-Content -Path (Join-Path $temp ".codex/latest-run.md") -Value $content -Encoding utf8
    Set-Content -Path $history -Value $content -Encoding utf8
    Set-Content -Path $runFile -Value $content -Encoding utf8

    Push-Location $temp
    try {
      git add .codex/latest-run.md $historyRel $runRel
      git -c user.name="Codex Orchestrator" -c user.email="codex-orchestrator@users.noreply.github.com" commit -m "chore(checkpoint): $SourceBranch@$short" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "checkpoint commit failed" }
      $checkpointCommit = (git rev-parse HEAD).Trim()
      git push origin "HEAD:refs/heads/$CheckpointBranch" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "checkpoint push failed" }
      Write-Output "CHECKPOINT_PUBLISHED commit=$checkpointCommit run_file=$runRel history_file=$historyRel"
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
