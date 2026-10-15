# P2.2b.1 Mac native Codex execution lifecycle — Issue 207 iteration 5/5
project: orchestrator-dev
source_branch: feat/macos-execution-lifecycle
exact_source_commit: 8ec10f4ba504122bcc15be92762812e9a6afd611
exact_reviewed_parent: 67a0020f80610b1b12f52ce55dcf8d30225e9fdf
stacked_base: b435f9620bd8235fb19ee2f424af10aa6ce34962
review_route: chat-165
Codex_exit_code: 0
implementation_status: READY_FOR_INDEPENDENT_CODE_REVIEW
merge_approved: NO

Changed files in this iteration: src/lib/macos-codex-execution.mjs, src/lib/macos-codex-run-contract.mjs, tests/macos-codex-execution.test.mjs. The required private immutable authorizer retention was completed through the SAME issue and Codex session after Chat documented a necessary allowed file expansion.
Corrected: after mutation/replacement of the public planned.normalized, Codex failure still uses privately retained original WeakSet-branded authorized snapshot, persisting P1 failure with original project/issue/iteration/Chat URL and no fabricated source SHA. Duplicate execution remains denied.
Corrected real Mac compatibility: normal /Users/Jackie/.local/bin/codex is a symlink to the installed owned binary. Executor resolves absolute trusted local binary path, verifies final regular executable owner/mode, runs the resolved target, rejects dangling or unsafe symlinks. This test did not invoke real Codex; fake binaries only. Instance/clone directory symlinks remain forbidden.
Independent Mac arm64 Node 24.22.0 full suite: 158 tests / 149 pass / 0 fail / 9 expected platform skipped. Source syntax and git diff --check PASS. Source branch pushed at exact SHA and clean. GitHub exact SHA CI and independent Code Review: not yet verified at checkpoint publication.
Still unimplemented beyond P2.2b.1: wrapper source validation/commit, immutable report publication, actual GitHub checkpoint, delivered Chat success callback, Mac installer/LaunchAgent, independent failure watcher, isolated live Sandbox E2E and Windows acceptance. This PASS-ready candidate is review-only; no merge/deploy or real target activation.