# P2.2a preflight Codex implementation evidence — issue 185, iteration 1/5

- project: orchestrator-dev
- control_issue: 185
- source_repository: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-native-codex-executor
- source_commit: 78ae59f2f2b20d43226e385221e9bf0fa1ff6963
- source_base: 5d469eaac5e687eb0f279800061aebd5ff31c838
- review_route: chat-165
- status: VALIDATION_FAILED
- disposition: REVISE
- merge_approved: false

## Implemented surfaces
- src/lib/macos-codex-run-contract.mjs
- runtime/scripts/macos-run-codex.mjs
- tests/macos-codex-run-contract.test.mjs
- docs/macos-codex-preflight.md

## Independent wrapper validation
- Mac arm64 Node v24.22.0: 9 focused P2 preflight tests PASS.
- Full Mac test suite: 134 total, 125 PASS, 0 FAIL, 9 platform-skipped.
- git diff --check on base..source: PASS.
- Exact source git worktree clean; base and source commit SHA verified.

## Extra independent isolated fault injection
An authorized Control CODEX-RUN event for project demo, issue 99, iteration 1 was validated, then P2 preflight failure was durably recorded via recordMacosPreflightFailure, with source SHA unavailable and execution_state=TERMINAL_FAILURE, callback delivery=PENDING.
Running planMacosCodexRun AGAIN with the SAME event returned a valid plan with run_id=codex-demo-99-1 rather than rejecting the known existing terminal failure. duplicateState only inspects codex-runs, run-state, and runs but omits failure-outbox / outstanding failure-intent journals. This can permit P2.2b to launch another Codex run for an already terminal task, violating exact issue+iteration idempotency.

## Required deterministic REVISE
Before returning an executable plan, under the same instance and project scope, check durable failure-outbox records and journals for the identical project+issue+iteration; fail closed for existing terminal or uncertain failure state (including conflicting/malformed/symlink files). Treat a prior PENDING/DRAFT_INSERTED/SUBMISSION_ATTEMPTED/DELIVERED callback as a communication state, not authorization to rerun implementation. Add isolated tests that first persist a failure and then assert planning cannot authorize a second run. Preserve exact chat-165 routing and existing Windows behavior.

## Safety
No implementation merge, production target activation, browser send, live runner installation, or source-main modification authorized. This checkpoint exists only as immutable run evidence.
