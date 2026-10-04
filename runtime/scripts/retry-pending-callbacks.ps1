param([int]$MaxCallbacks = 20)

$ErrorActionPreference = "Stop"

$pendingDir = Join-Path $HOME ".chatgpt-codex-orchestrator\pending-wakes"

if (-not (Test-Path $pendingDir)) {
  Write-Host "No pending Chat callbacks."
  return
}

$files = @(Get-ChildItem -Path $pendingDir -Filter "*.json" -File | Sort-Object LastWriteTime | Select-Object -First $MaxCallbacks)
if ($files.Count -eq 0) {
  Write-Host "No pending Chat callbacks."
  return
}

Write-Host "Retrying $($files.Count) pending Chat callback(s)..." -ForegroundColor Cyan
$delivered = 0
$remaining = 0
$retired = 0

foreach ($file in $files) {
  try {
    $item = Get-Content -Raw $file.FullName | ConvertFrom-Json

    if ([string]$item.routing_version -ne "explicit-route-v1") {
      $retiredDir = Join-Path $HOME ".chatgpt-codex-orchestrator\retired-pending-wakes"
      New-Item -ItemType Directory -Force -Path $retiredDir | Out-Null
      $retiredPath = Join-Path $retiredDir $file.Name
      Move-Item -Force $file.FullName $retiredPath
      Write-Warning "LEGACY_PENDING_RETIRED: $($file.Name). Old origin/fallback callbacks are not auto-delivered after explicit-route cutover."
      $retired++
      continue
    }

    if ([string]::IsNullOrWhiteSpace([string]$item.callback_id) -or
        [string]::IsNullOrWhiteSpace([string]$item.chat_url) -or
        [string]::IsNullOrWhiteSpace([string]$item.message)) {
      Write-Warning "Invalid explicit-route pending callback file: $($file.FullName)"
      $remaining++
      continue
    }

    $wakeArgs = @{
      ChatUrl = [string]$item.chat_url
      Message = [string]$item.message
      CallbackId = [string]$item.callback_id
      QueueOnFailure = $true
    }
    & (Join-Path $PSScriptRoot "wake-chat.ps1") @wakeArgs

    if (-not (Test-Path $file.FullName)) {
      $delivered++
    } else {
      $remaining++
    }
  } catch {
    Write-Warning "Pending callback retry failed for $($file.Name): $($_.Exception.Message)"
    $remaining++
  }
}

Write-Host "Pending callback retry complete: delivered=$delivered remaining=$remaining retired_legacy=$retired"
