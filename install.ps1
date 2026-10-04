param(
  [ValidateSet("auto","en","zh-CN")][string]$Language = "auto",
  [switch]$Json
)

$ErrorActionPreference = "Stop"

function Resolve-Language {
  if ($Language -ne "auto") { return $Language }
  try {
    if ([System.Globalization.CultureInfo]::CurrentUICulture.Name -match '^zh') { return "zh-CN" }
  } catch {}
  return "en"
}

function Refresh-Path {
  $machine=[System.Environment]::GetEnvironmentVariable("Path","Machine")
  $user=[System.Environment]::GetEnvironmentVariable("Path","User")
  $env:Path=$machine+";"+$user
}

$lang = Resolve-Language
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateRoot = Join-Path $HOME ".chatgpt-codex-orchestrator-dev"
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

$messages = @{
  "en" = @{
    Checking = "Checking your computer..."
    NeedWinget = "Automatic prerequisite installation is not available on this computer yet."
    InstallingGit = "Git is missing. Installing it now..."
    InstallingNode = "Node.js is missing. Installing it now..."
    InstallingGh = "GitHub CLI is missing. Installing it now..."
    InstallingCodex = "Codex CLI is missing. Installing it now..."
    Continue = "Prerequisites are ready. Starting guided setup..."
    Done = "Installation is ready."
    Error = "Installation needs attention."
    PressAfter = "Complete only the step above, then press Enter to continue."
    RepoPrompt = "GitHub repository (owner/repository)"
    ChatPrompt = "Current ChatGPT conversation URL"
    Waiting = "The automation is still working. Check this registered Chat when a callback appears. When that step is complete, return here and press Enter to check again."
    InstructionsCopied = "The generated ChatGPT Project Instructions were copied to your clipboard. Paste them into the ChatGPT Project Instructions, then return here."
    ApproveQuestion = "Approve merging this exact reviewed commit into the INSTALLATION SANDBOX ONLY? Type YES to approve"
    Declined = "Sandbox merge was not approved. No real project change was made."
    ReportHint = "You can double-click Report a Problem.cmd to prepare a sanitised local diagnostic report."
  }
  "zh-CN" = @{
    Checking = "正在检查你的电脑..."
    NeedWinget = "这台电脑目前无法自动安装缺少的基础软件。"
    InstallingGit = "没有检测到 Git，正在自动安装..."
    InstallingNode = "没有检测到 Node.js，正在自动安装..."
    InstallingGh = "没有检测到 GitHub CLI，正在自动安装..."
    InstallingCodex = "没有检测到 Codex CLI，正在自动安装..."
    Continue = "基础环境已准备好，正在启动安装向导..."
    Done = "安装已经完成，可以开始使用。"
    Error = "安装过程中有一项需要处理。"
    PressAfter = "请只完成上面这一项，完成后回到这里按 Enter 继续。"
    RepoPrompt = "GitHub repository（owner/repository）"
    ChatPrompt = "当前这条 ChatGPT 对话的完整地址"
    Waiting = "自动化仍在运行。收到 callback 后请在当前已登记的 Chat 中继续处理；完成该步骤后回到这里按 Enter 再检查。"
    InstructionsCopied = "生成的 ChatGPT Project Instructions 已复制到剪贴板。请粘贴到 ChatGPT Project Instructions，完成后回到这里。"
    ApproveQuestion = "是否批准把这个 exact reviewed commit 合并到【安装 Sandbox】？只会影响 Sandbox。输入 YES 批准"
    Declined = "你没有批准 Sandbox merge。真实项目没有发生修改。"
    ReportHint = "你可以双击 Report a Problem.cmd，在本地生成一份脱敏诊断报告。"
  }
}
$m = $messages[$lang]

function Emit-Json([hashtable]$Payload,[int]$Code=0) {
  $Payload | ConvertTo-Json -Depth 12
  exit $Code
}

function Invoke-CliJson([string[]]$CliArgs) {
  $all=@((Join-Path $root "src\cli.mjs")) + $CliArgs + @("--json")
  $raw=& node @all
  $code=$LASTEXITCODE
  $text=($raw -join [Environment]::NewLine).Trim()
  if([string]::IsNullOrWhiteSpace($text)){throw "Installer CLI returned no structured result"}
  try{$payload=$text|ConvertFrom-Json}catch{throw "Installer CLI returned invalid JSON: $text"}
  return [pscustomobject]@{Payload=$payload;ExitCode=$code}
}

function Save-Answer([string]$Action,[string]$Value) {
  $result=Invoke-CliJson @("answer","--action",$Action,"--value",$Value)
  if($result.ExitCode -ne 0){throw ([string]$result.Payload.message)}
}

function Run-InteractiveHelper([string[]]$CliArgs) {
  & node (Join-Path $root "src\cli.mjs") @CliArgs
  if($LASTEXITCODE -ne 0){throw "The interactive authorization step did not complete"}
}

if(-not $Json){Write-Host $m.Checking -ForegroundColor Cyan}
$winget=Get-Command winget.exe -ErrorAction SilentlyContinue

