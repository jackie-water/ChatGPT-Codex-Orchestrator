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

function Emit([hashtable]$Payload) {
  if ($Json) { $Payload | ConvertTo-Json -Depth 8 }
  else { Write-Host $Payload.message }
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
  }
  "zh-CN" = @{
    Checking = "正在检查你的电脑..."
    NeedWinget = "这台电脑目前无法自动安装缺少的基础软件。"
    InstallingGit = "没有检测到 Git，正在自动安装..."
    InstallingNode = "没有检测到 Node.js，正在自动安装..."
    InstallingGh = "没有检测到 GitHub CLI，正在自动安装..."
    InstallingCodex = "没有检测到 Codex CLI，正在自动安装..."
    Continue = "基础环境已准备好，正在启动安装向导..."
  }
}
$m = $messages[$lang]
if (-not $Json) { Write-Host $m.Checking -ForegroundColor Cyan }

$winget = Get-Command winget.exe -ErrorAction SilentlyContinue

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
  if (-not $winget) { Emit @{status="ERROR";error_id="SETUP-001";recoverable=$false;message=$m.NeedWinget;preferred_language=$lang}; exit 1 }
  if (-not $Json) { Write-Host $m.InstallingGit }
  & winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "SETUP-001: Git installation failed" }
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  if (-not $winget) { Emit @{status="ERROR";error_id="SETUP-002";recoverable=$false;message=$m.NeedWinget;preferred_language=$lang}; exit 1 }
  if (-not $Json) { Write-Host $m.InstallingNode }
  & winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "SETUP-002: Node.js installation failed" }
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

if (-not (Get-Command gh.exe -ErrorAction SilentlyContinue) -and -not (Get-Command gh -ErrorAction SilentlyContinue)) {
  if (-not $winget) { Emit @{status="ERROR";error_id="SETUP-010";recoverable=$false;message=$m.NeedWinget;preferred_language=$lang}; exit 1 }
  if (-not $Json) { Write-Host $m.InstallingGh }
  & winget install --id GitHub.cli --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "SETUP-010: GitHub CLI installation failed" }
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

if (-not (Get-Command codex.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command codex -ErrorAction SilentlyContinue)) {
  if (-not $Json) { Write-Host $m.InstallingCodex }
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { $npm = Get-Command npm -ErrorAction Stop }
  & $npm.Source install -g @openai/codex@latest
  if ($LASTEXITCODE -ne 0) { throw "SETUP-003: Codex CLI installation failed" }
}

if (-not $Json) { Write-Host $m.Continue -ForegroundColor Green }
$args = @((Join-Path $root "src\cli.mjs"), "setup", "--language", $lang)
if ($Json) { $args += "--json" }
& node @args
exit $LASTEXITCODE
