param(
  [Parameter(Mandatory=$true)][string]$ProjectKey,
  [Parameter(Mandatory=$true)][int]$IssueNumber,
  [Parameter(Mandatory=$true)][string]$Message,
  [Parameter(Mandatory=$true)][string]$CallbackId,
  [string]$ReviewRoute,
  [int]$WaitForOriginSeconds = 30
)

$ErrorActionPreference = "Stop"
$Config = Join-Path $HOME ".chatgpt-codex-orchestrator\config.ps1"
if (-not (Test-Path $Config)) { throw "Missing local config: $Config" }
. $Config
. (Join-Path $PSScriptRoot "chat-routing.ps1")

if ($CallbackId -notmatch '^[A-Za-z0-9._-]{1,160}$') { throw "CallbackId contains unsupported characters" }

$fallbackMinutes = if ($env:ORCHESTRATOR_ORIGIN_FALLBACK_MINUTES) {[int]$env:ORCHESTRATOR_ORIGIN_FALLBACK_MINUTES}else{30}
if($fallbackMinutes -lt 1){$fallbackMinutes=30}

$deadline=(Get-Date).AddSeconds([Math]::Max(0,$WaitForOriginSeconds))
$route=$null
do{
  Update-OriginRoutes
  $route=Resolve-ChatCallbackRoute -ProjectKey $ProjectKey -IssueNumber $IssueNumber -ReviewRoute $ReviewRoute
  if($route){break}
  if((Get-Date)-ge $deadline){break}
  Start-Sleep -Seconds 2
}while($true)

if($route){
  Write-Host "CHAT_ROUTE_RESOLVED issue=$IssueNumber source=$($route.Source) url=$($route.Url)"
  & (Join-Path $PSScriptRoot "wake-chat.ps1") -ChatUrl $route.Url -Message $Message -CallbackId $CallbackId -QueueOnFailure
  return
}

$pendingDir=Join-Path $HOME ".chatgpt-codex-orchestrator\pending-wakes"
New-Item -ItemType Directory -Force -Path $pendingDir|Out-Null
$pendingPath=Join-Path $pendingDir ($CallbackId+".json")
$now=(Get-Date).ToUniversalTime()
$fallbackAt=$now.AddMinutes($fallbackMinutes)
$pending=[pscustomobject]@{
  callback_id=$CallbackId
  project=$ProjectKey
  origin_issue=$IssueNumber
  review_route=$ReviewRoute
  message=$Message
  queued_at_utc=$now.ToString("yyyy-MM-ddTHH:mm:ssZ")
  fallback_after_utc=$fallbackAt.ToString("yyyy-MM-ddTHH:mm:ssZ")
}
$pending|ConvertTo-Json -Depth 5|Set-Content -Path $pendingPath -Encoding utf8

$originRouter=Join-Path $PSScriptRoot "origin-router-loop.ps1"
try{
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile","-ExecutionPolicy","Bypass","-File",$originRouter
  )|Out-Null
}catch{Write-Warning "Could not start origin router loop: $($_.Exception.Message)"}

Write-Warning "CHAT_ROUTE_PENDING callback_id=$CallbackId issue=$IssueNumber. No origin marker route is available yet."
Write-Host "The callback was queued without choosing another Chat. Fallback becomes eligible after $($fallbackAt.ToString('u'))."
