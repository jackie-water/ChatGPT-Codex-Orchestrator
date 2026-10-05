<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-05T06:58:01Z
- source_branch: fix/executor-workspace-sandbox
- source_commit: 6261a9f2347f3ce502fc547f9aea05a4b0e6df86
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261005T065801Z__fix-executor-workspace-sandbox__6261a9f2347f.md
- run_file: .codex/runs/by-issue/86/iteration-1__6261a9f2347f.md
- orchestrator_issue: 86
- iteration: 1
- publisher: Codex-Orchestrator

---

## Objective

Restore writable implementation sandbox under executor isolation using explicit Codex CLI harness permissions.

## Result

Status: READY_FOR_REVIEW

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 86
- iteration: 1
- max_iterations: 5
- project_iteration_limit: 5
- source_branch: fix/executor-workspace-sandbox
- source_commit: 6261a9f2347f3ce502fc547f9aea05a4b0e6df86
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 72172
- prompt_chars: 3069
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
  copy of 'scripts/run-codex.ps1', LF will be replaced by CRLF the next time Git touches it
  To C:\Users\Jackie\AppData\Local\Temp\orchestrator-retry-BFACIe\remote.git
     a9d7b7b..f4734ca  HEAD -> main
  warning: in the working copy of 'scripts/unrelated.mjs', LF will be replaced by CRLF the next time Git touches it
  To C:\Users\Jackie\AppData\Local\Temp\orchestrator-staged-vi370k\remote.git
   * [new branch]      main -> main
  warning: in the working copy of 'scripts/unrelated.mjs', LF will be replaced by CRLF the next time Git touches it
  ✔ runtime refresh accepts exact GitHub HTTPS and SSH remotes (5.1143ms)
  ✔ runtime refresh validates fetch and every explicit push URL before mutation (80.0584ms)
  ✔ runtime refresh preserves mature control state and is idempotent (6916.7231ms)
  ✔ runtime refresh rolls back a committed refresh when push fails and retries (5401.6606ms)
  ✔ runtime refresh rejects every remote-main mismatch before mutation (10.1022ms)
  ✔ runtime refresh rejects pre-staged changes before copying (3366.9868ms)
  ✔ runtime refresh rejects missing or mismatched control identity before mutation (365.9698ms)
  ✔ dry-run reports the installation plan without enabling the real project (4074.6788ms)
  ✔ Windows guided installer handles every setup user action (11.0692ms)
  ✔ AI JSON mode remains non-interactive (3.0019ms)
  ✔ Chinese request stays Chinese (6.5505ms)
  ✔ English is default for unknown languages (2.5373ms)
  ✔ runtime refresh messages and error catalog stay covered (0.7163ms)
  ✔ implementation callbacks point to immutable per-issue reports (7.706ms)
  ✔ code review callbacks point to immutable by-commit evidence (3.8054ms)
  ✔ installer prepares only the sandbox before sandbox verification (10.7817ms)
  ✔ all remote execution entrypoints block disabled projects (9.0874ms)
  ✔ generated control registry disables the real project until activation (3.8143ms)
  ✔ setup requires ChatGPT access to generated private repos before Codex trust (4.6158ms)
  ✔ sandbox Chat registration happens before sandbox CODEX-RUN (4.7408ms)
  ✔ real project Chat registration happens only after sandbox activation and before READY (4.547ms)
  ✔ runtime context derives config and queues from instance metadata (6.0774ms)
  ✔ runtime entrypoints do not read the old shared config path (15.053ms)
  ✔ callback queues are scoped to the installation instance (7.2903ms)
  ✔ control environment writes instance metadata and an instance-scoped config (3.9917ms)
  ✔ installer launches the callback browser with its exact port and profile (4.0519ms)
  ✔ product keeps default 5 and supports opt-in 10, 11, and 20 (2.9415ms)
  ✔ requested and iteration limits remain bounded by the project (0.8412ms)
  ✔ generic runtime contains no production-specific hardcodes (49.7708ms)
  ✔ detects npm scripts without asking a user for commands (28.1429ms)
  ✔ detects Python tools conservatively (7.7875ms)
  ✔ does not invent commands for unknown projects (2.0498ms)
  ✔ generated instructions point orchestration issues to the control repository (5.7056ms)
  ✔ instructions renderer rejects unresolved configuration (0.8954ms)
  ✔ generated instructions require one-time explicit Chat registration (4.0275ms)
  ✔ submit-report refuses to upload without explicit consent (237.5352ms)
  ✔ legacy project routes are removed without changing other registry fields (23.9868ms)
  ✔ existing install upgrade retires origin discovery runtime (5.9412ms)
  ✔ new callback delivery has explicit state transitions (7.3584ms)
  ✔ redacts secret-key fields (4.5005ms)
  ✔ redacts token-shaped strings (0.8197ms)
  ✔ safe spawn never needs a shell for argument passing (130.926ms)
  ✔ core Node runtime contains no shell-true child process invocation (7.6083ms)
  ✔ Windows shim runner transports arguments as Base64 JSON instead of shell text (2.4307ms)
  ✔ control workflow queues multiple pending orchestration runs (4.8638ms)
  ℹ tests 81
  ℹ suites 0
  ℹ pass 81
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 34213.127

- validation workspace cleanliness: PASS

## Codex final summary

Implemented executor isolation fix.

Changed:

- Implementation now uses `-a never -s workspace-write`.
- Removed legacy approval/sandbox config variables.
- Preserved all isolation overrides and existing model/config/output behavior.
- Preflight now requires explicit sandbox capability.
- Review remains `-a never -s read-only` with exact-SHA behavior unchanged.
- Added regression coverage for isolation, capability failure, and persistent config mutation.

Validation:

- Focused tests: 4/4 PASS
- `git diff --check`: PASS
- Full suite: blocked by environment-wide Windows `spawn EPERM` before test execution
- Workspace contains only the three allowed modified files.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