if(-not (Get-Command git.exe -ErrorAction SilentlyContinue)){
  if(-not $winget){
    if($Json){Emit-Json @{status="ERROR";error_id="SETUP-001";recoverable=$false;message=$m.NeedWinget;preferred_language=$lang} 1}
    throw $m.NeedWinget
  }
  if(-not $Json){Write-Host $m.InstallingGit}
  & winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
  if($LASTEXITCODE -ne 0){throw "SETUP-001: Git installation failed"}
  Refresh-Path
}

if(-not (Get-Command node.exe -ErrorAction SilentlyContinue)){
  if(-not $winget){
    if($Json){Emit-Json @{status="ERROR";error_id="SETUP-002";recoverable=$false;message=$m.NeedWinget;preferred_language=$lang} 1}
    throw $m.NeedWinget
  }
  if(-not $Json){Write-Host $m.InstallingNode}
  & winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  if($LASTEXITCODE -ne 0){throw "SETUP-002: Node.js installation failed"}
  Refresh-Path
}

if(-not (Get-Command gh.exe -ErrorAction SilentlyContinue) -and -not (Get-Command gh -ErrorAction SilentlyContinue)){
  if(-not $winget){
    if($Json){Emit-Json @{status="ERROR";error_id="SETUP-010";recoverable=$false;message=$m.NeedWinget;preferred_language=$lang} 1}
    throw $m.NeedWinget
  }
  if(-not $Json){Write-Host $m.InstallingGh}
  & winget install --id GitHub.cli --exact --accept-package-agreements --accept-source-agreements
  if($LASTEXITCODE -ne 0){throw "SETUP-010: GitHub CLI installation failed"}
  Refresh-Path
}

if(-not (Get-Command codex.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command codex -ErrorAction SilentlyContinue)){
  if(-not $Json){Write-Host $m.InstallingCodex}
  $npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
  if(-not $npm){$npm=Get-Command npm -ErrorAction Stop}
  & $npm.Source install -g @openai/codex@latest
  if($LASTEXITCODE -ne 0){throw "SETUP-003: Codex CLI installation failed"}
  Refresh-Path
}

if($Json){
  $args=@((Join-Path $root "src\cli.mjs"),"setup","--language",$lang,"--json")
  & node @args
  exit $LASTEXITCODE
}

Write-Host $m.Continue -ForegroundColor Green

while($true){
  $result=Invoke-CliJson @("resume","--language",$lang)
  $payload=$result.Payload

  Write-Host ""
  Write-Host ([string]$payload.message) -ForegroundColor Cyan

  if($payload.status -eq "PASS"){
    Write-Host $m.Done -ForegroundColor Green
    break
  }

  if($payload.status -eq "ERROR"){
    if($payload.error_id){Write-Host ("Error ID: "+$payload.error_id) -ForegroundColor Red}
    if($payload.details){Write-Host ([string]$payload.details)}
    Write-Host $m.ReportHint -ForegroundColor Yellow
    exit 1
  }

  if($payload.status -eq "WAITING"){
    Read-Host $m.Waiting | Out-Null
    continue
  }

  if($payload.status -ne "NEEDS_USER_ACTION"){
    throw "Unexpected installer status: $($payload.status)"
  }

  $action=[string]$payload.action_id
  switch($action){
    "github_cli_authorization" {
      Run-InteractiveHelper @("github-login")
    }
    "github_plugin_authorization" {
      Read-Host $m.PressAfter | Out-Null
      Save-Answer $action "true"
    }
    "target_repository" {
      $value=Read-Host $m.RepoPrompt
      Save-Answer $action $value
    }
    "reviewer_chat_url" {
      $value=Read-Host $m.ChatPrompt
      Save-Answer $action $value
    }
    "generated_repo_authorization" {
      if($payload.repositories){
        Write-Host ""
        foreach($repo in @($payload.repositories)){ Write-Host ("  - "+$repo) -ForegroundColor Yellow }
      }
      Read-Host $m.PressAfter | Out-Null
      Save-Answer $action "true"
    }
    "codex_login" {
      Run-InteractiveHelper @("codex-login")
    }
    "codex_trust_sandbox" {
      Run-InteractiveHelper @("codex-open","--scope","sandbox")
      Read-Host $m.PressAfter | Out-Null
      Save-Answer $action "true"
    }
    "reviewer_browser_login" {
      Read-Host $m.PressAfter | Out-Null
      Save-Answer $action "true"
    }
    "chatgpt_project_instructions" {
      $generated=Join-Path $root ([string]$payload.generated_file)
      if(Test-Path $generated){
        Get-Content -Raw $generated | Set-Clipboard
        Write-Host $m.InstructionsCopied -ForegroundColor Yellow
      }
      Read-Host $m.PressAfter | Out-Null
      Save-Answer $action "true"
    }
    "sandbox_merge_approval" {
      $answer=Read-Host $m.ApproveQuestion
      if($answer -notmatch '^(?i:YES)$'){
        Write-Host $m.Declined -ForegroundColor Yellow
        exit 0
      }
      $approved=Invoke-CliJson @("smoke-approve","--commit",([string]$payload.reviewed_commit),"--yes")
      if($approved.ExitCode -ne 0){throw ([string]$approved.Payload.message)}
    }
    "codex_trust_project" {
      Run-InteractiveHelper @("codex-open","--scope","project")
      Read-Host $m.PressAfter | Out-Null
      Save-Answer $action "true"
    }
    default {
      throw "Unsupported guided installer action: $action"
    }
  }
}
