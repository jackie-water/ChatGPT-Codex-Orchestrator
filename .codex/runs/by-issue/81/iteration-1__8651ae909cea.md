<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-05T04:27:40Z
- source_branch: fix/codex-executor-isolation
- source_commit: 8651ae909cea832cff9eddd403129a1c869042ab
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261005T042740Z__fix-codex-executor-isolation__8651ae909cea.md
- run_file: .codex/runs/by-issue/81/iteration-1__8651ae909cea.md
- orchestrator_issue: 81
- iteration: 1
- publisher: Codex-Orchestrator

---

## Objective

Isolate orchestrated Codex implementation and independent review from user-global skills/plugins/hooks/memories without mutating persistent Codex settings.

## Result

Status: VALIDATION_FAILED

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 81
- iteration: 1
- max_iterations: 5
- project_iteration_limit: 5
- source_branch: fix/codex-executor-isolation
- source_commit: 8651ae909cea832cff9eddd403129a1c869042ab
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 44998
- prompt_chars: 4057
- prompt_limit: 12000
- wrapper_validation_steps: 1
- review_route: chat-27

## Changed files

- runtime/scripts/preflight.ps1
- runtime/scripts/run-code-review.ps1
- runtime/scripts/run-codex.ps1
- tests/codex-executor-isolation.test.mjs

## Wrapper validation

- wrapper git diff --check: PASS
- full test suite: FAIL (exit 1)

  Output tail:
  n: $($_.Exception.Message)"\r\n  }\r\n}\r\n\r\nif ($promptChars -gt $promptLimit) {\r\n  $reason = "Prompt is $promptChars characters; limit for iteration $iteration is $promptLimit. REVISE prompts must be delta-only."\r\n  $repair = "Rewrite the prompt as a delta-only implementation specification within the $promptLimit-character limit. Keep the exact reviewed commit, deterministic findings, allowed files or surfaces, preserved invariants, and changed acceptance criteria. Remove repeated background and the full original specification."\r\n  Notify-PreCodexRejection $reason $repair\r\n  throw "PROMPT_POLICY_REJECTED: $reason"\r\n}\r\n\r\n$enforceWrapperValidation = $false\r\nif ($project.PSObject.Properties.Name -contains "enforce_wrapper_validation") {\r\n  $enforceWrapperValidation = [bool]$project.enforce_wrapper_validation\r\n}\r\n\r\nif ($enforceWrapperValidation) {\r\n  $validationCommandLines = New-Object System.Collections.Generic.List[string]\r\n  foreach ($rawLine in ($prompt -split "\\r?\\n")) {\r\n    $candidate = $rawLine.Trim()\r\n    $candidate = ($candidate -replace \'^[-*]\\s*\',\'\').Trim()\r\n    $candidate = ($candidate -replace \'^`{1,3}\',\'\').Trim()\r\n    $candidate = ($candidate -replace \'`{1,3}$\',\'\').Trim()\r\n\r\n    # Reject executable routine validation lines wherever they appear.\r\n    # Narrative references such as "the wrapper runs npm test" are not matched.\r\n    if ($candidate -match \'^(npm\\s+(?:test|run\\s+(?:lint|build|test))|git\\s+diff\\s+--check|node\\s+--check)(?:\\s|$)\') {\r\n      $validationCommandLines.Add($candidate)\r\n    }\r\n  }\r\n\r\n  if ($validationCommandLines.Count -gt 0) {\r\n    $preview = ($validationCommandLines | Select-Object -First 5) -join "; "\r\n    $reason = "Routine validation commands must not be executed by Codex. Found executable prompt line(s): $preview"\r\n    $repair = "Rewrite the prompt and REMOVE those validation command lines. Do not ask Codex to run routine npm, node, or git validation. Preserve the implementation specification. Move any task-specific focused checks into validation_steps. The configured project wrapper automatically runs full npm test, lint, build, and git diff --check in the wrapper."\r\n    Notify-PreCodexRejection $reason $repair\r\n    throw "PROMPT_POLICY_REJECTED: $reason"\r\n  }\r\n}\r\n# Deterministic validation is executed by the wrapper after Codex exits.\r\n# Commands are structured argv, never arbitrary shell text.\r\n$allowedValidationExecutables = if ($project.PSObject.Properties.Name -contains "allowed_validation_executables" -and $null -ne $project.allowed_validation_executables) {\r\n  @($project.allowed_validation_executables | ForEach-Object { ([string]$_).ToLowerInvariant() })\r\n} else {\r\n  @("git")\r\n}\r\n$validationSteps = @()\r\n$validationKeys = @{}\r\n$validationSources = @()\r\n\r\nif ($project.PSObject.Properties.Name -contains "default_validation_steps" -and $null -ne $project.default_validation_steps) {\r\n  foreach ($step in @($project.default_validation_steps)) {\r\n    $validationSources += [pscustomobject]@{ Step = $step; Source = "project-default" }\r\n  }\r\n}\r\n\r\nif ($req.PSObject.Properties.Name -contains "validation_steps" -and $null -ne $req.validation_steps) {\r\n  foreach ($step in @($req.validation_steps)) {\r\n    $validationSources += [pscustomobject]@{ Step = $step; Source = "issue" }\r\n  }\r\n}\r\n\r\nforeach ($entry in $validationSources) {\r\n  $step = $entry.Step\r\n  if ($null -eq $step) { continue }\r\n\r\n  $validationCommand = ([string]$step.command).ToLowerInvariant()\r\n  if ($validationCommand -notin $allowedValidationExecutables) {\r\n    throw "Validation command is outside this project\'s allow-list: $validationCommand"\r\n  }\r\n\r\n  $validationArguments = @()\r\n  if ($step.PSObject.Propertie'... 13348 more characters,
      expected: /exec --ignore-user-config[\s\S]*-m \$model[\s\S]*model_reasoning_effort/,
      operator: 'match',
      diff: 'simple'
    }

- validation workspace cleanliness: PASS

## Codex final summary

Implemented deterministic Codex executor isolation.

Changed:

- `run-codex.ps1`: added `--ignore-user-config` and all required feature/skills overrides.
- `run-code-review.ps1`: migrated to isolated `codex exec ... review --base`.
- `preflight.ps1`: fail-closed checks for both required CLI capabilities.
- Added regression assertions in `tests/codex-executor-isolation.test.mjs`.

`git diff --check` passes. Full and focused tests were blocked by environment-wide Windows `spawn EPERM`; workspace contains only the intended changes.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

