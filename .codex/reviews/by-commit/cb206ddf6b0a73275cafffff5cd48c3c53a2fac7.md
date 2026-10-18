# Immutable independent exact-SHA full-diff Code Review — Control #306

- Project: orchestrator-dev; registered Chat route chat-303.
- Source repository: jackie-water/ChatGPT-Codex-Orchestrator
- Source task branch: fix/macos-callback-send-receipt-20261018
- Exact reviewed HEAD: cb206ddf6b0a73275cafffff5cd48c3c53a2fac7
- Comparison base: e1e502fa349a902bda7ba836d38eb5d7a4966b67 (covers BOTH task implementation commits).
- Implementation checkpoint: 679ea3e1493dd8cc260da365ed22924df43e1a1f, .codex/runs/by-issue/305/iteration-2__cb206ddf6b0a.md
- Independent read-only Codex CLI full-diff review executed on Mac with --base feat/macos-official-libproc-installer-20261018, whose exact SHA was e1e502fa349a902bda7ba836d38eb5d7a4966b67. CLI exit 0, reviewed head unchanged, Git status clean.
- Review log sha256: cb9ee7f081daaab1d805bbed091c25680cb8a8e7ce063b28dd41893f0909b455; size 569767 bytes.
- Previous CLI syntax attempt --base plus positional custom prompt returned exit 2 before review execution; it is NOT a valid review and was not counted.

## Independent findings and Chat adjudication

1. P1 BLOCK — runtime/scripts/wake-chat.mjs around line 360. Busy-control regex omits case normalization and data-testid, allowing enabled Send to be clicked with common Stop generating controls visible. REVISE.
2. P2 BLOCK — runtime/scripts/wake-chat.mjs around lines 198-201. Busy composer causes a premature exit after 20 seconds, even when the larger bounded wake budget remains. REVISE.
3. P2 BLOCK — runtime/scripts/wake-chat.mjs around lines 17-21 and discovery/evaluation calls. CDP/fetch operations are not all deadline bounded, permitting parent kill before child safely settles. REVISE.
4. Additional deterministic Chat-reviewed blocker — runtime/scripts/callback-delivery.mjs selectSafeSendButton. A candidate with testid=send-feedback preceding the actual Send candidate is wrongly selected (returned index 0, expected index 1). data-testid must be restricted to trusted composer Send controls; unrelated buttons cannot trigger submission. REVISE. Also ensure Send controls are scoped to the callback composer/form, not arbitrary ancestor containers.

No findings authorize relaxed callback receipt proof, fake DELIVERED, new fallback Chats, native PID proof bypass, Windows changes, merge or production runner activation.

## Cross-workflow baseline distinction

- Mac independent focused callback default/serial 25/25 PASS.
- Mac default full regression 394 total, 383 pass, one failure, 10 skipped: unchanged native process identity 250ms RUNNER_TIMEOUT causes MACOS-NATIVE-PID-PROOF-FAILED in tests/macos-p3-setup-resume.test.mjs (both self reads timed out).
- Mac independent full serial 394 total, 384 pass, zero fail, 10 skipped; native focused 6/6 PASS.
- This pre-existing intermittent PID blocker is tracked separately. It does not excuse callback security defects.
- Final Chat decision for this reviewed candidate: REVISE, only deterministic delta corrections, source SHA pinned. PASS not granted. No merge approval.
