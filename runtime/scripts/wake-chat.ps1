param(
  [string]$Message,
  [string]$ChatUrl,
  [string]$CallbackId,
  [switch]$QueueOnFailure,
  [switch]$ReconcileOnly
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "runtime-context.ps1")
$Config = Get-OrchestratorConfigPath
if (-not (Test-Path $Config)) { throw "Missing local config: $Config" }
. $Config

$pendingDir = Get-OrchestratorPendingWakeDir
if ($ReconcileOnly) {
  if ([string]::IsNullOrWhiteSpace($CallbackId)) { throw "ReconcileOnly requires CallbackId" }
  $pendingPath = Join-Path $pendingDir ($CallbackId + ".json")
  if (-not (Test-Path $pendingPath)) { Write-Host "NOT_FOUND callback_id=$CallbackId"; exit 4 }
  $item = Get-Content -Raw $pendingPath | ConvertFrom-Json
  if ([string]$item.routing_version -ne "explicit-route-v1" -or [string]$item.callback_id -ne $CallbackId -or [string]::IsNullOrWhiteSpace([string]$item.chat_url) -or [string]::IsNullOrWhiteSpace([string]$item.message)) { Write-Host "ERROR callback_id=$CallbackId"; exit 5 }
  $ChatUrl = [string]$item.chat_url; $Message = [string]$item.message
  $env:CODEX_RECONCILE_ONLY = "1"
}
$targetChatUrl = $ChatUrl
if ([string]::IsNullOrWhiteSpace($targetChatUrl)) { throw "ChatUrl is required" }
if ($targetChatUrl -notmatch '^https://chatgpt\.com/(?:g/[^/]+/)?c/[A-Za-z0-9-]+(?:[/?#].*)?$') {
  throw "Target is not a normal ChatGPT conversation URL"
}

if (-not $ReconcileOnly -and [string]::IsNullOrWhiteSpace($CallbackId)) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($targetChatUrl + [Environment]::NewLine + $Message)
    $hash = $sha.ComputeHash($bytes)
    $CallbackId = "wake-" + ([System.BitConverter]::ToString($hash).Replace("-","").ToLowerInvariant().Substring(0,24))
  } finally {
    $sha.Dispose()
  }
}

if ($CallbackId -notmatch '^[A-Za-z0-9._-]{1,160}$') { throw "CallbackId contains unsupported characters" }

if (-not $env:ORCHESTRATOR_BROWSER_DEBUG_PORT) { $env:ORCHESTRATOR_BROWSER_DEBUG_PORT = "9333" }

$pendingPath = Join-Path $pendingDir ($CallbackId + ".json")

$previousChatUrl = $env:ORCHESTRATOR_CHAT_URL
$previousCallbackId = $env:CODEX_CALLBACK_ID
$previousStateFile = $env:CODEX_CALLBACK_STATE_FILE

if ($QueueOnFailure) {
  New-Item -ItemType Directory -Force -Path $pendingDir | Out-Null
  if (Test-Path $pendingPath) {
    try {
      $existing = Get-Content -Raw $pendingPath | ConvertFrom-Json
      if ([string]$existing.routing_version -ne "explicit-route-v1" -or
          [string]$existing.callback_id -ne $CallbackId -or
          [string]$existing.chat_url -ne $targetChatUrl) {
        throw "Existing callback state does not match this explicit route"
      }
    } catch {
      throw "Pending callback state is unsafe to reuse: $pendingPath"
    }
  } else {
    $pending = [pscustomobject]@{
      routing_version = "explicit-route-v1"
      delivery_state = "PENDING"
      callback_id = $CallbackId
      chat_url = $targetChatUrl
      message = $Message
      queued_at_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    $pending | ConvertTo-Json -Depth 4 | Set-Content -Path $pendingPath -Encoding utf8
  }
}

try {
  $env:ORCHESTRATOR_CHAT_URL = $targetChatUrl
  $env:CODEX_CALLBACK_ID = $CallbackId
  if ($QueueOnFailure) { $env:CODEX_CALLBACK_STATE_FILE = $pendingPath }

  node (Join-Path $PSScriptRoot "wake-chat.mjs") $Message
  $wakeExit = $LASTEXITCODE

  if ($wakeExit -eq 0) {
    Remove-Item $pendingPath -Force -ErrorAction SilentlyContinue
    Write-Host "CHAT_WAKE_DELIVERED callback_id=$CallbackId" -ForegroundColor Green
    return
  }

  if ($ReconcileOnly) { Write-Host "PENDING callback_id=$CallbackId"; return }

  if (-not $QueueOnFailure) {
    throw "Normal Chat wake failed with exit code $wakeExit"
  }

  Write-Warning "CHAT_WAKE_QUEUED callback_id=$CallbackId path=$pendingPath"
  Write-Host "Implementation/checkpoint work is complete; callback delivery will be retried later."
  $global:LASTEXITCODE = 0
} finally {
  $env:ORCHESTRATOR_CHAT_URL = $previousChatUrl
  $env:CODEX_CALLBACK_ID = $previousCallbackId
  $env:CODEX_CALLBACK_STATE_FILE = $previousStateFile
  Remove-Item Env:CODEX_RECONCILE_ONLY -ErrorAction SilentlyContinue
}
