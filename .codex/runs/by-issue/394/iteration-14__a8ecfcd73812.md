# Immutable implementation checkpoint — Trusted Recovery Evidence v1 #394 (14/14)

Project: orchestrator-dev
**Exact originating Chat callback route: chat-369**
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Isolated, nonprotected task branch: feat/macos-trusted-recovery-evidence-v1-20261020
**Exact committed, locally clean and remote-verified source SHA: a8ecfcd738121c0882eaef9294b4145c5f6189de**
Immediate committed predecessor SHA: 58a2139aab20562c05e19d97b9f7493d6223eaf2
Full cumulative C2+Trusted Recovery v1 review base: 7e03521158db16731801e55803dbb8c870f5288c
Previous independent Code Review #392 checkpoint: a93653f6d4a59a85c93625dcb5ee608961569061; this evidence applies ONLY to prior SHA.
One-time explicit user approval was for single REVISE 14/14; no 15/15 or merge authority.

## Authoritative changes
13/13 candidate was preserved uncommitted, Control #393 focused 45 total / 43 PASS / 2 FAIL because TWO new tests did not reach the intended authorization gate:
1. Collapsed Control/Sandbox test modified sandbox repository in installer state+Control identity, but did not update private migration-intent generated Sandbox role; safe mismatch migration_identity_match occurred first.
2. Same GitHub immutable ID test had no trusted manifest; it expected CONFLICT where safe pre-issuance refusal was NEEDS_HUMAN_LEGACY.

This 14/14 Codex implementation **edited ONLY** tests/macos-trusted-recovery-evidence.test.mjs relative to complete prior #393 candidate; existing uncommitted production verifier src/lib/macos-trusted-recovery-evidence.mjs was independently byte-identical to #393 saved patch SHA256 c9df60220ee05f8b1b0ee86ce3eb23894a6c0d899f16a22b93e20636a94e93da. The corrected fixture rewrites private migration-intent role coherently, preserves private permissions and independently tests issuer's same-name rejection, accepts safe NEEDS_HUMAN_LEGACY before receipt existence and adds **post-issuance remote GitHub immutable-ID collision => CONFLICT** with unchanged receipt/state and known mocked remote reads. All existing Control-origin/role/route, v1 receipt-status/issued_at and C2/P3 tests remain.

The immediate source SHA commit necessarily contains 2 files (the preserved 13/13 production fix and corrected 14/14 test):
- src/lib/macos-trusted-recovery-evidence.mjs
- tests/macos-trusted-recovery-evidence.test.mjs
Codex edited only, exited 0 (45.95s), made no commit or push. Independent wrapper created and pushed exact commit to task branch ONLY after tests and security probe PASS.

## Independent wrapper and validation
Private canonical disposable HOME and redirected GH_CONFIG_DIR/installer state, GitHub/OpenAI credentials stripped, no real installed instance used:
- Source modified-file scope, preserved prior production bytes, syntax, diff --check: PASS.
- Focused: **46 total / 46 PASS / 0 FAIL / 0 SKIP**, log SHA256 e7a5722c3fc032250f6ec0bcf74d48bf59605ab5da9559ac83843addaebc3759.
- Full default Node tests: **491 total / 481 PASS / 0 FAIL / 10 SKIP**, log SHA256 ca43c85f3c18cf821997d869a7076b8831ba594f2315fa989f62cdd9cc12aadf.
- Full serial Node tests: **491 total / 481 PASS / 0 FAIL / 10 SKIP**, log SHA256 769d24ccab6df83d403ff46d98d9a45e743777e2fb33ad02a853273726772e38.
- Independent disposable Mac synthetic GitHub repo-role probe: **4 cases PASS**: Control role tampering after issuance returns CONFLICT, collapsed Control/Sandbox names+IDs refuse issuance, distinct remote names with same immutable ID refuse preissuance, postissuance ID collision returns CONFLICT. Proof SHA256 53250c507c8827147a3b786f1006d78a7a7cc372de88001f63949d11116b22a1.
- Prior 28 separate legacy/symlink/route security probes are retained from earlier parent source SHA and NOT separately repeated for this exact commit; automated C2+P3 tests were executed in focused, default and serial suites.
- Independent wrapper JSON SHA256 d2c725a44ba36abeb1ea033b21cff5b1340713ed767f2d5968258e1d9d8b52d8.
- Validated exact source patch SHA256 c6fc160e76ea5e53f37d5781791182c139a70191f78c7f2b11850400e78f0a7f.
- Codex executor log SHA256 13d4bf2e69c5d17b3c2bb55dc06b0c9cd2d2a8e73d4734c1d4ea249a4ad9ffbf.

Local immutable private evidence /Users/Jackie/.chatgpt-codex-orchestrator/instances/1832f0bb/short-turn-evidence/issue-394-trusted-recovery-v1-iteration-14/ includes accepted/running/terminal, wrapper, focused/default/serial logs, independent role probe, exact patch and candidate-commit.json.

## Mandatory review and boundaries
**Implementation wrapper PASS is NOT final Chat PASS or merge.** Independent strictly READ-ONLY FULL-CUMULATIVE Code Review for exact SHA a8ecfcd738121c0882eaef9294b4145c5f6189de against base 7e03521158db16731801e55803dbb8c870f5288c is required; Chat independently adjudicates each finding. Do NOT reuse the previous #392 independent review (different SHA). Explicit route chat-369 persists. No auto 15/15.

**NO MERGE, NO official installer, NO legacy instance adoption, NO signer, NO Runner/LaunchAgent/browser/CDP, NO Sandbox merge/real target activation, NO protected main/dev changes, and NO Windows/Priceup/Clean Energy/old Phase B operations.**
