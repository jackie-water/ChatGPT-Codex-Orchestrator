# Immutable Phase C2 REVISE 4/5 implementation evidence — Control #366

Project: orchestrator-dev; exact registered Chat review route: chat-333.
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Source branch: feat/macos-phase-c2-existing-instance-recovery-20261019
Exact implementation SHA: 1cf246e5a800ccc65744f6665c3b779329817d41
Exact predecessor SHA: f48fcccaa3d3fdcb96ee83461b5cedbfc3687f52
Prior iteration #365 immutable checkpoint: 35a1029fdfc8a44e5cd6cbc27a92b40342d81285, report .codex/runs/by-issue/365/iteration-3__f48fcccaa3d3.md.
Phase C2 initial base: 7e03521158db16731801e55803dbb8c870f5288c.
Local Mac Codex gpt-5.6-luna medium exit 0; executor log SHA256 868b6f4d596b122dbf81803701dd21aa1c039e2504f2f1a38b464d85dbd9118c.

## Exact authorized code delta
Changed ONLY tests/macos-p3-setup-resume.test.mjs in the isolated task branch. Adds disposable canonical fixture instance identity binding and private trusted route + migration JSON, preserves instance_id and instance_root across the initial, sandbox-verified, completion and idempotent resume stages. No product inspector/CLI/native Helper/Windows implementation edits, no safety gate weakened. Exact source SHA pushed and independently confirmed against GitHub remote; clean worktree.

## Independent wrapper: FAIL / deterministic test isolation correction needed
| Run | Tests | Pass | Fail | Skip | Log SHA256 |
|---|---:|---:|---:|---:|---|
| P3 syntax | N/A | PASS | 0 | N/A | empty |
| P3 native/setup focused | 6 | 6 | 0 | 0 | a4fd6231c9a6d6bf4c7bf8f6d46ec58bc6416ddd4813a444b70a8e735b91be79 |
| C2 existing-instance focused | 9 | 9 | 0 | 0 | 9378a5378fe7c3ad0d9f8d4dabf0c9fd7a5dde34f12c011eb9939743de84cda8 |
| Full default | 461 | 450 | 1 | 10 | 3c86800f829c6e7d7bbf5ce61bfc58e0d752aa873660436a2a64683679b13bd5 |
| Full serial | 461 | 450 | 1 | 10 | 803d92898e89005b38797992dc6553464bca4cc7b769919b2994032d67d544ce |

Exact sole full-suite failure for both parallel and serial: tests/dry-run.test.mjs:8:1 `dry-run reports the installation plan without enabling the real project`, TypeError reading gated_by of undefined. Legacy test sets CHATGPT_CODEX_ORCHESTRATOR_HOME to fake state but not HOME; on Mac macosRecoveryReport sees genuine existing instance 1832f0bb and intentionally produces a safe plan=[] early return. This is NOT a production recovery error.
Independent disposable test-copy diagnostic corrected only test HOME isolation and canonical os.tmpdir realpath, kept assertions: dry-run test 1/1 PASS, no product code edits. Independent adjudication JSON SHA256 5a804d2c5275bafbc893c24d49d5be1596a617134569d6e65cfb6597925dfe1f.

## Next deterministic successor
Chat adjudication REVISE, NOT PASS. Approved Phase C2 iteration ceiling 5/5. Create at most one successor #367 on same exact task branch and review route chat-333, exact predecessor 1cf246e5a800ccc65744f6665c3b779329817d41. Allowed surface ONLY tests/dry-run.test.mjs: make mock installer HOME canonical-private and explicitly pass HOME into spawned child env, while preserving existing actual dry-run semantics and original assertions. Do not change any product source or disable real MACOS-EXISTING-INSTANCE-REVIEW.
No Code Review on this failing-wrapper exact SHA. No merge, real installer setup, instance adoption, issuer keys, Runner, browser, Sandbox/target activation, Windows/Priceup/Clean Energy or protected main/dev changes. Old Phase B #332 remains untouched on separate chat-303.