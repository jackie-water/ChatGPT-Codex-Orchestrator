# Generated installs copy this to $HOME\.chatgpt-codex-orchestrator\config.ps1.
# Never commit the real file.

$TRUSTED_GITHUB_USERS = @(
  "REPLACE_WITH_GITHUB_USERNAME"
)

$PROJECT_LOCAL_PATHS = @{
  "example-project" = "$HOME\ChatGPTCodexProjects\example-project"
}

$PROJECT_REVIEW_ROUTES = @{
  "example-project" = "https://chatgpt.com/c/REPLACE_WITH_REVIEWER_CHAT"
}

$CHAT_ROUTES = @{}

$env:ORCHESTRATOR_BROWSER_DEBUG_PORT = "9333"
$env:CODEX_ORCHESTRATOR_MODEL = "gpt-5.6-luna"
$env:CODEX_ORCHESTRATOR_REASONING = "low"
$env:CODEX_ORCHESTRATOR_RUNNER_PATH = "C:\actions-runner-codex-orchestrator"

# Issue-origin automatic routing is preferred.
# Project/default reviewer URLs are disaster-recovery fallbacks only.
$env:ORCHESTRATOR_ORIGIN_FALLBACK_MINUTES = "30"
$env:ORCHESTRATOR_INSTANCE_ID = "example-installation"
