# Implementation evidence orchestrator-dev issue 174 iteration 2/5
- project: orchestrator-dev
- source_branch: feat/macos-failure-outbox-core
- source_commit: 61d4640fd91931379470525c264371aaa3288931
- reviewed_parent_source: 4c4ce5038f8f43137e0dcce9472dfd1493dc143d
- review_route: chat-165
- codex_model: gpt-5.6-luna; reasoning: low
- codex_exit_code: 0
- status: VALIDATION_FAILED_REAL_REPLAY

## Changed files
- src/lib/run-failure-state.mjs
- runtime/scripts/report-run-failure.mjs
- tests/run-failure-state.test.mjs
- docs/macos-failure-recovery.md

## Independent wrapper and injection results
- node --check for all three JS files: PASS
- git diff --check: PASS
- node --test Mac arm64 v24.22.0: PASS, 112 total, 103 pass, 0 fail, 9 skipped.
- Independent temp instance: repeated new-instance failure reports separated in time no longer reject idempotent replay; journal recovery correctly preserves existing DELIVERED verified_by=committed-user-turn; both PASS.
- Additional independent temp instance, same exact failure with root delivery_state=DELIVERED, verified_by=committed-user-turn but nested callback.delivery_state=PENDING: native report-run-failure.mjs --deliver exited 1 with 'Failure recorded; delivery was not verified', despite previously proven terminal state; no Chat/browser used (CDP port 0). State remained DELIVERED. Cause: CLI always attempts browser reconciliation and reads stale nested callback delivery_state. Similar to previously fixed P0 registration virtualization issue. REVISE required to reuse trusted terminal proof without resending, derive mode/output from canonical top-level state, and fail closed on unverifiable DELIVERED.
- No P1 independent Code Review yet. No merger/deployment allowed.
