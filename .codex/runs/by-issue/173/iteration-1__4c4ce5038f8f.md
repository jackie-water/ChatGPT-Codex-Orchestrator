# Codex run evidence — orchestrator-dev issue 173 iteration 1/5
- project: orchestrator-dev
- repo: jackie-water/ChatGPT-Codex-Orchestrator
- issue: 173
- iteration: 1
- source_branch: feat/macos-failure-outbox-core
- source_commit: 4c4ce5038f8f43137e0dcce9472dfd1493dc143d
- parent_source_commit: c7d7f4b63d8f582dcb081caa406b1c11f1471f25
- review_route: chat-165
- codex_exit_code: 0
- status: VALIDATION_FAILED_INDEPENDENT_ADDITIONAL_CASES
- codex_model: gpt-5.6-luna
- codex_reasoning: low

## Changes
- runtime/scripts/report-run-failure.mjs
- src/lib/run-failure-state.mjs
- tests/run-failure-state.test.mjs
- docs/macos-failure-recovery.md

## Independent validation on connected MacBook
- Node.js v24.22.0 syntax checks: PASS
- npm test: PASS, 110 total, 101 passed, 0 failed, 9 skipped
- git diff --check: PASS
- Independent isolated failure injection: replaying IDENTICAL event after 1200 ms returns 'Conflicting failure payload' instead of idempotent reuse. Root cause: persistence compares volatile timestamp values nested inside state.
- Independent isolated recovery injection: if journal exists with PENDING state and existing callback state was DELIVERED with verified_by=committed-user-turn, recoverFailureOutbox overwrites DELIVERED with PENDING. This can trigger duplicate delivery or loss of terminal evidence.
- Additional code-inspection concerns to test: child delivery currently omits expected fingerprint; no durable separation between callback delivery transitions and failure intent on replay; no single-writer locking for concurrent failure writers. Test only with isolated fixtures and no browser/CDP.

## Chat decision
REVISE: two deterministic blocking reliability defects verified. Preserve exact route, original failure identity and source SHA. This checkpoint is review-only evidence; no merge authorized. Windows published version and main unchanged.
