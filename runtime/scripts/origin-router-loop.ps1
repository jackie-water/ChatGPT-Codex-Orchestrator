param([int]$IntervalSeconds=10,[int]$MaxCallbacks=50)
$ErrorActionPreference="Continue"
if($IntervalSeconds -lt 5){$IntervalSeconds=5}
$instance = if($env:ORCHESTRATOR_INSTANCE_ID){$env:ORCHESTRATOR_INSTANCE_ID}else{"default"}
$safeInstance = $instance -replace '[^A-Za-z0-9_.-]','-'
$mutexName="Local\ChatGPTCodexOrchestratorOriginRouter-"+$safeInstance
$mutex=New-Object System.Threading.Mutex($false,$mutexName)
$acquired=$false
try{
  try{$acquired=$mutex.WaitOne(0)}catch [System.Threading.AbandonedMutexException]{$acquired=$true}
  if(-not $acquired){Write-Host "ORIGIN_ROUTER_ALREADY_RUNNING";exit 0}
  Write-Host "ORIGIN_ROUTER_STARTED interval=$IntervalSeconds instance=$safeInstance"
  while($true){
    try{& (Join-Path $PSScriptRoot "retry-pending-callbacks.ps1") -MaxCallbacks $MaxCallbacks}
    catch{Write-Warning "Origin router retry cycle failed: $($_.Exception.Message)"}
    Start-Sleep -Seconds $IntervalSeconds
  }
}finally{
  if($acquired){try{$mutex.ReleaseMutex()}catch{}}
  $mutex.Dispose()
}
