$ErrorActionPreference = "Stop"

function Get-OrchestratorControlRoot {
  return (Split-Path $PSScriptRoot -Parent)
}

function Get-OrchestratorInstanceId {
  $root = Get-OrchestratorControlRoot
  $instanceFile = Join-Path $root "instance.json"
  if (-not (Test-Path $instanceFile)) {
    throw "Missing orchestrator instance metadata: $instanceFile"
  }

  try {
    $meta = Get-Content -Raw $instanceFile | ConvertFrom-Json
  } catch {
    throw "Orchestrator instance metadata is unreadable: $instanceFile"
  }

  $id = [string]$meta.instance_id
  if ($id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw "Invalid orchestrator instance_id"
  }
  return $id
}

function Get-OrchestratorInstanceRoot {
  $id = Get-OrchestratorInstanceId
  return (Join-Path (Join-Path $HOME ".chatgpt-codex-orchestrator\instances") $id)
}

function Get-OrchestratorConfigPath {
  return (Join-Path (Get-OrchestratorInstanceRoot) "config.ps1")
}

function Get-OrchestratorPendingWakeDir {
  return (Join-Path (Get-OrchestratorInstanceRoot) "pending-wakes")
}

function Get-OrchestratorRetiredPendingWakeDir {
  return (Join-Path (Get-OrchestratorInstanceRoot) "retired-pending-wakes")
}

function Get-OrchestratorChatRoutePath {
  return (Join-Path (Get-OrchestratorInstanceRoot) "chat-routes.json")
}
