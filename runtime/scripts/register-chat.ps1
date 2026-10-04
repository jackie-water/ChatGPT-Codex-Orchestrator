param([Parameter(Mandatory=$true)][string]$EventPath)
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "runtime-context.ps1")
$ConfigPath = Get-OrchestratorConfigPath
$RegistryPath = Join-Path $Root "projects.json"

if (-not (Test-Path $ConfigPath)) { throw "Missing local config: $ConfigPath" }
if (-not (Test-Path $RegistryPath)) { throw "Missing project registry: $RegistryPath" }

. $ConfigPath
. (Join-Path $PSScriptRoot "chat-route-registry.ps1")

$projects = Get-Content -Raw $RegistryPath | ConvertFrom-Json
$event = Get-Content -Raw $EventPath | ConvertFrom-Json

if (-not $TRUSTED_GITHUB_USERS -or [string]$event.issue.user.login -notin @($TRUSTED_GITHUB_USERS)) {
  throw "Untrusted chat registration author"
}
try { $req = ([string]$event.issue.body) | ConvertFrom-Json } catch { throw "Chat registration body must be valid JSON" }

$projectKey = ([string]$req.project).ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($projectKey)) { throw "project is required" }
if (-not $projects.projects.PSObject.Properties[$projectKey]) { throw "Unknown project: $projectKey" }

$chatUrl = [string]$req.chat_url
if (-not (Test-ChatConversationUrl $chatUrl)) {
  throw "chat_url must be a full ChatGPT conversation URL"
}

$record = Register-ChatRoute -ProjectKey $projectKey -ChatUrl $chatUrl -RegistrationIssue ([int]$event.issue.number)
$route = [string]$record.route
$normalizedUrl = [string]$record.chat_url

Write-Host "CHAT_ROUTE_REGISTERED project=$projectKey route=$route issue=$($event.issue.number)"

$callbackId = "chat-register-$projectKey-$($event.issue.number)"
$message = "[CHAT-ROUTE-REGISTERED callback_id=$callbackId] Registration complete for project '$projectKey'. This Chat's review_route is '$route'. Use this exact route for every future CODEX-RUN, CODE-REVIEW, and MERGE-APPROVE created from this conversation. Do not substitute another Chat route. If work moves to another Chat, register that Chat separately."

& (Join-Path $PSScriptRoot "wake-chat.ps1") -ChatUrl $normalizedUrl -Message $message -CallbackId $callbackId -QueueOnFailure
