# Immutable exact-SHA implementation report — Control #298 final configured REVISE 5/5

- Project orchestrator-dev; exact registered origin Chat route chat-267.
- Repository jackie-water/ChatGPT-Codex-Orchestrator
- Isolated source branch feat/macos-official-libproc-installer-20261018
- Exact reviewed parent 7a999edfe9763c17d6548a3f9dee73ee61c39642
- Exact final configured iteration source SHA f35d0db64e3831542974002766e93a3b0eaea965
- Previous independent review #297 checkpoint e5bbdb61b27813585b60597c8767eb7a9de847ec.
- Independent wrapper task orchestrator-dev-298-5-validation-v3-serial = PASS; source fingerprint SHA256 90c3acbf0f1cc6aa35d0e0e95ef3a3c06510eba20deda236246cf374ca00373f
- src/lib/macos-native-helper-install.mjs blob SHA256 32b1577cdd814a736722e1ea10179705ff0a1cee67434e8f43349bfdc5b77735
- src/lib/macos-platform.mjs blob SHA256 00f5b3d6ed696fbe9110fb4c7dccfae497b99905d21f244aa5e2f78a5a891afb
- tests/macos-native-helper-install.test.mjs blob SHA256 eff799f8cec83f50f47f3aadf21ecc1b4c87d7a24993f076559771432add6b82
- tests/macos-platform.test.mjs blob SHA256 18e9d8930cfa5db96ead1f83d802141eb74ffe524f3b3cfe1bad84bcd4868b1e

## Changes and validation evidence
- Implemented same-process exclusive writer claim with random in-memory claim identity, inode/device/PID binding and private regular-file/mode checks instead of trusting user-supplied owner_id. Deterministic pre-journal failure settles only provably owned lock; uncertain lock is preserved for manual recovery.
- Added recognized PREPARED-only journal handling under exact verified same writer; no blind overwrite or migration of unknown legacy/no-journal helper or receipt.
- LaunchAgent start now compares the entire plist against exactly canonical renderLaunchAgent output, rejecting duplicate or injected native helper keys, malicious comments and foreign/helper overrides.
- Added same-iteration targeted source tests for claim cleanup, same-ID/other-PID, PREPARED journal handling and duplicate helper key; repaired two test fixtures to supply full valid journal fields and canonical receiptPath.
- Eleven wrapper steps all returned exit 0 including syntax, git diff, clang native C compile, live kernel microsecond PID birth proof, focused tests and full suite.
- Focused serial Node test suite: 52 tests / 51 PASS / 0 FAIL / 1 SKIP.
- Full serial npm test suite: 389 tests / 379 PASS / 0 FAIL / 10 SKIP. Exact mode: npm test -- --test-concurrency=1.
- Focused log sha256 6d0af4e21423432ae76cd0b4c0f0c020596b7ed4ecb463f19f726ad2255333ad
- Full log sha256 0402fa171b0eeac4eefa3ecfacd08984574f331fad7c87e91e29cb76aab02938
- Wrapper terminal sha256 a9511463306a2c8304caea17489473ae821bf8fde5e40430a5b2ffdfc2d3bc2a

## Known and unresolved QA caveat
- Same source fingerprint failed prior independent focused checks due intermittent MACOS-NATIVE-PID-PROOF-FAILED; diagnostic showed RUNNER_TIMEOUT on one of four native PID reads at fixed 250ms production timeout, with another read OK. No timeout relaxation, retry inside production, PID-proof skip or hidden test. Final serial PASS is a tested candidate only and does not establish default parallel-suite reliability or live Sandbox E2E/release readiness.

## Safety/review gates
- This is coding-only implementation, never official installation. No helper globally installed/signed, no Runner or Control workflow activation, no launchctl, no Sandbox/real target activation, no PROJECT_DISABLED bypass, no Windows or original dirty #279 worktree changes, no deployment, no merge.
- NEW independent read-only exact-SHA Code Review required for f35d0db64e3831542974002766e93a3b0eaea965. Since iteration cap is 5/5, any further deterministic blocking issues require NEEDS_HUMAN rather than implicit rotation 6/5.
- PASS from Code Review is review-only; merge requires separate user approval for this exact SHA.
