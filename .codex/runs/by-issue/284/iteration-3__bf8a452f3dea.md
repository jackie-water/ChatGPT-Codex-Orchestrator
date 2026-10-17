# Immutable implementation evidence — Control #284 iteration 3/5

- Project: orchestrator-dev; exact Chat route: chat-267
- Branch: spike/macos-libproc-process-identity-20261017
- Source repo: jackie-water/ChatGPT-Codex-Orchestrator
- Parent exact commit: bd7000045441bdea91fb58fc92cbe99c63dcc3d9
- Corrected exact commit: bf8a452f3deaf6bd78b233375c52b4a17b5bfcd5
- Last independent review #283 checkpoint: e2f4f755f8d606e5bd332cc8f0f071150dfdd735
- Modified paths: src/lib/macos-durable-intake.mjs, src/lib/macos-native-process-identity.mjs, tests/macos-durable-intake.test.mjs, tests/macos-native-process-identity.test.mjs
- Exact source aggregate SHA256: 80a39597221b8386d9e3312c7cb8d42402749b854e903d779971647d7f312580
- Corrected blockers: require nonnull native own-process identity before durable acceptance; normalize helper path without dropping trust checks; classify verified reused PID distinctly and persist UNKNOWN without replaying Codex.
- Wrapper validation PASS on exact precommit source files and confirmed committed Git tree.
- Checks: all syntax, diff, Clang compile, native libproc PID probe, focused and complete npm suite exit=0.
- Focused tests: 25 pass, 0 fail.
- Full npm tests: 370 total, 361 pass, 0 fail, 9 skipped.
- Native probe: current PID 3260, kernel start sec=1792235569, microseconds=159515; missing and invalid PID handled.
- Focused log SHA-256: 4a0cd8baa2cbeea90c3028c6f84fdaca9362e973b31e63c40ade711e25d26570
- Full log SHA-256: 117b480ed8532eada4004025d22e23b065179589793fed74a012e3b712bcd82e
- Validation terminal SHA-256: 81c6f9b492fd56db44a602d5b5bf03bb7ea478e9a69db4688a564f813f460dd5

## Gates
- This report is implementation and wrapper evidence ONLY, NOT independent Code Review PASS.
- No compiled helper binary committed, official installer activation, merge, deployment or runner enablement.
- Original dirty #279 worktree, Windows, Sandbox and target preserved; user exact-SHA approval before merge required.
