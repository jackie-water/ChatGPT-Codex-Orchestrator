# Immutable implementation checkpoint — Control #286, REVISE iteration 4/5

- Project: orchestrator-dev; registered originating review_route: chat-267
- Repository: jackie-water/ChatGPT-Codex-Orchestrator
- Task branch: spike/macos-libproc-process-identity-20261017
- Exact predecessor review SHA: bf8a452f3deaf6bd78b233375c52b4a17b5bfcd5
- Exact new source SHA: c22d2d7949e4fcfe4a8251822b6f6ed85fdbd0f4
- Prior Code Review #285 checkpoint: d67bdc0b72eb0e63afcc260cea7d3f9acf3d377a
- Independent wrapper task: orchestrator-dev-286-4-validation-v2, terminal PASS.
- Parent/source identity, committed bytes, GitHub remote branch SHA and clean tree verified.
- Aggregate SHA-256 of committed changed files: 9b84d9b9c33aea419e6f993dc196d233dc95c727bc874f803234c3a732cd3201
- Changed file digests:
  - src/lib/macos-durable-intake.mjs: 44c7c440fb1b8d710a41b0529f16273181d0d165eeaa89836ae4904450fa4f45
  - tests/macos-durable-intake.test.mjs: 1fbf7d9ae29922e78467668fdd59eb646b446af90244b4ea2cecb24b0913a645
  - tests/macos-native-process-identity.test.mjs: cfa71ab49ef8a8b45cb498467580b42ed9f27eec061848dc5c57ed24e790cf7e

## Changes and validation

- Legacy Darwin ps lstart process identity mismatches remain ambiguous, rather than claiming verified PID reuse; verified kernel-backed Darwin and Linux identities distinguish reuse.
- Lexical ancestor path safety regression uses a real trusted helper, raw .. path and writable ancestor; no weakened helper trust.
- One deterministic same-iteration correction ensures kill(pid,0) ESRCH is checked before classifying untrusted legacy format, preserving dead claim and orphaned lock recovery.
- Syntax checks, git diff check, Apple clang helper build, real libproc high-resolution PID probe, focused test and complete npm test all exit 0.
- Native self PID: 38310; process start sec=1792236637, usec=809379. Invalid PID and missing PID handled.
- Focused suite: 26 total, 25 pass, 0 fail, 1 skipped.
- Full npm suite: 371 total, 361 pass, 0 fail, 10 skipped.
- Focused log SHA-256: c3a72c6d8f58b1e7f0c4b34137227bf400c008a2683809f6fa416c28ac03b24b
- Full log SHA-256: 674385da9ea1e2cc27c8627db2698875bea5c661f445f53683e930a9e409e0e2
- Wrapper terminal SHA-256: 69895e14d036e3cd524844ae6f4fde31ed662d21d450009831a44eb6daffcb42

## Constraints

- This is implementation/validation evidence, not independent exact-SHA Code Review.
- No compiled binary committed, official installer activation, runner enablement, Windows change, production deployment or merge.
- Original #279 iteration 5/5 worktree unchanged, Sandbox and real target untouched, no PROJECT_DISABLED bypass.
- Independently review this new exact SHA; PASS is review-only and merge requires explicit human approval of this same exact SHA.
