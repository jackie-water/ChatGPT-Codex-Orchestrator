# Immutable implementation evidence — P2.2a user-approved iteration 7/7

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- control_issue: 196
- human_authorization: one extra P2.2a iteration 7/7 explicitly approved in originating Chat
- project_configured_max_iterations: 5 (unchanged)
- exact_review_route: chat-165
- source_branch: feat/macos-native-codex-executor
- exact_source_commit: cd1ddd8a978ba54abcc850c54e4f48dc74992fe4
- reviewed_parent_commit: 95775f779583498004bc592d94dd91de89ce9ea9
- stacked_base: 5d469eaac5e687eb0f279800061aebd5ff31c838
- implementation_model: gpt-5.6-luna, low reasoning
- implementation_exit: 0; additional same-session delta corrected partial prompt-limit configuration with no new iteration
- implementation_status: READY_FOR_REVIEW
- merge_approved: NO

## Scope and change list
- src/lib/macos-codex-run-contract.mjs
- tests/macos-codex-run-contract.test.mjs
No Windows scripts, default branch, protected branch, private runner state or real project modified.

## Deterministic issue fixed
The Mac preflight accepted invalid prompt_limits configuration that Windows runtime/scripts/preflight.ps1 rejects. Configured values now must both be integers >=1000 and revise_max_chars <= initial_max_chars. An absent or null prompt_limits object continues to use default 12000 initial / 6000 revise. If prompt_limits is non-null, it must be a plain object with BOTH limit keys; empty/partial/malformed object is rejected rather than silently filled with defaults. All effective hard caps, prompt selection, registered Chat and validation gates remain unchanged.

## Independent wrapper evidence on MacBook arm64 (Node v24.22.0)
- Full Node tests: 144 total, 135 PASS / 0 FAIL / 9 platform-skipped.
- Syntax checks on both changed JS files: PASS.
- git diff --check: PASS.
- All changed files within request allowlist, source branch clean after committing and pushing.
- The original two invalid-limit fixtures (initial=1/revise=1000, initial=2000/revise=2500) are rejected; further independent fixture exposed empty/partial explicit configuration incorrectly accepted; it was fixed during the SAME Codex session. New tests reject initial-only, revise-only, empty, non-object and too-small values, and allow valid 1000/1000 and 12000/6000 plus omitted/null defaults.
- Old Windows self-hosted workflow 38726767700 was canceled BEFORE local Mac implementation to prevent duplicate execution.

## Gates outstanding at evidence publication
- GitHub Node / Windows CI for this NEW exact SHA: check separately.
- Independent read-only Codex Code Review on exact source cd1ddd8a978ba54abcc850c54e4f48dc74992fe4: NOT YET DONE.
- No merge, deployment, production update, real target activation or Sandbox E2E allowed.
- This is only the P2.2a preflight component; real macOS Codex executor P2.2b, watchdog, installer and Sandbox verification remain incomplete.
