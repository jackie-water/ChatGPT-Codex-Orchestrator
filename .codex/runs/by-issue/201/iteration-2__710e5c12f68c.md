# P2.2b.1 Mac Codex executor — Issue 201 iteration 2/5
project: orchestrator-dev
source_repo: jackie-water/ChatGPT-Codex-Orchestrator
source_branch: feat/macos-execution-lifecycle
exact_source_commit: 710e5c12f68c785144255a66cde29dd99721d59c
parent_source_commit: 2e64e27587ab4adef5904e00f46a72c13003c526
reviewed_stacked_base: b435f9620bd8235fb19ee2f424af10aa6ce34962
review_route: chat-165
Codex_exit_code: 0
Chat_implementation_review: READY_FOR_INDEPENDENT_CODE_REVIEW
merge_approval: NOT_GRANTED

Changes: src/lib/macos-codex-execution.mjs; src/lib/macos-codex-run-contract.mjs; tests/macos-codex-execution.test.mjs; docs/macos-codex-execution.md.
Existing CLI runtime/scripts/macos-execute-codex.mjs from first task SHA remains in diff for work package.

External wrapper validation on Mac arm64 Node v24.22.0:
- Full suite node --test tests/*.test.mjs: 150 total / 141 pass / 0 fail / 9 expected Windows skips.
- Focused new Mac execution suite: 4 tests pass / 0 fail, using disposable bare Git remote/clone and fake Codex executable only.
- Node syntax checks and git diff --check: PASS.
- Clean source worktree and exact commit pushed to isolated task branch.
- The first candidate had NO focused execution tests and used git symbolic-ref on a normal remote tracking branch; this revised candidate uses git rev-parse on an actual commit and fixture tests success, source-less P1 terminal failure, timeout, clone origin/dirty state, and exact ledger duplicate suppression.

Safety boundaries still outstanding:
- This package only runs a local CodeX subprocess in an isolated clone and persists EXECUTED_UNVALIDATED, or a source-commit-less durable P1 failure callback; it does NOT implement wrapper validation, source publishing, immutable success report or actual Chat delivery yet.
- Exact source independent read-only Code Review required before PASS.
- No Windows runner, main, real target repo, merge or production browser changed.