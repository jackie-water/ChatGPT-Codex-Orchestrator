$ErrorActionPreference = "Stop"

function Get-OriginRouteFile {
  if ($env:ORCHESTRATOR_ORIGIN_ROUTE_FILE) { return [string]$env:ORCHESTRATOR_ORIGIN_ROUTE_FILE }
  return (Join-Path $HOME ".chatgpt-codex-orchestrator\issue-routes.json")
}

function Update-OriginRoutes {
  $scanner = Join-Path $PSScriptRoot "capture-chat-origins.mjs"
  if (-not (Test-Path $scanner)) { return }

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    node $scanner
    $exit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  if ($exit -notin @(0,3)) {
    Write-Warning "Origin-route scan failed with exit code $exit"
  } elseif ($exit -eq 3) {
    Write-Warning "Origin-route scan detected a conflicting marker; existing route was preserved."
  }
}

function Get-IssueOriginRoute {
  param(
    [Parameter(Mandatory=$true)][int]$IssueNumber,
    [Parameter(Mandatory=$true)][string]$ProjectKey
  )

  $routeFile = Get-OriginRouteFile
  if (-not (Test-Path $routeFile)) { return $null }

  try { $registry = Get-Content -Raw $routeFile | ConvertFrom-Json }
  catch { Write-Warning "Could not parse origin route registry: $routeFile"; return $null }

  if (-not $registry.issues) { return $null }
  $prop = $registry.issues.PSObject.Properties[[string]$IssueNumber]
  if (-not $prop) { return $null }

  $entry = $prop.Value
  if (-not [string]::IsNullOrWhiteSpace([string]$entry.project) -and
      ([string]$entry.project).ToLowerInvariant() -ne $ProjectKey.ToLowerInvariant()) {
    Write-Warning "Origin route project mismatch for issue #$IssueNumber"
    return $null
  }

  $url = [string]$entry.chat_url
  if ($url -notmatch '^https://chatgpt\.com/(?:g/[^/]+/)?c/[A-Za-z0-9-]+(?:[/?#].*)?$') {
    Write-Warning "Origin route URL is invalid for issue #$IssueNumber"
    return $null
  }

  return [pscustomobject]@{ Url=$url; Source="issue-origin"; IssueNumber=$IssueNumber }
}

function Get-ConfiguredFallbackRoute {
  param(
    [Parameter(Mandatory=$true)][string]$ProjectKey,
    [string]$ReviewRoute
  )

  if (-not [string]::IsNullOrWhiteSpace($ReviewRoute)) {
    $chatVar = Get-Variable -Name "CHAT_ROUTES" -Scope Script -ErrorAction SilentlyContinue
    if (-not $chatVar) { $chatVar = Get-Variable -Name "CHAT_ROUTES" -Scope Global -ErrorAction SilentlyContinue }
    if ($chatVar -and $chatVar.Value -is [System.Collections.IDictionary] -and $chatVar.Value.Contains($ReviewRoute)) {
      $url=[string]$chatVar.Value[$ReviewRoute]
      if($url -match '^https://chatgpt\.com/') { return [pscustomobject]@{Url=$url;Source="explicit-review-route"} }
    }
  }

  $projectVar = Get-Variable -Name "PROJECT_REVIEW_ROUTES" -Scope Script -ErrorAction SilentlyContinue
  if (-not $projectVar) { $projectVar = Get-Variable -Name "PROJECT_REVIEW_ROUTES" -Scope Global -ErrorAction SilentlyContinue }
  if ($projectVar -and $projectVar.Value -is [System.Collections.IDictionary] -and $projectVar.Value.Contains($ProjectKey)) {
    $url=[string]$projectVar.Value[$ProjectKey]
    if($url -match '^https://chatgpt\.com/') { return [pscustomobject]@{Url=$url;Source="project-default-reviewer"} }
  }

  return $null
}

function Resolve-ChatCallbackRoute {
  param(
    [Parameter(Mandatory=$true)][string]$ProjectKey,
    [Parameter(Mandatory=$true)][int]$IssueNumber,
    [string]$ReviewRoute,
    [switch]$AllowFallback
  )

  $origin=Get-IssueOriginRoute -IssueNumber $IssueNumber -ProjectKey $ProjectKey
  if($origin){return $origin}
  if($AllowFallback){return Get-ConfiguredFallbackRoute -ProjectKey $ProjectKey -ReviewRoute $ReviewRoute}
  return $null
}
