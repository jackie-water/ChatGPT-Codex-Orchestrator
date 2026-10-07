param(
  [string]$ChatUrl,
  [string]$Port,
  [string]$ProfilePath
)
$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrWhiteSpace($ChatUrl) -and
    $ChatUrl -notmatch '^https://chatgpt\.com/(?:g/[^/]+/)?c/[A-Za-z0-9-]+(?:[/?#].*)?$') {
  throw "Chat URL is not a normal ChatGPT conversation URL"
}

if ([string]::IsNullOrWhiteSpace($Port)) {
  $Port = if ($env:ORCHESTRATOR_BROWSER_DEBUG_PORT) { $env:ORCHESTRATOR_BROWSER_DEBUG_PORT } else { "9333" }
}
if ($Port -notmatch '^\d+$' -or [int64]$Port -lt 1 -or [int64]$Port -gt 65535) {
  throw "Browser debug port must be an integer between 1 and 65535"
}

$up = $false
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 | Out-Null
  $up = $true
} catch {}

if (-not $up) {
  if ([string]::IsNullOrWhiteSpace($ProfilePath)) {
    $ProfilePath = if ($env:ORCHESTRATOR_BROWSER_PROFILE) { $env:ORCHESTRATOR_BROWSER_PROFILE }
    if ([string]::IsNullOrWhiteSpace($ProfilePath)) {
      if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw "A browser profile path is required when LOCALAPPDATA is unavailable"
      }
      $ProfilePath = Join-Path $env:LOCALAPPDATA "ChatGPTCodexOrchestratorReviewer"
    }
  }
  $edge = $null
  $edgeCmd = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($edgeCmd) { $edge = $edgeCmd.Source }
  if (-not $edge) {
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    $candidates = @()
    foreach ($basePath in @($programFilesX86, $env:ProgramFiles, $env:LOCALAPPDATA)) {
      if (-not [string]::IsNullOrWhiteSpace($basePath)) {
        $candidate = Join-Path $basePath "Microsoft\Edge\Application\msedge.exe"
        if (Test-Path $candidate) { $candidates += $candidate }
      }
    }
    $edge = $candidates | Select-Object -First 1
  }
  if (-not $edge) { throw "Microsoft Edge was not found" }

  Start-Process -FilePath $edge -ArgumentList @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$ProfilePath",
    "--no-first-run",
    "https://chatgpt.com/"
  )
  Start-Sleep -Seconds 4
}

$env:ORCHESTRATOR_BROWSER_DEBUG_PORT = $Port

if (-not [string]::IsNullOrWhiteSpace($ChatUrl)) {
  node (Join-Path $PSScriptRoot "navigate-reviewer-chat.mjs") $ChatUrl
  if ($LASTEXITCODE -ne 0) {
    throw "Could not prepare the requested Chat tab. On first use, sign into ChatGPT in that browser profile, then retry."
  }
}

Write-Host "Callback browser ready on isolated debug port $Port." -ForegroundColor Green
Write-Host "Explicit Chat registration is enabled. Callbacks use only pinned registered Chat URLs."
Write-Host "Profile: $ProfilePath"
