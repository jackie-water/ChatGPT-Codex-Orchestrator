# Immutable implementation evidence — Control #305, delta-only REVISE 2/5

- Project: orchestrator-dev; exact originating Chat review_route: chat-303.
- Repository: jackie-water/ChatGPT-Codex-Orchestrator.
- Isolated macOS source branch: fix/macos-callback-send-receipt-20261018.
- Reviewed predecessor exact SHA: 6e451d28e5a01cbda51c54949d555e4064002f0e.
- Exact new implemented source commit: cb206ddf6b0a73275cafffff5cd48c3c53a2fac7.
- Additional edited surfaces: runtime/scripts/callback-delivery.mjs, runtime/scripts/register-chat.mjs, runtime/scripts/wake-chat.mjs, tests/macos-register-chat.test.mjs.
- Mac Codex CLI execution orchestrator-dev-305-2: exit 0; executor log SHA256 bda998ef4db99350c12d3141d85a8396fea9a034b35bacf2411c3735cfae55df; delta-only prompt SHA256 c7d522ea83a89ae69e60ad907b3b580fecc5e9606a8ddbb9e304f94021aaf068.
- Deterministic changes: parent callback spawnSync has 140000ms absolute timeout while child wake budget remains bounded at 130000ms. Callback sending checks busy state, exact destination, draft ownership and positively identified Send button. Post-click ambiguity remains reconcile-only and existing full payload/user-role receipt proof remains strict. Private Control #303 outbox remains untouched.
- Independent wrapper #305 validation: diff/syntax PASS, focused default & serial 25/25 PASS. Full default: 394 total, 383 pass, 1 fail, 10 skip, log SHA256 8645c5d568be8fa576061423b2e5ee40a1df4aa565bdd3c03ed90b46c842127b. The sole failure was PREEXISTING native PID: tests/macos-p3-setup-resume.test.mjs returned MACOS-NATIVE-PID-PROOF-FAILED, proof.self[0]=RUNNER_TIMEOUT and proof.self[1]=RUNNER_TIMEOUT; native deadline remained fixed at 250ms. This is NOT a callback test failure and MUST NOT be suppressed or misreported as full parallel PASS.
- Independent separate serial reconciliation: native-specific six tests 6/6 PASS, full serial 394 total, 384 pass, 0 fail, 10 skipped; full serial log SHA256 cdb92fa2ee49d0972058ff3d4a26e6cc932906ffa6ac1212e47c6fe8ddeba4cb. Serial terminal SHA256 f0d98e9abbd096b07242968e48f271889048e590a9ba764524d0fce0596edbcb. Source fingerprint unchanged.
- Source was pushed only to non-protected task branch; no merge, no default/dev change, no Runner activation, official setup, signer, deployment or real Sandbox E2E.
- Independent exact-SHA Code Review: PENDING at implementation checkpoint publication time. Callback technical review must distinguish the independent unresolved PID policy/availability gate. A PASS of callback scope is review-only, not merge approval.
