# Codex run evidence: orchestrator-dev issue 168 iteration 3/5
- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- orchestrator_issue: 168
- iteration: 3
- source_branch: feat/macos-runner-failure-callbacks
- source_commit: 4a0962aed9afa70cf31e8920801b4efb0642a7c6
- review_route: chat-165
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- status: VALIDATION_FAILED_TEST_ISOLATION

## Execution provenance
One-time macOS isolated bootstrap Codex CLI from exact prior SHA 3f52e38f1e033c032dd7f327d1c2c14d8ff2397f. Legacy Windows Actions job 38686650890 was cancelled before local execution.

## Changed files
- runtime/scripts/register-chat.mjs
- tests/macos-register-chat.test.mjs
- docs/macos-native-bootstrap.md

## Independent wrapper validation
- node --check registration script and native tests: PASS
- git diff --check: PASS
- npm test macOS Node 24: FAIL (105 total, 95 pass, 1 fail, 9 skipped).
- Failure: pending failed delivery remains queued; expected PENDING, actual SUBMISSION_ATTEMPTED. Test mistakenly inherited actual Chrome CDP port 9333 from live environment, created a fake test Chat tab in authenticated browser, and entered ambiguous submission state. The exact fake tab /c/chat-165 was closed. No callback receipt was confirmed for the fake tab. Pinned real project Chat and route remained unchanged.
- Correct safety interpretation: once a send may have been attempted, preserve SUBMISSION_ATTEMPTED, never forcibly downgrade it to PENDING. Test must force isolated unreachable browser port and exercise failure before any send; it must never use authenticated browser/real CDP.
- Real replay of the previously verified registered callback #165 with native --deliver: PASS with CHAT_ROUTE_ALREADY_DELIVERED and no resend; outbox remains DELIVERED verified_by=committed-user-turn.
- Reviewer determination: REVISE the test isolation only; do not merge.
