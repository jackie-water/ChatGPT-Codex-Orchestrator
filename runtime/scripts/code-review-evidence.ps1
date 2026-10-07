function Get-ReviewEvidenceField {
  param([string]$Header, [string]$Name, [string]$Path)
  $matches = @($Header -split "\r?\n" | Where-Object { $_ -match ("^- " + [regex]::Escape($Name) + ": ([^\r\n]+)$") })
  if ($matches.Count -ne 1) { throw "Malformed code review evidence at $Path`: expected exactly one $Name field" }
  return ([regex]::Match($matches[0], "^- " + [regex]::Escape($Name) + ": ([^\r\n]+)$")).Groups[1].Value.Trim()
}

function Get-ExistingReviewEvidenceStatus {
  param([string]$Content, [string]$Path, [string]$ExpectedCommit, [string]$ExpectedBranch, [bool]$DocsOnlyPolicy)
  $lines = $Content -split "\r?\n"
  if ($lines.Count -lt 1 -or $lines[0] -ne "<!-- CODEX_ORCHESTRATOR_CODE_REVIEW_V1 -->") {
    throw "Malformed code review evidence at $Path`: unsupported evidence marker/version"
  }
  $separatorIndex = 0
  while ($separatorIndex -lt $lines.Count -and $lines[$separatorIndex] -notmatch "^---\s*$") { $separatorIndex++ }
  if ($separatorIndex -ge $lines.Count) { throw "Malformed code review evidence at $Path`: missing header separator" }
  $header = ($lines[0..($separatorIndex - 1)] -join "`n")
  $reviewedCommit = (Get-ReviewEvidenceField -Header $header -Name "reviewed_commit" -Path $Path).ToLowerInvariant()
  $sourceBranch = Get-ReviewEvidenceField -Header $header -Name "source_branch" -Path $Path
  $statusMatches = @($lines | Where-Object { $_ -match "^Status: ([A-Z0-9_]+)$" })
  if ($statusMatches.Count -ne 1) { throw "Malformed code review evidence at $Path`: expected exactly one status" }
  $status = ([regex]::Match($statusMatches[0], "^Status: ([A-Z0-9_]+)$")).Groups[1].Value
  if ($reviewedCommit -notmatch '^[0-9a-f]{40}$' -or $reviewedCommit -ne $ExpectedCommit.ToLowerInvariant() -or $sourceBranch -ne $ExpectedBranch) {
    throw "Conflicting code review evidence at $Path`: source context does not match requested review"
  }
  if ($status -in @("CODE_REVIEW_COMPLETE", "CODE_REVIEW_FAILED")) { return $status }
  if ($status -eq "CODE_REVIEW_SKIPPED_DOCS_ONLY" -and $DocsOnlyPolicy) { return $status }
  if ($status -eq "CODE_REVIEW_SKIPPED_DOCS_ONLY") { throw "Code review evidence at $Path is docs-only but project policy does not allow that skip" }
  throw "Unknown or invalid code review evidence status at $Path`: $status"
}

function Get-CodeReviewEvidenceDisposition {
  param([string]$Status)
  if ($Status -eq "CODE_REVIEW_FAILED") { return "RETRY" }
  if ($Status -in @("CODE_REVIEW_COMPLETE", "CODE_REVIEW_SKIPPED_DOCS_ONLY")) { return "DEDUP" }
  throw "Cannot determine code review evidence disposition for status: $Status"
}
