param([int]$MaxCallbacks=20)
$ErrorActionPreference="Stop"

$Config=Join-Path $HOME ".chatgpt-codex-orchestrator\config.ps1"
if(-not (Test-Path $Config)){throw "Missing local config: $Config"}
. $Config
. (Join-Path $PSScriptRoot "chat-routing.ps1")

$pendingDir=Join-Path $HOME ".chatgpt-codex-orchestrator\pending-wakes"
if(-not (Test-Path $pendingDir)){Write-Host "No pending Chat callbacks.";return}

Update-OriginRoutes

$files=@(Get-ChildItem -Path $pendingDir -Filter "*.json" -File|Sort-Object LastWriteTime|Select-Object -First $MaxCallbacks)
if($files.Count -eq 0){Write-Host "No pending Chat callbacks.";return}

Write-Host "Retrying $($files.Count) pending Chat callback(s)..." -ForegroundColor Cyan
$delivered=0;$remaining=0

foreach($file in $files){
  try{
    $item=Get-Content -Raw $file.FullName|ConvertFrom-Json
    if([string]::IsNullOrWhiteSpace([string]$item.callback_id)-or [string]::IsNullOrWhiteSpace([string]$item.message)){
      Write-Warning "Invalid pending callback file: $($file.FullName)";$remaining++;continue
    }

    $targetUrl=$null;$routeSource=$null

    if(-not [string]::IsNullOrWhiteSpace([string]$item.chat_url)){
      $targetUrl=[string]$item.chat_url
      $routeSource="queued-direct-url"
    }elseif(-not [string]::IsNullOrWhiteSpace([string]$item.project)-and [int]$item.origin_issue -gt 0){
      $projectKey=[string]$item.project
      $issueNumber=[int]$item.origin_issue
      $reviewRoute=[string]$item.review_route

      $route=Resolve-ChatCallbackRoute -ProjectKey $projectKey -IssueNumber $issueNumber -ReviewRoute $reviewRoute

      if(-not $route){
        $allowFallback=$false
        if(-not [string]::IsNullOrWhiteSpace([string]$item.fallback_after_utc)){
          try{
            $fallbackAt=[DateTime]::Parse([string]$item.fallback_after_utc).ToUniversalTime()
            $allowFallback=((Get-Date).ToUniversalTime() -ge $fallbackAt)
          }catch{}
        }
        if($allowFallback){
          $route=Resolve-ChatCallbackRoute -ProjectKey $projectKey -IssueNumber $issueNumber -ReviewRoute $reviewRoute -AllowFallback
        }
      }

      if($route){$targetUrl=[string]$route.Url;$routeSource=[string]$route.Source}
    }

    if([string]::IsNullOrWhiteSpace($targetUrl)){
      Write-Host "CHAT_ROUTE_STILL_PENDING callback_id=$($item.callback_id)"
      $remaining++;continue
    }

    Write-Host "RETRY_ROUTE_RESOLVED callback_id=$($item.callback_id) source=$routeSource"
    & (Join-Path $PSScriptRoot "wake-chat.ps1") -ChatUrl $targetUrl -Message ([string]$item.message) -CallbackId ([string]$item.callback_id) -QueueOnFailure

    if(-not (Test-Path $file.FullName)){$delivered++}else{$remaining++}
  }catch{
    Write-Warning "Pending callback retry failed for $($file.Name): $($_.Exception.Message)"
    $remaining++
  }
}

Write-Host "Pending callback retry complete: delivered=$delivered remaining=$remaining"
