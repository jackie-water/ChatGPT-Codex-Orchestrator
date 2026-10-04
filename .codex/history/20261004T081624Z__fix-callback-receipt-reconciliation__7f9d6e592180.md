<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-04T08:16:24Z
- source_branch: fix/callback-receipt-reconciliation
- source_commit: 7f9d6e592180e4d78c11d6ca14b6cd1146e78fff
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261004T081624Z__fix-callback-receipt-reconciliation__7f9d6e592180.md
- run_file: .codex/runs/by-issue/28/iteration-1__7f9d6e592180.md
- orchestrator_issue: 28
- iteration: 1
- publisher: Codex-Orchestrator

---

## Objective

Strict committed-user receipt matching and single-callback reconciliation; no blind resends after ambiguous submission.

## Result

Status: READY_FOR_REVIEW

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 28
- iteration: 1
- max_iterations: 5
- project_iteration_limit: 5
- source_branch: fix/callback-receipt-reconciliation
- source_commit: 7f9d6e592180e4d78c11d6ca14b6cd1146e78fff
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 44935
- prompt_chars: 5650
- prompt_limit: 12000
- wrapper_validation_steps: 1
- review_route: chat-27

## Changed files

- docs/E2E-ACCEPTANCE-v0.1.md
- runtime/scripts/callback-receipt.mjs
- runtime/scripts/retry-pending-callbacks.ps1
- runtime/scripts/wake-chat.mjs
- runtime/scripts/wake-chat.ps1
- tests/chat-delivery.test.mjs

## Wrapper validation

- wrapper git diff --check: PASS
- full test suite: PASS

  Output tail:
  > chatgpt-codex-orchestrator@0.1.0-dev test
  > node --test
  
  ✔ AI can save a repository answer without editing state by hand (210.3999ms)
  ✔ invalid repository answer is rejected (188.6573ms)
  ✔ callback delivery requires a committed user-role message (4.0004ms)
  ✔ existing callback id is considered delivered only in a user message (3.2532ms)
  ✔ receipt matcher is exact and whitespace tolerant (1.9423ms)
  ✔ queued callback delivery clears the native failure exit code (1.1557ms)
  ✔ all execution entrypoints require an active registered review_route (6.9896ms)
  ✔ Chat registration workflow exists and stores routes locally (4.1408ms)
  ✔ callback retry never discovers or falls back to another Chat (1.1548ms)
  ✔ browser sender requires an exact target conversation (0.952ms)
  ✔ old origin discovery runtime is retired (1.184ms)
  ✔ installer registration creates CHAT-REGISTER rather than origin markers (1.6824ms)
  ✔ project config keeps safe defaults and detected validation (4.8629ms)
  ✔ workflow only substitutes a validated runner label (1.1549ms)
  ✔ PowerShell config quotes user-derived values and has no reviewer fallback (1.2486ms)
  ✔ local paths and project keys are deterministic (2.2209ms)
  ✔ project registry can keep the real project disabled while sandbox is enabled (0.8138ms)
  ✔ dry-run reports the installation plan without enabling the real project (3563.7157ms)
  ✔ Windows guided installer handles every setup user action (9.2169ms)
  ✔ AI JSON mode remains non-interactive (3.5926ms)
  ✔ Chinese request stays Chinese (3.7345ms)
  ✔ English is default for unknown languages (2.3866ms)
  ✔ implementation callbacks point to immutable per-issue reports (4.7181ms)
  ✔ code review callbacks point to immutable by-commit evidence (1.7526ms)
  ✔ installer prepares only the sandbox before sandbox verification (4.8104ms)
  ✔ all remote execution entrypoints block disabled projects (2.9605ms)
  ✔ generated control registry disables the real project until activation (1.343ms)
  ✔ setup requires ChatGPT access to generated private repos before Codex trust (0.9831ms)
  ✔ sandbox Chat registration happens before sandbox CODEX-RUN (1.2286ms)
  ✔ real project Chat registration happens only after sandbox activation and before READY (1.1662ms)
  ✔ runtime context derives config and queues from instance metadata (5.2763ms)
  ✔ runtime entrypoints do not read the old shared config path (5.37ms)
  ✔ callback queues are scoped to the installation instance (1.0835ms)
  ✔ control environment writes instance metadata and an instance-scoped config (0.8667ms)
  ✔ installer launches the callback browser with its exact port and profile (1.0079ms)
  ✔ generic runtime contains no production-specific hardcodes (16.432ms)
  ✔ detects npm scripts without asking a user for commands (26.0118ms)
  ✔ detects Python tools conservatively (6.835ms)
  ✔ does not invent commands for unknown projects (2.2499ms)
  ✔ generated instructions point orchestration issues to the control repository (5.8064ms)
  ✔ instructions renderer rejects unresolved configuration (0.904ms)
  ✔ generated instructions require one-time explicit Chat registration (4.5715ms)
  ✔ submit-report refuses to upload without explicit consent (235.0432ms)
  ✔ legacy project routes are removed without changing other registry fields (22.076ms)
  ✔ existing install upgrade retires origin discovery runtime (2.4464ms)
  ✔ new callback delivery has explicit state transitions (1.5748ms)
  ✔ redacts secret-key fields (3.0747ms)
  ✔ redacts token-shaped strings (0.7059ms)
  ✔ safe spawn never needs a shell for argument passing (220.3636ms)
  ✔ core Node runtime contains no shell-true child process invocation (3.5224ms)
  ✔ Windows shim runner transports arguments as Base64 JSON instead of shell text (1.128ms)
  ✔ control workflow queues multiple pending orchestration runs (6.9285ms)
  ℹ tests 52
  ℹ suites 0
  ℹ pass 52
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 4043.2143

- validation workspace cleanliness: PASS

## Codex final summary

Implemented on `fix/callback-receipt-reconciliation` at expected SHA `b2659b7...`.

Changes include:

- Exact callback header/full-payload receipt matcher.
- False-positive protections for references, assistant text, drafts, collisions, and mixed ancestors.
- Receipt confirmation independent of node count or message position.
- Destination rechecks before input and submission.
- DEV-only `-CallbackId <id> -ReconcileOnly` flow with `DELIVERED`, `PENDING`, `NOT_FOUND`, and `ERROR`.
- Regression matcher tests and scoped documentation.

Routine validation was not run, per instruction. Full orchestration/state/concurrency regression coverage and live browser verification remain for the wrapper.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

