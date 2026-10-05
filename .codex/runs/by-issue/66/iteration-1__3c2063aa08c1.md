<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-05T01:05:01Z
- source_branch: fix/control-runtime-refresh
- source_commit: 3c2063aa08c10ce30a8b92667f4a99e18cf79e54
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261005T010501Z__fix-control-runtime-refresh__3c2063aa08c1.md
- run_file: .codex/runs/by-issue/66/iteration-1__3c2063aa08c1.md
- orchestrator_issue: 66
- iteration: 1
- publisher: Codex-Orchestrator

---

## Objective

Add a safe official refresh-runtime command that updates installed Control runtime artifacts without overwriting mature installation state.

## Result

Status: READY_FOR_REVIEW

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 66
- iteration: 1
- max_iterations: 5
- project_iteration_limit: 5
- source_branch: fix/control-runtime-refresh
- source_commit: 3c2063aa08c10ce30a8b92667f4a99e18cf79e54
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 53759
- prompt_chars: 3344
- prompt_limit: 12000
- wrapper_validation_steps: 1
- review_route: chat-27

## Changed files

- AI_INSTALL.md
- src/cli.mjs
- src/lib/control-env.mjs
- tests/control-runtime-refresh.test.mjs

## Wrapper validation

- wrapper git diff --check: PASS
- full test suite: PASS

  Output tail:
   project keys are deterministic (1.3672ms)
  ✔ project registry can keep the real project disabled while sandbox is enabled (0.7338ms)
  warning: in the working copy of '.github/workflows/orchestrator.yml', LF will be replaced by CRLF the next time Git touches it
  warning: in the working copy of 'chat-routes.json', LF will be replaced by CRLF the next time Git touches it
  warning: in the working copy of 'config.ps1', LF will be replaced by CRLF the next time Git touches it
  warning: in the working copy of 'pending.json', LF will be replaced by CRLF the next time Git touches it
  warning: in the working copy of 'projects.json', LF will be replaced by CRLF the next time Git touches it
  warning: in the working copy of 'scripts/capture-chat-origins.mjs', LF will be replaced by CRLF the next time Git touches it
  warning: in the working copy of 'scripts/local-extra.ps1', LF will be replaced by CRLF the next time Git touches it
  To C:\Users\Jackie\AppData\Local\Temp\orchestrator-refresh-XQ7eVJ\remote.git
   * [new branch]      main -> main
  ✔ runtime refresh preserves mature control state and is idempotent (4323.7835ms)
  ✔ runtime refresh rejects missing control clone or runner identity (1.9575ms)
  ✔ dry-run reports the installation plan without enabling the real project (4568.3627ms)
  ✔ Windows guided installer handles every setup user action (5.2622ms)
  ✔ AI JSON mode remains non-interactive (1.0081ms)
  ✔ Chinese request stays Chinese (3.1635ms)
  ✔ English is default for unknown languages (2.391ms)
  ✔ implementation callbacks point to immutable per-issue reports (2.7742ms)
  ✔ code review callbacks point to immutable by-commit evidence (1.0361ms)
  ✔ installer prepares only the sandbox before sandbox verification (6.2271ms)
  ✔ all remote execution entrypoints block disabled projects (2.3955ms)
  ✔ generated control registry disables the real project until activation (1.3374ms)
  ✔ setup requires ChatGPT access to generated private repos before Codex trust (1.1838ms)
  ✔ sandbox Chat registration happens before sandbox CODEX-RUN (1.1859ms)
  ✔ real project Chat registration happens only after sandbox activation and before READY (1.1891ms)
  ✔ runtime context derives config and queues from instance metadata (2.8251ms)
  ✔ runtime entrypoints do not read the old shared config path (4.7117ms)
  ✔ callback queues are scoped to the installation instance (1.0766ms)
  ✔ control environment writes instance metadata and an instance-scoped config (0.8324ms)
  ✔ installer launches the callback browser with its exact port and profile (0.9686ms)
  ✔ product keeps default 5 and supports opt-in 10, 11, and 20 (1.5941ms)
  ✔ requested and iteration limits remain bounded by the project (0.525ms)
  ✔ generic runtime contains no production-specific hardcodes (13.6202ms)
  ✔ detects npm scripts without asking a user for commands (14.2798ms)
  ✔ detects Python tools conservatively (7.6685ms)
  ✔ does not invent commands for unknown projects (2.22ms)
  ✔ generated instructions point orchestration issues to the control repository (11.8737ms)
  ✔ instructions renderer rejects unresolved configuration (0.8955ms)
  ✔ generated instructions require one-time explicit Chat registration (2.7106ms)
  ✔ submit-report refuses to upload without explicit consent (181.6176ms)
  ✔ legacy project routes are removed without changing other registry fields (16.8099ms)
  ✔ existing install upgrade retires origin discovery runtime (3.8727ms)
  ✔ new callback delivery has explicit state transitions (5.376ms)
  ✔ redacts secret-key fields (3.3649ms)
  ✔ redacts token-shaped strings (0.7412ms)
  ✔ safe spawn never needs a shell for argument passing (113.408ms)
  ✔ core Node runtime contains no shell-true child process invocation (2.6869ms)
  ✔ Windows shim runner transports arguments as Base64 JSON instead of shell text (0.8574ms)
  ✔ control workflow queues multiple pending orchestration runs (2.5538ms)
  ℹ tests 71
  ℹ suites 0
  ℹ pass 71
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 31515.6541

- validation workspace cleanliness: PASS

## Codex final summary

Implemented on `fix/control-runtime-refresh`:

- Added `refreshControlRuntime()` with scripts/workflow-only updates.
- Added `node src/cli.mjs refresh-runtime --json`.
- Preserves mappings, config, routes, queues, metadata, and target repos.
- Removes only known retired scripts.
- Idempotent commit/push behavior.
- Fail-closed structured recoverable errors.
- Documented CLI entrypoint.
- Added regression fixture test.

Validation: syntax and `git diff --check` pass. Full tests are blocked by sandbox-wide Windows `spawn EPERM`, before test execution. No merge or deployment performed.

Skipped: production/live verification, as requested.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

