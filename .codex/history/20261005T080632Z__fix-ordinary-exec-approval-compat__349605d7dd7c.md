<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-05T08:06:32Z
- source_branch: fix/ordinary-exec-approval-compat
- source_commit: 349605d7dd7c93701b0e1761ec82434f2fabc869
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261005T080632Z__fix-ordinary-exec-approval-compat__349605d7dd7c.md
- run_file: .codex/runs/by-issue/90/iteration-1__349605d7dd7c.md
- orchestrator_issue: 90
- iteration: 1
- publisher: Codex-Orchestrator

---

## Objective

Remove unsupported ordinary exec approval CLI flag while preserving explicit workspace-write sandbox and executor isolation.

## Result

Status: READY_FOR_REVIEW

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 90
- iteration: 1
- max_iterations: 5
- project_iteration_limit: 5
- source_branch: fix/ordinary-exec-approval-compat
- source_commit: 349605d7dd7c93701b0e1761ec82434f2fabc869
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 36240
- prompt_chars: 2557
- prompt_limit: 12000
- wrapper_validation_steps: 1
- review_route: chat-27

## Changed files

- runtime/scripts/run-codex.ps1
- tests/codex-executor-isolation.test.mjs

## Wrapper validation

- wrapper git diff --check: PASS
- full test suite: PASS

  Output tail:
  ing copy of 'scripts/run-codex.ps1', LF will be replaced by CRLF the next time Git touches it
  To C:\Users\Jackie\AppData\Local\Temp\orchestrator-retry-wXAOzE\remote.git
     83ff6d1..0c0471b  HEAD -> main
  warning: in the working copy of 'scripts/unrelated.mjs', LF will be replaced by CRLF the next time Git touches it
  To C:\Users\Jackie\AppData\Local\Temp\orchestrator-staged-eeMdUV\remote.git
   * [new branch]      main -> main
  warning: in the working copy of 'scripts/unrelated.mjs', LF will be replaced by CRLF the next time Git touches it
  ✔ runtime refresh accepts exact GitHub HTTPS and SSH remotes (3.211ms)
  ✔ runtime refresh validates fetch and every explicit push URL before mutation (65.879ms)
  ✔ runtime refresh preserves mature control state and is idempotent (5824.459ms)
  ✔ runtime refresh rolls back a committed refresh when push fails and retries (5003.9569ms)
  ✔ runtime refresh rejects every remote-main mismatch before mutation (7.0852ms)
  ✔ runtime refresh rejects pre-staged changes before copying (2453.2349ms)
  ✔ runtime refresh rejects missing or mismatched control identity before mutation (656.4428ms)
  ✔ dry-run reports the installation plan without enabling the real project (3548.0204ms)
  ✔ Windows guided installer handles every setup user action (5.9519ms)
  ✔ AI JSON mode remains non-interactive (1.7985ms)
  ✔ Chinese request stays Chinese (6.6315ms)
  ✔ English is default for unknown languages (1.7165ms)
  ✔ runtime refresh messages and error catalog stay covered (0.6803ms)
  ✔ implementation callbacks point to immutable per-issue reports (3.5999ms)
  ✔ code review callbacks point to immutable by-commit evidence (2.5311ms)
  ✔ installer prepares only the sandbox before sandbox verification (5.5082ms)
  ✔ all remote execution entrypoints block disabled projects (7.4061ms)
  ✔ generated control registry disables the real project until activation (1.4328ms)
  ✔ setup requires ChatGPT access to generated private repos before Codex trust (1.1756ms)
  ✔ sandbox Chat registration happens before sandbox CODEX-RUN (1.196ms)
  ✔ real project Chat registration happens only after sandbox activation and before READY (1.2074ms)
  ✔ runtime context derives config and queues from instance metadata (4.9781ms)
  ✔ runtime entrypoints do not read the old shared config path (14.4157ms)
  ✔ callback queues are scoped to the installation instance (2.594ms)
  ✔ control environment writes instance metadata and an instance-scoped config (0.7143ms)
  ✔ installer launches the callback browser with its exact port and profile (0.7754ms)
  ✔ product keeps default 5 and supports opt-in 10, 11, and 20 (1.5917ms)
  ✔ requested and iteration limits remain bounded by the project (0.5418ms)
  ✔ generic runtime contains no production-specific hardcodes (31.258ms)
  ✔ detects npm scripts without asking a user for commands (8.1847ms)
  ✔ detects Python tools conservatively (9.8121ms)
  ✔ does not invent commands for unknown projects (2.4408ms)
  ✔ generated instructions point orchestration issues to the control repository (17.4988ms)
  ✔ instructions renderer rejects unresolved configuration (0.9504ms)
  ✔ generated instructions require one-time explicit Chat registration (15.6638ms)
  ✔ submit-report refuses to upload without explicit consent (185.4011ms)
  ✔ legacy project routes are removed without changing other registry fields (16.3517ms)
  ✔ existing install upgrade retires origin discovery runtime (4.4058ms)
  ✔ new callback delivery has explicit state transitions (11.602ms)
  ✔ redacts secret-key fields (2.2664ms)
  ✔ redacts token-shaped strings (0.4864ms)
  ✔ safe spawn never needs a shell for argument passing (140.1861ms)
  ✔ core Node runtime contains no shell-true child process invocation (3.622ms)
  ✔ Windows shim runner transports arguments as Base64 JSON instead of shell text (1.1728ms)
  ✔ control workflow queues multiple pending orchestration runs (3.2796ms)
  ℹ tests 81
  ℹ suites 0
  ℹ pass 81
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 32135.8248

- validation workspace cleanliness: PASS

## Codex final summary

Implemented the CLI compatibility fix.

- Removed `-a never` from ordinary implementation execution.
- Kept `-s workspace-write` and all isolation settings.
- Updated executor-isolation assertions.
- Review and preflight scripts unchanged.

Validation:
- Focused tests: PASS (4/4)
- Full suite: blocked by environment `EPERM` child-process spawning; 69 passed, 12 failed
- `git diff --check`: PASS
- Workspace contains only the two intended modified files.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

