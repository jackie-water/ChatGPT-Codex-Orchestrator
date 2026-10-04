<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-04T10:13:40Z
- source_branch: fix/callback-receipt-reconciliation
- source_commit: 82a003a81c53737d047aadd78e1bb28cfa349ea4
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261004T101340Z__fix-callback-receipt-reconciliation__82a003a81c53.md
- run_file: .codex/runs/by-issue/40/iteration-2__82a003a81c53.md
- orchestrator_issue: 40
- iteration: 2
- publisher: Codex-Orchestrator

---

## Objective

Fix #39 deterministic test defects and complete executable production state-file/retry coverage while preserving hard max 20.

## Result

Status: VALIDATION_FAILED

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 40
- iteration: 2
- max_iterations: 5
- project_iteration_limit: 5
- source_branch: fix/callback-receipt-reconciliation
- source_commit: 82a003a81c53737d047aadd78e1bb28cfa349ea4
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 55368
- prompt_chars: 4673
- prompt_limit: 6000
- wrapper_validation_steps: 2
- review_route: chat-27

## Changed files

- docs/E2E-ACCEPTANCE-v0.1.md
- runtime/scripts/callback-delivery.mjs
- runtime/scripts/callback-receipt.mjs
- runtime/scripts/preflight.ps1
- runtime/scripts/retry-pending-callbacks.ps1
- runtime/scripts/run-codex.ps1
- runtime/scripts/wake-chat.mjs
- runtime/scripts/wake-chat.ps1
- schemas/project.schema.json
- tests/callback-powershell.test.mjs
- tests/callback-reliability.test.mjs
- tests/chat-delivery.test.mjs
- tests/max-iterations.test.mjs
- tests/routing-migration.test.mjs

## Wrapper validation

