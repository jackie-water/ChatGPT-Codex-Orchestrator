# P2.2a macOS preflight candidate — issue 186 iteration 2/5

- project: orchestrator-dev
- source_repo: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-native-codex-executor
- source_commit: fc4301e2c4b9246fe877d2e03945876f4698c88a
- source_parent: 78ae59f2f2b20d43226e385221e9bf0fa1ff6963
- stacked_base: 5d469eaac5e687eb0f279800061aebd5ff31c838
- control_issue: 186
- iteration: 2
- max_iterations: 5
- originating_review_route: chat-165
- Codex_exit_code: 0
- verdict: READY_FOR_INDEPENDENT_CODE_REVIEW
- merge_approved: false

## Scoped changes
- src/lib/macos-codex-run-contract.mjs
- tests/macos-codex-run-contract.test.mjs

## Wrapper results
- macOS arm64 Node v24.22.0 full suite: 135 tests / 126 passed / 0 failed / 9 platform-skipped.
- npm/Node P2.2a focused suite: 10 tests passed.
- node --check both changed modules: PASS.
- git diff --check: PASS.
- Source branch clean and pushed, exact SHA preserved.

## Prior independent fault and correction
Issue 185 originally allowed planMacosCodexRun to emit an executable plan after an exact same project/issue/iteration TERMINAL_FAILURE was already durably persisted in failure-outbox. This could cause a second Codex run after callback failure. Issue 186 now includes failure-outbox records and prepared journals in duplicate checks, rejects uncertain/invalid state, and isolates unrelated valid records. Isolated fixture tests cover PENDING terminal failure, prepared journal and malformed data. Existing normal plan-only mode remains non-executing and does not deliver browser callbacks.

## Outstanding
- New exact-SHA independent read-only Codex Code Review required.
- GitHub cross-platform CI for this SHA not yet verified at checkpoint creation.
- This is P2.2a gate only: no Codex subprocess execution, wrapper validation, immutable implementation publishing, watchdog or Mac installer is implemented yet.
- Windows main and v0.1.0 remain unchanged; no real target activation or merge approved.
