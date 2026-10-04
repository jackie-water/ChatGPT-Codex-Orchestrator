<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-04T09:35:39Z
- source_branch: fix/callback-receipt-reconciliation
- source_commit: e88dffc95002b4936c8c3bed0e3b9d2f88112ab6
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261004T093539Z__fix-callback-receipt-reconciliation__e88dffc95002.md
- run_file: .codex/runs/by-issue/36/iteration-8__e88dffc95002.md
- orchestrator_issue: 36
- iteration: 8
- publisher: Codex-Orchestrator

---

## Objective

Correct NOT_FOUND test semantics and complete executable callback reliability coverage; change runtime only for test-proven defects.

## Result

Status: READY_FOR_REVIEW

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 36
- iteration: 8
- max_iterations: 8
- project_iteration_limit: 8
- source_branch: fix/callback-receipt-reconciliation
- source_commit: e88dffc95002b4936c8c3bed0e3b9d2f88112ab6
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 27298
- prompt_chars: 5466
- prompt_limit: 6000
- wrapper_validation_steps: 2
- review_route: chat-27

## Changed files

- docs/E2E-ACCEPTANCE-v0.1.md
- runtime/scripts/callback-receipt.mjs
- runtime/scripts/retry-pending-callbacks.ps1
- runtime/scripts/wake-chat.mjs
- runtime/scripts/wake-chat.ps1
- tests/callback-powershell.test.mjs
- tests/callback-reliability.test.mjs
- tests/chat-delivery.test.mjs
- tests/routing-migration.test.mjs

## Wrapper validation

- wrapper git diff --check: PASS
- full test suite: PASS

  Output tail:
   (13.6019ms)
  ✔ quoted, code, assistant, editable, and composer ancestry are rejected (3.0599ms)
  ✔ wrapper labels cannot claim a canonical receipt key before the payload (4.017ms)
  ✔ receipt recognition is independent of DOM count and traversal order (8.3378ms)
  ✔ receipt recognition fails closed for changed navigation, late drafts, and invalid state (0.674ms)
  ✔ shipped callback entrypoints preserve the explicit route contract (19.8481ms)
  ✔ delivery matching rejects absent, quoted, assistant, and partial receipts (2.6257ms)
  ✔ all execution entrypoints require an active registered review_route (10.908ms)
  ✔ Chat registration workflow exists and stores routes locally (5.3139ms)
  ✔ callback retry never discovers or falls back to another Chat (1.4589ms)
  ✔ browser sender requires an exact target conversation (1.4393ms)
  ✔ old origin discovery runtime is retired (1.803ms)
  ✔ installer registration creates CHAT-REGISTER rather than origin markers (1.1861ms)
  ✔ project config keeps safe defaults and detected validation (6.9839ms)
  ✔ workflow only substitutes a validated runner label (2.2742ms)
  ✔ PowerShell config quotes user-derived values and has no reviewer fallback (1.3506ms)
  ✔ local paths and project keys are deterministic (1.7633ms)
  ✔ project registry can keep the real project disabled while sandbox is enabled (0.8044ms)
  ✔ dry-run reports the installation plan without enabling the real project (4798.8132ms)
  ✔ Windows guided installer handles every setup user action (10.1722ms)
  ✔ AI JSON mode remains non-interactive (3.0591ms)
  ✔ Chinese request stays Chinese (4.5677ms)
  ✔ English is default for unknown languages (4.0883ms)
  ✔ implementation callbacks point to immutable per-issue reports (6.0863ms)
  ✔ code review callbacks point to immutable by-commit evidence (2.4021ms)
  ✔ installer prepares only the sandbox before sandbox verification (8.2412ms)
  ✔ all remote execution entrypoints block disabled projects (4.6926ms)
  ✔ generated control registry disables the real project until activation (2.2917ms)
  ✔ setup requires ChatGPT access to generated private repos before Codex trust (1.5295ms)
  ✔ sandbox Chat registration happens before sandbox CODEX-RUN (1.5649ms)
  ✔ real project Chat registration happens only after sandbox activation and before READY (1.5263ms)
  ✔ runtime context derives config and queues from instance metadata (6.8199ms)
  ✔ runtime entrypoints do not read the old shared config path (7.201ms)
  ✔ callback queues are scoped to the installation instance (1.6141ms)
  ✔ control environment writes instance metadata and an instance-scoped config (1.7301ms)
  ✔ installer launches the callback browser with its exact port and profile (1.511ms)
  ✔ generic runtime contains no production-specific hardcodes (22.7656ms)
  ✔ detects npm scripts without asking a user for commands (15.8242ms)
  ✔ detects Python tools conservatively (18.5328ms)
  ✔ does not invent commands for unknown projects (5.9788ms)
  ✔ generated instructions point orchestration issues to the control repository (8.4614ms)
  ✔ instructions renderer rejects unresolved configuration (1.1213ms)
  ✔ generated instructions require one-time explicit Chat registration (5.898ms)
  ✔ submit-report refuses to upload without explicit consent (504.2326ms)
  ✔ legacy project routes are removed without changing other registry fields (95.6996ms)
  ✔ existing install upgrade retires origin discovery runtime (7.7185ms)
  ✔ new callback delivery has explicit state transitions (20.0603ms)
  ✔ redacts secret-key fields (13.6989ms)
  ✔ redacts token-shaped strings (2.2485ms)
  ✔ safe spawn never needs a shell for argument passing (180.6239ms)
  ✔ core Node runtime contains no shell-true child process invocation (4.0158ms)
  ✔ Windows shim runner transports arguments as Base64 JSON instead of shell text (1.2971ms)
  ✔ control workflow queues multiple pending orchestration runs (22.8385ms)
  ℹ tests 57
  ℹ suites 0
  ℹ pass 57
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 13587.696

- Focused callback reliability, PowerShell and routing migration: PASS

  Output tail:
  ✔ native callback lifecycle uses isolated shipped PowerShell entrypoints (13356.9772ms)
  ✔ matcher requires literal callback id and complete normalized payload (9.7734ms)
  ✔ shipped extractor accepts both user layouts and canonicalizes one message once (9.432ms)
  ✔ quoted, code, assistant, editable, and composer ancestry are rejected (3.0615ms)
  ✔ wrapper labels cannot claim a canonical receipt key before the payload (3.3536ms)
  ✔ receipt recognition is independent of DOM count and traversal order (5.6926ms)
  ✔ receipt recognition fails closed for changed navigation, late drafts, and invalid state (0.6421ms)
  ✔ legacy project routes are removed without changing other registry fields (56.1086ms)
  ✔ existing install upgrade retires origin discovery runtime (3.9471ms)
  ✔ new callback delivery has explicit state transitions (7.5287ms)
  ℹ tests 10
  ℹ suites 0
  ℹ pass 10
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 13824.5965

- validation workspace cleanliness: PASS

## Codex final summary

Implemented only allowed test changes:

- Fixed repeated reconcile contract: exit `4`, `NOT_FOUND`, no delivery, no record.
- Added executable receipt count/order and fail-closed matcher coverage.
- No runtime changes.

Validation:

- `node --check`: passed.
- `git diff --check`: passed.
- Focused/full tests blocked by environment `spawn EPERM` before test execution.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