- wrapper git diff --check: PASS
- full test suite: FAIL (exit 1)

  Output tail:
  rived values and has no reviewer fallback (1.2299ms)
  ✔ local paths and project keys are deterministic (1.3956ms)
  ✔ project registry can keep the real project disabled while sandbox is enabled (0.6515ms)
  ✔ dry-run reports the installation plan without enabling the real project (2831.2892ms)
  ✔ Windows guided installer handles every setup user action (6.0835ms)
  ✔ AI JSON mode remains non-interactive (1.3066ms)
  ✔ Chinese request stays Chinese (4.2102ms)
  ✔ English is default for unknown languages (2.5067ms)
  ✔ implementation callbacks point to immutable per-issue reports (4.8769ms)
  ✔ code review callbacks point to immutable by-commit evidence (1.4915ms)
  ✔ installer prepares only the sandbox before sandbox verification (5.8482ms)
  ✔ all remote execution entrypoints block disabled projects (3.6367ms)
  ✔ generated control registry disables the real project until activation (1.5371ms)
  ✔ setup requires ChatGPT access to generated private repos before Codex trust (1.14ms)
  ✔ sandbox Chat registration happens before sandbox CODEX-RUN (1.1689ms)
  ✔ real project Chat registration happens only after sandbox activation and before READY (1.1279ms)
  ✔ runtime context derives config and queues from instance metadata (2.4863ms)
  ✔ runtime entrypoints do not read the old shared config path (6.1342ms)
  ✔ callback queues are scoped to the installation instance (1.4522ms)
  ✔ control environment writes instance metadata and an instance-scoped config (1.1335ms)
  ✔ installer launches the callback browser with its exact port and profile (1.0005ms)
  ✔ product keeps default 5 and supports opt-in 10, 11, and 20 (2.7462ms)
  ✔ requested and iteration limits remain bounded by the project (0.9759ms)
  ✔ generic runtime contains no production-specific hardcodes (13.3812ms)
  ✔ detects npm scripts without asking a user for commands (28.6977ms)
  ✔ detects Python tools conservatively (11.2697ms)
  ✔ does not invent commands for unknown projects (2.2684ms)
  ✔ generated instructions point orchestration issues to the control repository (12.4722ms)
  ✔ instructions renderer rejects unresolved configuration (1.2592ms)
  ✔ generated instructions require one-time explicit Chat registration (2.5434ms)
  ✔ submit-report refuses to upload without explicit consent (188.7049ms)
  ✔ legacy project routes are removed without changing other registry fields (29.0342ms)
  ✔ existing install upgrade retires origin discovery runtime (8.0744ms)
  ✔ new callback delivery has explicit state transitions (5.1042ms)
  ✔ redacts secret-key fields (2.1352ms)
  ✔ redacts token-shaped strings (0.4585ms)
  ✔ safe spawn never needs a shell for argument passing (131.0121ms)
  ✔ core Node runtime contains no shell-true child process invocation (3.4462ms)
  ✔ Windows shim runner transports arguments as Base64 JSON instead of shell text (1.1394ms)
  ✔ control workflow queues multiple pending orchestration runs (2.8079ms)
  ℹ tests 61
  ℹ suites 0
  ℹ pass 60
  ℹ fail 1
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 14711.5902
  
  ✖ failing tests:
  
  test at tests\callback-powershell.test.mjs:47:1
  ✖ native callback mutexes isolate same and different instances and restore process environment (7227.7292ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    + actual - expected
    
    + Set(3) {
    - Set(2) {
        'parallel-a',
        'parallel-b',
    +   'same'
      }
    
        at TestContext.<anonymous> (file:///C:/Users/Jackie/ChatGPTCodexOrchestrator/dev-live-e2e-20261004/tests/callback-powershell.test.mjs:66:448)
        at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
        at async Test.run (node:internal/test_runner/test:1313:7)
        at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
      generatedMessage: true,
      code: 'ERR_ASSERTION',
      actual: Set(3) { 'same', 'parallel-a', 'parallel-b' },
      expected: Set(2) { 'parallel-a', 'parallel-b' },
      operator: 'deepStrictEqual',
      diff: 'simple'
    }

- Focused callback and iteration-limit validation: FAIL (exit 1)

  Output tail:
  ✔ native callback lifecycle uses isolated shipped PowerShell entrypoints (5358.9365ms)
  ✖ native callback mutexes isolate same and different instances and restore process environment (7986.3218ms)
  ✔ matcher requires literal callback id and complete normalized payload (3.2892ms)
  ✔ shipped extractor accepts both user layouts and canonicalizes one message once (7.9912ms)
  ✔ quoted, code, assistant, editable, and composer ancestry are rejected (2.3564ms)
  ✔ wrapper labels cannot claim a canonical receipt key before the payload (3.4764ms)
  ✔ receipt recognition is independent of DOM count and traversal order (6.0138ms)
  ✔ receipt recognition fails closed for changed navigation, late drafts, and invalid state (0.8412ms)
  ✔ shipped sender helpers keep mutation and send gates fail closed (3.0861ms)
  ✔ shipped callback entrypoints preserve the explicit route contract (3.5908ms)
  ✔ delivery matching rejects absent, quoted, assistant, and partial receipts (1.2861ms)
  ✔ product keeps default 5 and supports opt-in 10, 11, and 20 (3.1799ms)
  ✔ requested and iteration limits remain bounded by the project (1.1489ms)
  ✔ legacy project routes are removed without changing other registry fields (42.0641ms)
  ✔ existing install upgrade retires origin discovery runtime (4.1172ms)
  ✔ new callback delivery has explicit state transitions (6.6054ms)
  ℹ tests 16
  ℹ suites 0
  ℹ pass 15
  ℹ fail 1
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 13551.7492
  
  ✖ failing tests:
  
  test at tests\callback-powershell.test.mjs:47:1
  ✖ native callback mutexes isolate same and different instances and restore process environment (7986.3218ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    + actual - expected
    
    + Set(3) {
    - Set(2) {
        'parallel-a',
        'parallel-b',
    +   'same'
      }
    
        at TestContext.<anonymous> (file:///C:/Users/Jackie/ChatGPTCodexOrchestrator/dev-live-e2e-20261004/tests/callback-powershell.test.mjs:66:448)
        at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
        at async Test.run (node:internal/test_runner/test:1313:7)
        at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
      generatedMessage: true,
      code: 'ERR_ASSERTION',
      actual: Set(3) { 'same', 'parallel-a', 'parallel-b' },
      expected: Set(2) { 'parallel-a', 'parallel-b' },
      operator: 'deepStrictEqual',
      diff: 'simple'
    }

- validation workspace cleanliness: PASS

## Codex final summary

Implemented the requested delta on SHA `721865407683d8701884da72290e511cee5f9ffd`.

Changed only:

- `callback-delivery.mjs`
- `wake-chat.mjs`
- `callback-reliability.test.mjs`
- `callback-powershell.test.mjs`

Verified:

- HEAD unchanged.
- `git diff --check` passes.
- Node syntax/helper smoke checks pass.
- Hard-max implementation untouched.
- No dependencies, routes, deployment, or control files changed.
- Replaced wall-clock assertion with behavioral overlap markers and instance-isolation checks.

The configured Node suite could not run in this environment because child-process spawning returns `EPERM`; this is local Codex execution evidence, not wrapper-native evidence.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

