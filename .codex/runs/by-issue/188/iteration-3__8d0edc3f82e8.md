# P2.2a iteration 3/5 implementation evidence (orchestrator-dev)

- project: orchestrator-dev
- control_issue: 188
- source_repo: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-native-codex-executor
- source_commit: 8d0edc3f82e803ec69808c05f3bcb76474419be9
- exact_previous_commit: fc4301e2c4b9246fe877d2e03945876f4698c88a
- stacked_base: 5d469eaac5e687eb0f279800061aebd5ff31c838
- review_route: chat-165
- Codex_exec_exit: 0
- wrapper_validation: PASS
- independent_code_review: PENDING
- merge_authorization: NONE

## Changed files
- src/lib/macos-codex-run-contract.mjs
- tests/macos-codex-run-contract.test.mjs

## Wrapper evidence (MacBook arm64, Node v24.22.0)
- Full Node tests: 137 total, 128 passed, 0 failed, 9 platform-skipped.
- Node syntax checks on changed source/test: PASS.
- git diff --check: PASS.
- Exact source branch committed, pushed and working tree clean.

## Delta / deterministic findings addressed
- Reject symlinked or non-directory paths for each instance run-state, codex-runs, runs, failure-outbox directory before traversal; preserve individual record validation and fail closed on uncertain state.
- Reject invalid configured max_iterations outside integer 1..20, as required by schemas/project.schema.json; preserve valid within-bound approval and prompt limits.
- Regression tests cover symlinked directories, existing terminal failures and max iterations 20 versus 21/30.
- The same project/issue/iteration previously failed preflight cannot authorize another implementation run based on a pending callback; confirmed via prior isolated fault injection + regression suite.

## Next
- Independent read-only Code Review must inspect this exact SHA; previous review of fc4301e2 is not valid for changed source.
- No real Codex execution runner, immutable implementation publishing, failure watchdog or macOS installer has been integrated yet. This is a preflight-only milestone.
- Do not merge, deploy, activate real targets, or infer approval.
