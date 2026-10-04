$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "runtime-context.ps1")

function Get-ChatRouteRegistryPath {
  if ($env:CODEX_CHAT_ROUTE_FILE) { return [string]$env:CODEX_CHAT_ROUTE_FILE }
  return (Get-OrchestratorChatRoutePath)
}

function Test-ChatConversationUrl {
  param([string]$Url)
  return (-not [string]::IsNullOrWhiteSpace($Url) -and
    $Url -match '^https://chatgpt\.com/(?:g/[^/]+/)?c/[A-Za-z0-9-]+(?:[/?#].*)?$')
}

function Normalize-ChatConversationUrl {
  param([Parameter(Mandatory=$true)][string]$Url)
  if (-not (Test-ChatConversationUrl $Url)) { throw "Invalid ChatGPT conversation URL" }

  $uri = [System.Uri]$Url
  return ($uri.Scheme + "://" + $uri.Host + $uri.AbsolutePath).TrimEnd("/")
}

function Read-ChatRouteRegistry {
  $path = Get-ChatRouteRegistryPath
  if (-not (Test-Path $path)) {
    return [pscustomobject]@{
      version = 1
      routes = @()
    }
  }

  try {
    $registry = Get-Content -Raw $path | ConvertFrom-Json
  } catch {
    throw "Chat route registry is unreadable: $path"
  }

  if (-not ($registry.PSObject.Properties.Name -contains "routes") -or $null -eq $registry.routes) {
    $registry | Add-Member -NotePropertyName routes -NotePropertyValue @()
  }
  if (-not ($registry.PSObject.Properties.Name -contains "version")) {
    $registry | Add-Member -NotePropertyName version -NotePropertyValue 1
  } else {
    $registry.version = 1
  }

  return $registry
}

function Write-ChatRouteRegistry {
  param([Parameter(Mandatory=$true)]$Registry)

  $path = Get-ChatRouteRegistryPath
  $dir = Split-Path $path -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  $temp = $path + "." + [guid]::NewGuid().ToString("N") + ".tmp"
  try {
    if ($Registry.PSObject.Properties.Name -contains "version") {
      $Registry.version = 1
    } else {
      $Registry | Add-Member -NotePropertyName version -NotePropertyValue 1
    }
    $Registry | ConvertTo-Json -Depth 8 | Set-Content -Path $temp -Encoding utf8
    Move-Item -Force $temp $path
  } finally {
    Remove-Item -Force $temp -ErrorAction SilentlyContinue
  }
}

function Register-ChatRoute {
  param(
    [Parameter(Mandatory=$true)][string]$ProjectKey,
    [Parameter(Mandatory=$true)][string]$ChatUrl,
    [Parameter(Mandatory=$true)][int]$RegistrationIssue
  )

  if ($RegistrationIssue -lt 1) { throw "Registration issue number is invalid" }

  $normalizedUrl = Normalize-ChatConversationUrl $ChatUrl
  $project = $ProjectKey.ToLowerInvariant()
  $registry = Read-ChatRouteRegistry
  $routes = @($registry.routes)

  $sameUrl = @($routes | Where-Object {
    ([string]$_.project).ToLowerInvariant() -eq $project -and
    [string]$_.chat_url -eq $normalizedUrl -and
    [string]$_.status -eq "active"
  } | Select-Object -First 1)

  if ($sameUrl.Count -gt 0) {
    return $sameUrl[0]
  }

  $route = "chat-$RegistrationIssue"
  if ($route -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') {
    throw "Generated chat route is invalid: $route"
  }

  $collision = @($routes | Where-Object { [string]$_.route -eq $route } | Select-Object -First 1)
  if ($collision.Count -gt 0) {
    if (([string]$collision[0].project).ToLowerInvariant() -ne $project -or
        [string]$collision[0].chat_url -ne $normalizedUrl) {
      throw "Chat route collision for $route"
    }
    return $collision[0]
  }

  $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $record = [pscustomobject]@{
    route = $route
    project = $project
    chat_url = $normalizedUrl
    status = "active"
    registration_issue = $RegistrationIssue
    registered_at_utc = $now
  }

  $registry.routes = @($routes + $record)
  Write-ChatRouteRegistry $registry
  return $record
}

function Resolve-RegisteredChatRoute {
  param(
    [Parameter(Mandatory=$true)][string]$ProjectKey,
    [Parameter(Mandatory=$true)][string]$Route
  )

  if ($Route -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') { return $null }

  $project = $ProjectKey.ToLowerInvariant()
  $registry = Read-ChatRouteRegistry
  $match = @(@($registry.routes) | Where-Object {
    [string]$_.route -eq $Route -and
    ([string]$_.project).ToLowerInvariant() -eq $project -and
    [string]$_.status -eq "active"
  } | Select-Object -First 1)

  if ($match.Count -eq 0) { return $null }

  $url = [string]$match[0].chat_url
  if (-not (Test-ChatConversationUrl $url)) {
    throw "Registered Chat route '$Route' has an invalid URL"
  }

  return $match[0]
}

function Disable-RegisteredChatRoute {
  param(
    [Parameter(Mandatory=$true)][string]$ProjectKey,
    [Parameter(Mandatory=$true)][string]$Route
  )

  $project = $ProjectKey.ToLowerInvariant()
  $registry = Read-ChatRouteRegistry
  $changed = $false
  foreach ($entry in @($registry.routes)) {
    if ([string]$entry.route -eq $Route -and
        ([string]$entry.project).ToLowerInvariant() -eq $project -and
        [string]$entry.status -eq "active") {
      $entry.status = "inactive"
      $entry | Add-Member -Force -NotePropertyName disabled_at_utc -NotePropertyValue ((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
      $changed = $true
    }
  }
  if ($changed) { Write-ChatRouteRegistry $registry }
  return $changed
}
