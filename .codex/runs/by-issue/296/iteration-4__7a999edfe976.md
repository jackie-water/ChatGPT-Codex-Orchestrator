# Immutable implementation report — macOS official helper installer REVISE 4/5, Control #296

- Project: orchestrator-dev; registered originating Chat route chat-267.
- Source repository: jackie-water/ChatGPT-Codex-Orchestrator
- Isolated source branch: feat/macos-official-libproc-installer-20261018
- Exact parent reviewed SHA: 0e42cbb1011330353ad9493a7183735b48593126
- Exact source commit: 7a999edfe9763c17d6548a3f9dee73ee61c39642
- Previous independent Code Review #295 authoritative checkpoint 2c0a1df5ee64419630d5786f0c3fec9fef73ce33.
- Independent wrapper task: orchestrator-dev-296-4-validation-v5-serial terminal PASS, commit+push remote SHA verified.
- Committed-source aggregate fingerprint SHA256: 233d29329156fd60a95d1823336d1533cd5ecca031cc48f24c85367f2c6850cf
- Changed src/lib/macos-native-helper-install.mjs blob sha256 6ac64c7888ccd2f307d9fd4f5c7d7dbe51047154b078f4aecb8517718145737b
- Changed src/lib/macos-platform.mjs blob sha256 d6f99b33559c766f4aaf681b60a41a5af0bd17088c8ed8581d56be4aa8e6fd39
- Changed tests/macos-native-helper-install.test.mjs blob sha256 3a2985cf26cfd1d5484448673be51ea61b47d66232218685e63fff8f894b57c7
- Changed tests/macos-p3-journal-launchctl.test.mjs blob sha256 842bc880dfd1ae267362a0b504b78d1cf245e5110dc1d3671dde10f8871be3cf
- Changed tests/macos-p3-setup-resume.test.mjs blob sha256 ce1bba91c9d5708d5021702b908504fafde75615fdb520d94974e739913c518a
- Changed tests/macos-platform.test.mjs blob sha256 2ad651328be45ed60cf29d3032ad45c4ac4ac0f779485a259849e1ed9aa443aa

## Implementation delta
- Instance-private exclusive no-replace native helper writer claim and no-overwrite initial installation journal, BUSY/UNKNOWN fail-closed concurrent operations and preservation of existing metadata/receipt; no automatic uncertain-lock reclamation.
- LaunchAgent start checks XML-escaped exact helper path and two native environment keys while preserving registered Sandbox instance and action-approval gates.
- New targeted negative fixtures for same-installation BUSY and unknown lock, plus XML-special-character HOME and hostile/mismatched plist rejection.
- Same-iteration deterministic test correction resolved use of non-canonicalized fixture installation IDs and updated legacy launchctl post-start test to generate the full renderer plist. Only owned isolated fixtures modified.

## Wrapper validation
- Eleven wrapper validation steps all returned zero: source diff, Node syntax, Apple xcrun clang, real native libproc PID self double-read, invalid/missing PID probes, focused and full suites.
- Focused test mode: node --test --test-concurrency=1 with 50 tests / 49 PASS / 0 FAIL / 1 SKIPPED.
- Full test mode: npm test -- --test-concurrency=1 with 387 tests / 377 PASS / 0 FAIL / 10 SKIPPED.
- Focused log SHA256: b084a13659af0142b3463e30c0d51ade4176282c608988fccd10cf9a4b5fd3d7
- Full log SHA256: 24eacdf288586020af2eaf7cdf1151ce9978649fa0ed0b818e63510e6e561e88
- Wrapper terminal SHA256: 0b1371d9dc61c0badcf10944600de3d1ab0a04498cbd9ed3c8e434b0978c1a0d
- KNOWN QA GAP: prior attempts under default concurrent test mode and sometimes even serial showed MACOS-NATIVE-PID-PROOF-FAILED; sanitized proof diagnostics identified native RUNNER_TIMEOUT on one of double process observations within fixed 250ms fail-closed production helper timeout, while later observation succeeded. No production timeout raised or proof bypassed. This validated candidate passes serial only, not release readiness or live Sandbox E2E.

## Review focus and safeguards
- New exact-SHA independent read-only Code Review REQUIRED before Chat PASS or user merge question. Assess lock exclusive owner proof (owner_id versus live PID birth identity), crash recovery by fresh CLI process, journal lock lifespan and crash ambiguity, no clobber, duplicate same-writer and private path trust. Assess plist escaped-path comparisons and injection/format correctness. Fail-closed manual recovery for pre-journal legacy remains human-approved security invariant, not candidate blocker for automatic migration.
- Windows, original dirty #279 worktree, other projects, Control Runner/service and disabled Sandbox/real target untouched. No official macOS installer executed on live machine, no native helper signed or globally installed, no launchctl or Runner activation, no PROJECT_DISABLED bypass, no deployment, and no merge.
- Review PASS is review-only, NOT merge authorization; exact-SHA user approval separately required.
