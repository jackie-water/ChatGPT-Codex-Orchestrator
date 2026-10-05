<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-05T08:51:45Z
- source_branch: fix/ordinary-exec-workspace-profile
- source_commit: a4aa17871f393f276e1324c7431f5ca65bfc0932
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261005T085145Z__fix-ordinary-exec-workspace-profile__a4aa17871f39.md
- run_file: .codex/runs/by-issue/94/iteration-1__a4aa17871f39.md
- orchestrator_issue: 94
- iteration: 1
- publisher: Codex-Orchestrator

---

## Objective

Use Codex built-in :workspace permission profile for ordinary isolated exec on Windows.

## Result

Status: READY_FOR_REVIEW

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 94
- iteration: 1
- max_iterations: 5
- project_iteration_limit: 5
- source_branch: fix/ordinary-exec-workspace-profile
- source_commit: a4aa17871f393f276e1324c7431f5ca65bfc0932
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 35732
- prompt_chars: 3320
- prompt_limit: 12000
- wrapper_validation_steps: 1
- review_route: chat-27

## Changed files

- runtime/scripts/preflight.ps1
- runtime/scripts/run-codex.ps1
- tests/codex-executor-isolation.test.mjs

## Wrapper validation

- wrapper git diff --check: PASS
- full test suite: PASS

  Output tail:
  py of 'scripts/run-codex.ps1', LF will be replaced by CRLF the next time Git touches it
  To C:\Users\Jackie\AppData\Local\Temp\orchestrator-retry-HFnst8\remote.git
     9d3e987..3f27d48  HEAD -> main
  warning: in the working copy of 'scripts/unrelated.mjs', LF will be replaced by CRLF the next time Git touches it
  To C:\Users\Jackie\AppData\Local\Temp\orchestrator-staged-DqpjAF\remote.git
   * [new branch]      main -> main
  warning: in the working copy of 'scripts/unrelated.mjs', LF will be replaced by CRLF the next time Git touches it
  ✔ runtime refresh accepts exact GitHub HTTPS and SSH remotes (6.0765ms)
  ✔ runtime refresh validates fetch and every explicit push URL before mutation (226.8329ms)
  ✔ runtime refresh preserves mature control state and is idempotent (7612.9151ms)
  ✔ runtime refresh rolls back a committed refresh when push fails and retries (7945.5178ms)
  ✔ runtime refresh rejects every remote-main mismatch before mutation (10.9053ms)
  ✔ runtime refresh rejects pre-staged changes before copying (3444.1922ms)
  ✔ runtime refresh rejects missing or mismatched control identity before mutation (541.4603ms)
  ✔ dry-run reports the installation plan without enabling the real project (4241.477ms)
  ✔ Windows guided installer handles every setup user action (8.5558ms)
  ✔ AI JSON mode remains non-interactive (2.9838ms)
  ✔ Chinese request stays Chinese (8.6322ms)
  ✔ English is default for unknown languages (2.1674ms)
  ✔ runtime refresh messages and error catalog stay covered (0.6124ms)
  ✔ implementation callbacks point to immutable per-issue reports (4.3473ms)
  ✔ code review callbacks point to immutable by-commit evidence (3.0747ms)
  ✔ installer prepares only the sandbox before sandbox verification (5.8576ms)
  ✔ all remote execution entrypoints block disabled projects (6.871ms)
  ✔ generated control registry disables the real project until activation (1.597ms)
  ✔ setup requires ChatGPT access to generated private repos before Codex trust (1.3823ms)
  ✔ sandbox Chat registration happens before sandbox CODEX-RUN (1.4402ms)
  ✔ real project Chat registration happens only after sandbox activation and before READY (2.2289ms)
  ✔ runtime context derives config and queues from instance metadata (4.2425ms)
  ✔ runtime entrypoints do not read the old shared config path (25.6115ms)
  ✔ callback queues are scoped to the installation instance (1.6372ms)
  ✔ control environment writes instance metadata and an instance-scoped config (4.5912ms)
  ✔ installer launches the callback browser with its exact port and profile (1.1105ms)
  ✔ product keeps default 5 and supports opt-in 10, 11, and 20 (3.2508ms)
  ✔ requested and iteration limits remain bounded by the project (1.1466ms)
  ✔ generic runtime contains no production-specific hardcodes (16.9004ms)
  ✔ detects npm scripts without asking a user for commands (36.8843ms)
  ✔ detects Python tools conservatively (20.0443ms)
  ✔ does not invent commands for unknown projects (7.9869ms)
  ✔ generated instructions point orchestration issues to the control repository (5.9434ms)
  ✔ instructions renderer rejects unresolved configuration (1.0157ms)
  ✔ generated instructions require one-time explicit Chat registration (4.1937ms)
  ✔ submit-report refuses to upload without explicit consent (361.8019ms)
  ✔ legacy project routes are removed without changing other registry fields (23.9804ms)
  ✔ existing install upgrade retires origin discovery runtime (6.915ms)
  ✔ new callback delivery has explicit state transitions (12.3545ms)
  ✔ redacts secret-key fields (10.3149ms)
  ✔ redacts token-shaped strings (0.8634ms)
  ✔ safe spawn never needs a shell for argument passing (292.512ms)
  ✔ core Node runtime contains no shell-true child process invocation (4.0772ms)
  ✔ Windows shim runner transports arguments as Base64 JSON instead of shell text (1.3432ms)
  ✔ control workflow queues multiple pending orchestration runs (12.8074ms)
  ℹ tests 81
  ℹ suites 0
  ℹ pass 81
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 43544.779

- validation workspace cleanliness: PASS

## Codex final summary

Implemented on base `349605d7dd7c93701b0e1761ec82434f2fabc869`:

- Replaced `-s workspace-write` with `-c 'default_permissions=":workspace"'`.
- Removed obsolete preflight sandbox capability check.
- Updated focused isolation tests.
- Review path unchanged.
- No global/persistent state changes.

Validation:

- Manual focused assertions: PASS
- `git diff --check`: PASS
- Workspace: only the 3 allowed files modified
- Full/focused Node tests blocked by executor `spawn EPERM` before tests run.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

