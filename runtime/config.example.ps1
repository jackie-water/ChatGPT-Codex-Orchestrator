# Generated installs store each private config under:
# $HOME\.chatgpt-codex-orchestrator\instances\<instance_id>\config.ps1
# Never commit the real file.

$TRUSTED_GITHUB_USERS = @(
  "REPLACE_WITH_GITHUB_USERNAME"
)

$PROJECT_LOCAL_PATHS = @{
  "example-project" = "$HOME\ChatGPTCodexProjects\example-project"
}

$env:ORCHESTRATOR_BROWSER_DEBUG_PORT = "REPLACE_WITH_INSTANCE_PORT"
$env:ORCHESTRATOR_BROWSER_PROFILE = "$env:LOCALAPPDATA\ChatGPTCodexOrchestratorReviewer-example"
$env:ORCHESTRATOR_INSTANCE_ID = "example-installation"
$env:CODEX_CHAT_ROUTE_FILE = "$HOME\.chatgpt-codex-orchestrator\instances\example-installation\chat-routes.json"
$env:CODEX_ORCHESTRATOR_MODEL = "gpt-5.6-luna"
$env:CODEX_ORCHESTRATOR_REASONING = "low"
$env:CODEX_ORCHESTRATOR_RUNNER_PATH = "C:\actions-runner-codex-orchestrator-example"

# Pending callbacks and route state are stored under the same instance directory.
# Chat callback destinations are registered explicitly through [CHAT-REGISTER].
# There is no default reviewer or fallback Chat.
