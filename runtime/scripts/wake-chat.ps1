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
$pendingRoot = [IO.Path]::GetFullPath($pendingDir).TrimEnd('\') + '\'
$previousChatUrl = $env:ORCHESTRATOR_CHAT_URL
$previousCallbackId = $env:CODEX_CALLBACK_ID
$previousStateFile = $env:CODEX_CALLBACK_STATE_FILE
$previousExpectedFingerprint = $env:CODEX_CALLBACK_EXPECTED_FINGERPRINT
$previousReconcileOnly = $env:CODEX_RECONCILE_ONLY
$instanceId = [string]$env:ORCHESTRATOR_INSTANCE_ID
if ([string]::IsNullOrWhiteSpace($instanceId)) { throw "Missing orchestrator instance identity" }
if ($ReconcileOnly -and $CallbackId -notmatch '^[A-Za-z0-9._-]{1,160}$') { throw "Invalid CallbackId before pending-state read" }
$mutex = $null
$mutexOwned = $false
$mutexIdentity = $null
$processStatus = 0
function Get-CallbackFingerprint([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
try {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $mutexIdentity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($pendingDir).TrimEnd('\') + '|' + $instanceId + '|' + $CallbackId)))).Replace('-','').ToLowerInvariant()).Substring(0,32) } finally { $sha.Dispose() }
if ($ReconcileOnly) {
  if ([string]::IsNullOrWhiteSpace($CallbackId)) { throw "ReconcileOnly requires CallbackId" }
  $mutex = [Threading.Mutex]::new($false, "Local\CodexCallback-$mutexIdentity")
  if (-not $mutex.WaitOne(30000)) { throw "Callback is already being processed: $CallbackId" }
  $mutexOwned = $true
  trap { if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose(); $mutex = $null }; break }
  $pendingPath = Join-Path $pendingDir ($CallbackId + ".json")
  if ([IO.Path]::GetFullPath($pendingPath) -ne ($pendingRoot + $CallbackId + '.json')) { throw "Unsafe callback path" }
  if (-not (Test-Path $pendingPath)) { Write-Host "NOT_FOUND callback_id=$CallbackId"; $processStatus = 4; $mutex.ReleaseMutex(); $mutex.Dispose(); $mutex = $null; return }
  $item = Get-Content -Raw $pendingPath | ConvertFrom-Json
  if ([string]$item.routing_version -ne "explicit-route-v1" -or [string]$item.callback_id -ne $CallbackId -or [string]::IsNullOrWhiteSpace([string]$item.chat_url) -or [string]::IsNullOrWhiteSpace([string]$item.message)) { Write-Host "ERROR callback_id=$CallbackId"; $processStatus = 5; $mutex.ReleaseMutex(); $mutex.Dispose(); $mutex = $null; return }
  $ChatUrl = [string]$item.chat_url; $Message = [string]$item.message
  $recordVersion = Get-CallbackFingerprint $pendingPath
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

$sha = [System.Security.Cryptography.SHA256]::Create()
try { $mutexIdentity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($pendingDir).TrimEnd('\') + '|' + $instanceId + '|' + $CallbackId)))).Replace('-','').ToLowerInvariant()).Substring(0,32) } finally { $sha.Dispose() }

if (-not $env:ORCHESTRATOR_BROWSER_DEBUG_PORT) { $env:ORCHESTRATOR_BROWSER_DEBUG_PORT = "9333" }

$pendingPath = Join-Path $pendingDir ($CallbackId + ".json")
if ([IO.Path]::GetFullPath($pendingPath) -ne ($pendingRoot + $CallbackId + '.json')) { throw "Unsafe callback path" }
if (-not $mutex) { $mutex = [Threading.Mutex]::new($false, "Local\CodexCallback-$mutexIdentity"); if (-not $mutex.WaitOne(30000)) { throw "Callback is already being processed: $CallbackId" }; $mutexOwned = $true }

if ($QueueOnFailure) {
  New-Item -ItemType Directory -Force -Path $pendingDir | Out-Null
  if (Test-Path $pendingPath) {
    try {
      $existing = Get-Content -Raw $pendingPath | ConvertFrom-Json
      if ([string]$existing.routing_version -ne "explicit-route-v1" -or
          [string]$existing.callback_id -ne $CallbackId -or
          [string]$existing.chat_url -ne $targetChatUrl -or
          [string]$existing.message -ne $Message) {
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
  $recordVersion = Get-CallbackFingerprint $pendingPath
}

try {
  $env:ORCHESTRATOR_CHAT_URL = $targetChatUrl
  $env:CODEX_CALLBACK_ID = $CallbackId
  $env:CODEX_CALLBACK_STATE_FILE = if ($QueueOnFailure -or $ReconcileOnly) { $pendingPath } else { '' }
  $env:CODEX_CALLBACK_EXPECTED_FINGERPRINT = if ($QueueOnFailure -or $ReconcileOnly) { $recordVersion } else { '' }
  $env:CODEX_RECONCILE_ONLY = if ($ReconcileOnly) { "1" } else { Remove-Item Env:CODEX_RECONCILE_ONLY -ErrorAction SilentlyContinue; $null }

  $nodeOutput = @(node (Join-Path $PSScriptRoot "wake-chat.mjs") $Message 2>&1)
  $nodeOutput | ForEach-Object { Write-Host $_ }
  $wakeExit = $LASTEXITCODE
  $returnedFingerprint = ($nodeOutput | Where-Object { $_ -match '^CHAT_STATE_FINGERPRINT:([0-9a-f]{64})$' } | Select-Object -Last 1) -replace '^CHAT_STATE_FINGERPRINT:',''

  if ($wakeExit -eq 0) {
    if ($QueueOnFailure -or $ReconcileOnly) {
      if (-not (Test-Path $pendingPath)) { throw 'Callback record disappeared before cleanup' }
      $after = Get-Content -Raw $pendingPath | ConvertFrom-Json
      if ([string]$after.callback_id -ne $CallbackId -or [string]$after.routing_version -ne 'explicit-route-v1' -or [string]$after.chat_url -ne $targetChatUrl -or [string]$after.message -ne $Message -or [string]$after.delivery_state -ne 'DELIVERED') { throw 'Verified callback record changed or is not delivered' }
      if (-not $returnedFingerprint -or (Get-CallbackFingerprint $pendingPath) -ne $returnedFingerprint) { throw 'Callback record fingerprint did not match returned final fingerprint' }
      Remove-Item $pendingPath -Force -ErrorAction Stop
      if (Test-Path $pendingPath) { throw 'Callback cleanup failed' }
    }
    Write-Host "CHAT_WAKE_DELIVERED callback_id=$CallbackId" -ForegroundColor Green
    return
  }

  if ($ReconcileOnly) {
    if ($wakeExit -eq 3) { Write-Host "PENDING callback_id=$CallbackId"; return }
    if ($wakeExit -eq 4) { Write-Host "NOT_FOUND callback_id=$CallbackId"; $processStatus = 4; return }
    Write-Host "ERROR callback_id=$CallbackId"
    $processStatus = if ($wakeExit -ne 0) { $wakeExit } else { 1 }
    return
  }

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
  if ($null -eq $previousExpectedFingerprint) { Remove-Item Env:CODEX_CALLBACK_EXPECTED_FINGERPRINT -ErrorAction SilentlyContinue } else { $env:CODEX_CALLBACK_EXPECTED_FINGERPRINT = $previousExpectedFingerprint }
  if ($null -eq $previousReconcileOnly) { Remove-Item Env:CODEX_RECONCILE_ONLY -ErrorAction SilentlyContinue } else { $env:CODEX_RECONCILE_ONLY = $previousReconcileOnly }
  if ($mutexOwned -and $mutex) { $mutex.ReleaseMutex(); $mutex.Dispose(); $mutexOwned = $false }
}
} finally {
  if ($mutexOwned -and $mutex) { try { $mutex.ReleaseMutex() } catch {} ; $mutex.Dispose() }
  if ($processStatus -ne 0) { exit $processStatus }
}
