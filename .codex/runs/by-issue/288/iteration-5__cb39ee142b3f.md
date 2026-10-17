# Immutable implementation evidence — Control #288, final REVISE iteration 5/5

- Project: orchestrator-dev; registered origin Chat review_route: chat-267
- Source repo: jackie-water/ChatGPT-Codex-Orchestrator
- Isolated task branch: spike/macos-libproc-process-identity-20261017
- Parent independently reviewed SHA: c22d2d7949e4fcfe4a8251822b6f6ed85fdbd0f4
- Exact new source SHA: cb39ee142b3fcb5fa4628f32e2b758bb4c6524e8
- Prior independent review #287 immutable checkpoint: 114e9806dae5cf6ae77bebd7f72d59563fa0d69a
- Independent native reviewer #287 reported zero issues; Chat independently reproduced P1 lock TOCTOU and adjudicated REVISE.
- Modified files: docs/macos-libproc-spike.md, src/lib/macos-durable-intake.mjs, tests/macos-durable-intake.test.mjs
- Exact Git blob aggregate SHA-256 matched precommit validation fingerprint: 130c1c0a5afac84337c7cc3f1f87241e7ff121eb8e9cbe348c0979f049c435ca
- Source blob docs/macos-libproc-spike.md SHA-256: d56a881c5489b7c1d5befb0f604eb3cfee6a9f30396c160ada6f4251827657ec
- Source blob src/lib/macos-durable-intake.mjs SHA-256: 6ad21609904d18ff388ba08f77dda96c72f6bbbcb4b2f70a2efd045966ad2c07
- Source blob tests/macos-durable-intake.test.mjs SHA-256: 0aa9157cb1e22a263bdbd14f61055b5f6d491a07e7cdf9fee6e801e47e5cbe88

## Implementation and wrapper evidence

- Corrected stale-lock replacement race by disabling unsafe automatic lock pathname reclaim and returning actionable RECEIPT_LOCK_RECLAIM_UNCERTAIN without removing existing locks or mutating receipt.
- Documented that operator must verify no writer before reviewed recovery, rather than silently deleting a lock or rerunning a dispatch.
- Within same iteration, corrected test status-code assertions and ensured deterministic replacement-lock regression executes on macOS.
- Independent wrapper task: orchestrator-dev-288-5-validation-v2, terminal PASS; seven zero-exit steps.
- Native Apple clang compiled C libproc helper and observed process-start microsecond identity in authorized private validation directory.
- Native self PID=73668 start_sec=1792271025 start_usec=773925; invalid PID=INVALID_PID, missing PID=MISSING.
- Focused tests: 28 total, 27 passed, 0 failed, 1 skipped. Critical stale-lock-replacement test runs on Darwin.
- Full npm suite: 373 total, 363 passed, 0 failed, 10 skipped.
- Focused log SHA-256: 597e870824eacd98285dd7e79d0c972bf11c280efb1cc9dfbdaee549d848c7b7
- Full suite log SHA-256: 081efbb844aa18a2139f6bc13574b02f4b31cbe5bcd53c93bf39ed3883c0be46
- Validation terminal SHA-256: 8bce9fdd540f971899dce29c615e3669f7c28fee4e66a49f6a860fd0c583de69

## Hard gates
- This is exact-SHA source + wrapper evidence only; independent read-only Code Review of new SHA is still mandatory.
- The configured REVISE 5/5 budget is exhausted. No silent successor if further blocking findings require judgment.
- No compiled binary committed or native helper installed/signed; no official installer or deployment, Runner activation, Windows changes, original dirty #279 worktree or Sandbox/real target activation.
- PASS is review-only. A merge requires explicit user approval for the same 40-character source SHA.
