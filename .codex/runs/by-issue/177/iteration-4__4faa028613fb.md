# P1 failure outbox iteration 4/5 — immutable implementation checkpoint
- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- issue: 177
- review_route: chat-165
- source_branch: feat/macos-failure-outbox-core
- source_commit: 4faa028613fb592d54e2b4f685dc392937c983e9
- exact_parent_commit: 1bfa46c4dd8a1d7afe47a40c40dcd6864621dff8
- codex_model: gpt-5.6-luna
- codex_exit_code: 0
- result: VALIDATION_FAILED_NEW_INDEPENDENT_CASE

## Changed files
- runtime/scripts/report-run-failure.mjs
- src/lib/run-failure-state.mjs
- tests/run-failure-state.test.mjs

## Independent wrapper and probes
- node --check and git diff --check: PASS
- Mac Node v24.22.0 full suite: 117 total / 108 pass / 0 fail / 9 skipped.
- PENDING delivery script now uses fileURLToPath and test-only unreachable browser reaches the wake-chat code instead of module-not-found: PASS.
- Two-journal late-conflict preflight now leaves all previously existing files unchanged: PASS.
- Additional independent isolated crash injection: old persisted prepared journal for failure-demo-12-1 stage=preflight, no final record; a different stage=git for SAME callback_id attempted persistFailure and was accepted, overwriting and deleting the original journal rather than failing closed. This violates exactly-once identity protection and loses original failure provenance. PASS impossible. Next delta REVISE must check existing journal identity before writing or overwriting it.
- No live Chat browser or production instances involved. No merge or approval.
