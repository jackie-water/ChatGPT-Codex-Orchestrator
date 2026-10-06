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
  if ($status -in @("CODE_REVIEW_COMPLETE", "CODE_REVIEW_FAILED")) { return $status }
  if ($status -eq "CODE_REVIEW_SKIPPED_DOCS_ONLY" -and $DocsOnlyPolicy) { return $status }
  if ($status -eq "CODE_REVIEW_SKIPPED_DOCS_ONLY") { throw "Code review evidence at $Path is docs-only but project policy does not allow that skip" }
  throw "Unknown or invalid code review evidence status at $Path`: $status"
}
