# Immutable implementation checkpoint — macOS official helper installer Control #294 REVISE 3/5

- Project: orchestrator-dev; originating Chat review_route chat-267.
- Source repo: jackie-water/ChatGPT-Codex-Orchestrator
- Isolated branch: feat/macos-official-libproc-installer-20261018
- Exact parent reviewed commit: 8fe52504fec1b208d9827e4e7c819528fd3b4bb1
- Exact new implemented commit: 0e42cbb1011330353ad9493a7183735b48593126
- Prior independent Code Review #293 checkpoint 04723e9b1ddcf8297cca861f9f366cf42a385c49.
- Wrapper independent terminal PASS for task orchestrator-dev-294-3-validation-v6-serial.
- Aggregate committed-source SHA256: 3b238e96d6912f431e274b2df639a0b70fd5f59f0a2598a83c1ebbe073c97e7f
- src/cli.mjs blob SHA256: c9c0833fcac177a7bc749dfcd4a80cbc7894bd2620fc642a9fdb6dbf930eff80
- src/lib/macos-native-helper-install.mjs blob SHA256: a6e4b85aadaee698a7c7bb40d00f9e28da9a2b09d6df6140bd8ceb83ae28ff3b
- src/lib/macos-platform.mjs blob SHA256: 62d6f92d07b18b873721abe00583568bc234b677cf682fbd9958e1ed09cadba1
- tests/macos-native-helper-install.test.mjs blob SHA256: d8f5708364ccbf4b65cdd92b6a4bf25d8545cd74027113e62bdcace69c0983d6
- tests/macos-p3-journal-launchctl.test.mjs blob SHA256: 6f8f3c020304a44f06424e486f3420523f161ebcc903105b74e233cc329905b4
- tests/macos-p3-setup-resume.test.mjs blob SHA256: 34d02d3474169ac8ec42909ca584c29fb610570c4212763a6049d7011445afb1
- tests/macos-platform.test.mjs blob SHA256: 3cb885579304e18c6823e60e8e3d79a5c8fb0cea78e29e9b15ed13fd6edce496

## Changes and validation

- Implemented durable per-installation private journal for helper publication/interruption and safe recovery only after proving existing journal/helper identity. Invalid legacy or foreign artifacts fail closed. Rechecks capability before LaunchAgent start, reports partial/unknown filesystem mutations, preserves canonical receipt_path across idempotent resume.
- Same iteration test-only correction updates synthetic launchctl legacy test with verified private capability and negative tests for missing/mismatched identity. Mac child-process Sandbox resume test fixture now compiles the reviewed native libproc C helper for real PID provenance, without changing production PID timeout or lowering proof strictness.
- Wrapper 11 validation steps all exit 0: syntax, git diff integrity, real Apple CLT native clang, kernel process birth sec/usec and missing/invalid probes, focused tests, full suite.
- Focused Node: 47 tests / 46 PASS / 0 FAIL / 1 SKIP with explicit --test-concurrency=1.
- Full suite: npm test -- --test-concurrency=1, 384 total / 374 PASS / 0 FAIL / 10 SKIP.
- IMPORTANT KNOWN QA GAP: prior default-parallel wrapper attempts intermittently FAIL with macOS isolated resume returning MACOS-NATIVE-PID-PROOF-FAILED. Serial PASS is not evidence that default parallel npm test became stable, nor is this full live Sandbox E2E. No production timeout change or pass-through bypass was applied. Preserve prior FAIL evidence and evaluate under independent Code Review before release.
- Focused log SHA256: 6dbd2f02e416e2b3b5731344beb88adf5d1be12f559f341439b5128dbd202bff
- Full serial suite log SHA256: d24a75f893a2a7cbd262625e64790504977609c433ca6a7b30e9ab6ce62dd195
- Validation terminal SHA256: 9e8943c6382dbe33056a6aa058aaf3a0d2fe536cc0620dedc0373320abbc30c4

## Safety gates
- This is immutable implementation/wrapper evidence ONLY; independent read-only exact-SHA Codex Code Review has NOT yet occurred.
- Official installer was NOT executed for a live instance. No native helper signed/installed into real runtime, no launchctl or Runner activation, no Control disabled workflow enabled, no Sandbox or real target activation, no PROJECT_DISABLED bypass, no deployment, merge or protected-branch change.
- Original dirty #279 worktree, Windows and other Chats untouched. Same chat-267 route required throughout.
- Chat PASS only after independent exact-SHA review and no deterministic blocker; explicit user authorization needed for exact SHA before any merge.
