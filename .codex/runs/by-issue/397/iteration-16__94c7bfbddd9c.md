# Immutable implementation report — Trusted Recovery Evidence v1, Control #397 (16/16)

Project: orchestrator-dev
**Registered exact originating Chat review_route: chat-369**
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Isolated non-protected task branch: feat/macos-trusted-recovery-evidence-v1-20261020
**Exact committed and remote-verified source SHA: 94c7bfbddd9c25a333efec9d8e26dd9009846e3d**
Immediate committed predecessor SHA: a8ecfcd738121c0882eaef9294b4145c5f6189de
Full cumulative C2 + Trusted Recovery v1 review base SHA: 7e03521158db16731801e55803dbb8c870f5288c
Previous independent Code Review #395 checkpoint 5e9cd2ccca4ae757c0bfa2bb3ae8a9fa2fdf684c applied ONLY to preceding source SHA.
User explicitly approved one REVISE 16/16; NO 17/17 or merge approval.

## Deterministic implementation and provenance

Prior approved REVISE 15/15 Control #396 changed four authorized files but left an uncommitted candidate. Exact prior git diff --binary SHA256 **ec5ec2dd379b14e81b17fb807df3d5d9b2da37c9a5c6c9d6b726e8dd0a2ffff4**, focused result **167 total / 153 PASS / 14 FAIL** with log SHA256 **2fb22436f9fe79f7518399bea87754af87d8b3e49a7e734529ec182c0bcaadda**. Two independently diagnosed blockers:
- src/lib/macos-trusted-recovery-evidence.mjs independentlyVerifiedProvenance(): reads secure JSON wrapper `routeFile` instead of parsed `routeFile.value`, so valid Active route appears empty and valid issue/receipt/P3 first resume are refused. Correction uses `routeRecords(routeFile?.value)` while retaining newly required active route chat_url === authenticated GitHub Issue chat_url === state.reviewer_chat_url, no fallback.
- tests/control-runtime-refresh.test.mjs macOS upgrade subtest took tree snapshot *before* deliberately writing tampered persisted Sandbox metadata, then expected same snapshot after rejected upgrade. Correction takes the baseline *after* fixture tamper and *before* rejected upgrade; safety assertions remain.

The preserved 15/15 source changes also strictly bind macOS runtime refresh/upgrade to persisted `sandbox_repository` and Control role; Windows code contract unaffected. The 16/16 Codex executor edited ONLY allowed surfaces, exited 0 after 15.52s, did not itself commit/push; executor log SHA256 **534e5c1ed9b79ddd299d7708b143d2acd231496c776aaa3093c80be49245dbb7**. Independent wrapper confirmed all four candidate files, with **src/lib/control-env.mjs byte-for-byte unchanged versus the prior authorized dirty patch**. Wrapper committed and fast-forward pushed ONLY this non-protected task branch after independent validations PASS. Local and remote HEAD exactly 94c7bfbddd9c25a333efec9d8e26dd9009846e3d; source worktree clean; main and dev untouched.

Immediate source commit changes these four paths relative to preceding committed SHA:
- src/lib/control-env.mjs
- src/lib/macos-trusted-recovery-evidence.mjs
- tests/control-runtime-refresh.test.mjs
- tests/macos-trusted-recovery-evidence.test.mjs

## Independent wrapper validation

All tests in disposable private canonical HOME, redirected GH_CONFIG_DIR and installer state path; GitHub/OpenAI API authorization environment variables stripped. No real installation/Runner/target touched.

- Syntax for all four changed JavaScript files, strict file scope, git diff --check, preserved prior control-env patch: **PASS**.
- Focused five-suite C2/P3/trusted recovery/runtime refresh/dry-run: **167 total / 167 PASS / 0 FAIL / 0 SKIP**, log SHA256 **df905576ee4d3777efbf11f7d1e3018723f3636dd1fb928bb2aa73c3851d8ec9**.
- Full default Node test suite: **499 total / 489 PASS / 0 FAIL / 10 SKIP**, log SHA256 **4aef412b2a943958dd73a12f4bfb445654c3be6d83013a600c393639990bee8f**.
- Full serial Node suite: **499 total / 489 PASS / 0 FAIL / 10 SKIP**, log SHA256 **d2d6b3bd9acacc64accd173f2c646d762581e50d6692040050fb3251d57677ed**.
- Independent route callback private-home positive and two tamper conditions: valid issuance and verification VERIFIED; tampered selected route chat_url *before receipt* issuer DENIED; tampered *after receipt* issuer DENIED and verifier CONFLICT, with no fallback. Proof SHA256 **f03174ff92a3881616a063be2d70f18e3479c754b34c3948b412c9d6e39e5914**.
- Additional **28/28** independent private-home negative probes: wrong-instance setup/resume, 16 legacy/security boundaries, 10 hidden/symlink/duplicate-route cases all refuse with zero external commands, empty plan and unchanged state. Consolidated proof SHA256 **419269ebd25a17766c054521f9d98990043e458e87bcc5c4f26293568617a72f**.
- Total **30/30** independent safety cases PASS. The two route cases were newly exercised in this exact run.
- Validated cumulative task commit patch SHA256 **480edfa9083b7a9bc32c5051c4c840847bf814e81d3aaa74927d858ce0a5fb4f**.
- Independent PASS wrapper JSON SHA256 **de9b4a03b8a8e591869e6275637d141d5a39ee55b3c2a3f1bbffa175e01ad514**.

Private Mac short-turn evidence stored in **/tmp/trusted-recovery-issue-397-private/**, with 0700 directory and 0600 file proof. This is temporary staging and may not survive reboot; this immutable GitHub checkpoint is the durable implementation report. Local records: accepted/running/terminal, executor.log, focused/default/serial test logs, three legacy adversarial reports, route binding proof, independent-security-probes.json, wrapper.json, source patch and candidate-commit.json.

## Required independent Code Review and safety boundaries

**Independent wrapper PASS is NOT final Chat PASS.** One independent STRICTLY READ-ONLY full cumulative Code Review from exact source base 7e03521158db16731801e55803dbb8c870f5288c through 94c7bfbddd9c25a333efec9d8e26dd9009846e3d must independently assess route/GitHub issue/Control+Sandbox IDs/provenance, macOS runtime refresh+upgrade identity gates, wrong-instance fail-closed, canonical file owner/no-follow, signed native Helper PID 500ms and installer Sandbox-first invariant. After reviewing immutable exact-SHA evidence, Chat independently adjudicates PASS/REVISE/NEEDS_HUMAN. Review of previous source SHA is NOT reusable.

**PASS NEVER authorizes merge**. No official installer, real legacy adoption, signer, Runner/LaunchAgent/browser/CDP, Sandbox merge/target activation, protected main/dev, Windows, Priceup, Clean Energy or old Phase B #332/chat-303 mutations. 16/16 iteration budget exhausted; no automatic next Codex run.
