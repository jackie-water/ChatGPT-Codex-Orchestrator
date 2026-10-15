# Codex implementation evidence — orchestrator-dev issue #180, iteration 6/6

## Exact identity
- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- control_issue: 180
- iteration: 6
- authorized_one_time_override: user explicitly approved one extra P1.1 correction; unrelated tasks remain at max 5
- source_branch: feat/macos-failure-outbox-core
- source_commit: deaf6c62a063caf636bb3aef83fb45994e7dc7df
- prior_reviewed_commit: 34381dfcc482723b358f3e7c4f0f23b29f7bdbbd
- review_route: chat-165
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- validation_status: PASS_LOCALLY_READY_FOR_INDEPENDENT_REVIEW
- merge_approval: NOT_GRANTED

## Execution provenance
Control Issue #180 was created once on the registered project and pinned review route. The old Windows-specific Actions workflow 38708023813 was cancelled with conclusion=cancelled before local Mac Codex CLI execution to prevent duplicate work. User authorized this exact sixth revision only. The default Control project maximum remains 5. No Windows runner, priceup, clean-energy or other production infrastructure used.

## Allowed changed files
- src/lib/run-failure-state.mjs
- tests/run-failure-state.test.mjs

## Deterministic original finding
Failure outbox lacked top-level routing_version='explicit-route-v1'. The shipped production callback-delivery.mjs validateCallbackState requires it, so a fresh PENDING failure callback was rejected before delivery. Source finding report: checkpoint 1ad06fd70d3f98cb6464885d717b75cf4fcf53d2, .codex/reviews/by-commit/34381dfcc482723b358f3e7c4f0f23b29f7bdbbd.md.

## Independent wrapper validation on MacBook Air arm64 / Node 24.22.0
- node --check on both changed JavaScript files: PASS
- git diff --check: PASS
- node --test tests/*.test.mjs: 120 total, 111 PASS, 0 FAIL, 9 expected platform SKIP
- Imported exact production validateCallbackState and createCallbackStateStore: both accept the freshly persisted failure record under the exact callback_id/chat_url/message contract: PASS
- Isolated journal reconstruction retains routing_version and passes same production validator/store: PASS
- Legacy terminal DELIVERED with verified_by='committed-user-turn' and missing routing_version replay upgraded only the absent field, preserving terminal delivery proof: PASS
- Explicitly incompatible routing_version rejected: PASS
- No live Chat/browser/CDP activity in tests, no real target activation.

## Boundaries
This is P1.1 failure outbox core, not the full Mac runner or independent watchdog. Fresh, user-role end-to-end failed Codex-run delivery cannot be claimed until P2/P4/P5 integration. Independent read-only Code Review and GitHub cross-platform CI must be checked on this exact SHA before Chat PASS. PASS would be review-only, never merge permission.
