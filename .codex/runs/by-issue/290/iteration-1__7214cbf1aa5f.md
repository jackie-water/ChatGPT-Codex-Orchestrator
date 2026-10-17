# Immutable implementation evidence — Control #290 initial 1/5 (macOS official native helper installer)

- Project: orchestrator-dev; explicitly registered originating Chat route chat-267.
- GitHub source repository: jackie-water/ChatGPT-Codex-Orchestrator
- Isolated branch: feat/macos-official-libproc-installer-20261018
- Reviewed parent SHA: cb39ee142b3fcb5fa4628f32e2b758bb4c6524e8
- Exact new source commit: 7214cbf1aa5f75b55f4218e0f9d2dae5a8f4179e
- Earlier isolated libproc spike PASS independent Code Review checkpoint: d5b9b37effa2cbc8966b6ad4c73c5a3e50c108f7.
- Independent wrapper terminal PASS: exact source file fingerprint matches committed tree and push remote.
- Source aggregate SHA-256: dec17816ab2e650628227dbb03e69cfe1c66e04481d179a3271a026f42a7c458
- Changed file SHA-256:
  - AI_INSTALL.md: 6fc2aa32d5df55d669361e14e6dd10cc28f22102ce28419a02b538fe21f7277d
  - docs/macos-libproc-spike.md: a97e331f48bd0fcdb1de6a49a4c47b3e5af78871a276bab557d41465dfa143d3
  - src/cli.mjs: 34f54ee6baa9c24dd0e2484482138b5bf103cf7ec8c243184525b48562fa1a98
  - src/lib/macos-native-helper-install.mjs: ba3c2c8573b0fb10822608469d38083fec7f9e014fe3d1bfe255cabbf4ebb1cb
  - src/lib/macos-platform.mjs: 7bb28a559df6e62a9a7a9fb09ef8005becc9025ed7323fecfd54a1ab0d7d047e
  - tests/macos-native-helper-install.test.mjs: ee052a78418c7cb09318b5d73d97931767bd9f46f1d7839f2ecb64d3cb4581ae
  - tests/macos-p3-setup-resume.test.mjs: 24e36d106be6a86d04d8caf4aa89020095fe97770e35de4d8848e2f2403f95e3

## Verification
- All 11 wrapper steps exited zero: git diff check, Node syntax, native C Apple clang build, kernel microsecond PID identity probe, focused tests, npm full regression.
- Focused tests: 41 total, 40 pass, 0 fail, 1 skipped.
- Full npm suite: 377 total, 367 pass, 0 fail, 10 skipped.
- Native proc_pidinfo helper test: PASS self process identity, missing and invalid PID.
- Focused log SHA-256: 8a253ab48946c3824e52c0b8f734b5929a8e91d2376067737d8e97f3a27309f0
- Full log SHA-256: e6b5e6a8b88ba31b56e4f420daf86665c7a2b46b2c616cc3ec8e2d63415b2e01
- Validation terminal SHA-256: 759b104bf026644282c0c9b91819d9717f9b8a7ae28d84b585614d8267575c68
- Official Install.command/install.sh was NOT EXECUTED and no Runner/Control workflow was enabled, no installation on this machine, no Sandbox or real target mutation.

## Additional independent Chat review blocker evidence (not resolved)
- Isolated private test fixture created an approved mock helper/capability (not an actual live installation), obtained verifyMacosNativeCapability status PASS, then chmod capability receipt to mode 0666. Verification still returned PASS, violating mandatory receipt permissions and trust contract.
- In that isolated fixture, replaced capability receipt proof with self/parent status ERROR. verifyMacosNativeCapability again returned PASS instead of rejecting invalid PID evidence. Fixture was removed immediately.
- Independently inspecting src/lib/macos-platform.mjs confirms renderLaunchAgent supports native identity environment values but its existing macosRuntimeAction install call does not pass nativeHelperPath/nativeProcessIdentity or re-check verified capability; official LaunchAgent would not receive native opt-in environment.
- Independent exact-SHA read-only Code Review is still required. This candidate should not be considered release ready or PASS until deterministic findings are adjudicated and repaired.

## Safety gates
- No compiled executable committed; no use of existing production Runners, browser profiles, Priceup, Clean Energy or target.
- No Windows edits, no original #279 dirty worktree changes, no CODEX-RUN callback delivered via different Chat.
- This is source/wrapper evidence ONLY; not independent Code Review PASS. No merging or deployment authorized. Any merge requires user explicit approval of exact SHA.
