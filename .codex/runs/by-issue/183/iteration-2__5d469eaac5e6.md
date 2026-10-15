# P2.1 Control event adapter — implementation Issue #183 iteration 2/5

## Identity
- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-native-control-dispatch
- source_commit: 5d469eaac5e687eb0f279800061aebd5ff31c838
- previous_source_commit: 4b9e9a3d269fefb0947d4544b03500bbc3876383
- parent_P1_reviewed_commit: deaf6c62a063caf636bb3aef83fb45994e7dc7df
- review_route: chat-165
- implementation_issue: 183
- iteration: 2/5
- codex_model: gpt-5.6-luna
- codex_exit_code: 0 (including two same-session acceptance/test corrections)
- status: READY_FOR_INDEPENDENT_CODE_REVIEW
- merge_approval: NOT_GRANTED

## Changed files
- src/lib/control-event-normalizer.mjs
- runtime/scripts/normalize-control-event.mjs
- tests/control-event-normalizer.test.mjs
- docs/macos-control-event-contract.md

## Independent wrapper evidence on MacBook Air arm64, Node 24.22.0
- node --check for all three JS sources: PASS
- git diff --check: PASS
- node --test tests/*.test.mjs: PASS, 125 total / 116 passed / 0 failed / 9 expected Windows-only skipped
- Isolated CLI real Control Issue #180 body and user from GitHub, exact Control repo origin, private temp HOME and Control/project/route fixtures: Mac CLI normalize-control-event.mjs output created safely, repeated unchanged event idempotent; normalized event accepted by P1 prepareFailure with registry-authorized source repository. NO live config or browser was modified.
- Control provenance (original repository/issue/author/digest) kept separate from minimal synthetic source event.
- Source repository is strictly derived from local configured enabled project; exact project-active review_route required. Untrusted body-provided chat_url rejected, trusted usernames require explicit nonempty array.
- CLI output restricted to private instance normalized-control-events under private HOME. Existing different file fails closed with no overwrite, symlink/insecure directory rejected, hard-link commit avoids replacing concurrent output. No chmod of unrelated parent directories. Tests cover repeat and conflicts.
- No macOS runner or LaunchAgent installed and no full system E2E claimed.
- Previous task branch and Windows v0.1.0 remain unmodified; no merge or deployment.

## Next gate
Independent read-only Codex Code Review must assess this same SHA, GitHub CI must be checked on this SHA, and Chat adjudicates. PASS would be review-only and would not authorize merge.
