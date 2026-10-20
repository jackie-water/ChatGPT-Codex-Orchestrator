# Immutable implementation checkpoint — Trusted Recovery Evidence v1, Control #402 (19/19)

Project: orchestrator-dev
**Exact originating registered Chat review_route: chat-369**
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Non-protected task branch: feat/macos-trusted-recovery-evidence-v1-20261020
**Exact committed and remote verified implementation source SHA: 34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7**
Immediate predecessor SHA: c6240b42d699250aa814379d593eea252ce99366
FULL CUMULATIVE macOS C2 + Trusted Recovery v1 review base: 7e03521158db16731801e55803dbb8c870f5288c
Previous #401 independent review checkpoint: 4005b58959b79852b49b5efae1ddb58afb870649, applies ONLY to predecessor SHA.
User authorized precisely ONE REVISE 19/19; **no automatic 20/20 or merge authority.**

## Deterministic implementation

Independent read-only full cumulative Code Review #401 identified one confirmed P2 in Trusted Recovery Evidence v1 receipt verification: `secureFile(...privateFile=true)` admitted owner-controlled regular proof file mode `0700` because `OWNER_MODES` includes both `0o600` and `0o700`, even though v1 contract requires trusted receipt `trusted-recovery-evidence-v1.json` mode exactly `0600`. The issuer already rejected existing trusted receipts with 0700. Independent synthetic Mac private canonical HOME proof: valid 0600 receipt -> verifier VERIFIED; chmod ONLY receipt to 0700 -> verifier incorrectly VERIFIED, issuer rejected. Proof SHA256 87653eb8dcd85c1def1090daba86a7674a6c21e501152d28bc02fa7d826631c9. A separate reviewer allegation that invalid issued_at could pass idempotent issuer was independently DISMISSED because verifyLocalIdentity rejects it before that branch; no change to timestamp logic.

This 19/19 Codex implementation, dispatched only once via Control #402, changed **exactly two allowed files**:
- `src/lib/macos-trusted-recovery-evidence.mjs`: adds optional `requiredMode` for secureFile and passes `requiredMode:0o600` ONLY for the canonical `trusted-recovery-evidence-v1.json` in localProof. A 0700 receipt is now CONFLICT with `trusted_manifest_integrity`, no write or external GitHub lookup. Other file type rules and directories are unchanged.
- `tests/macos-trusted-recovery-evidence.test.mjs`: adds regression: valid issued 0600 receipt VERIFIED, chmod to 0700 -> verifier CONFLICT/trusted_manifest_integrity/mutations false/no additional GitHub calls, issuer refuses and doesn't overwrite/chmod state, restore 0600 -> verifier VERIFIED. Preserves other tests.

**Native Helper executable mode 0700 was NOT changed or prohibited.** No changes to macos-platform or native-helper PID identity checks; no unrelated owner/mode rules globally tightened. The Code Review must independently scrutinize this exact distinction.

Codex exit 0, timed_out false, elapsed 19.32s, executor log SHA256 **99ad7e30a65fc03b0e6f187298f5ae7d25fa15e31a013cc83d33469ebd3ceddd**; Codex did not commit/push. Independent wrapper alone committed and fast-forward pushed this precise SHA on the nonprotected task branch after all gates passed; local and remote HEAD match, worktree clean, protected main/dev untouched.

## Independent wrapper validation — disposable Mac HOME

Independent wrapper scope/diff, Node syntax and no other untracked files: PASS. Tests executed with a canonical private disposable HOME and redirected GH_CONFIG_DIR/install state, GH/GITHUB/OpenAI auth variables removed, no real installer or target touched.
- Focused five suites C2/P3/Trusted Recovery/dry-run/runtime refresh: **170 total / 170 PASS / 0 FAIL / 0 SKIP**, log SHA256 **f1fd76a963cd231591fb5c0baeb39d00beffe56833663cc46d650b37596405a4**.
- Full default Node suite: **502 total / 492 PASS / 0 FAIL / 10 SKIP**, log SHA256 **7e5a892f8acee7102f3db2ee9d6e58b9fa640e674d5c9e3381032e0ad342aadf**.
- Full serial Node suite: **502 total / 492 PASS / 0 FAIL / 10 SKIP**, log SHA256 **f3ab594ff7cdd5d250cbbff6909a5563468ed723b79961a3962df685779f2063**.
- New **34/34 independent private-HOME safety checks** on this exact candidate: 2 wrong-instance setup/resume refusals, 16 legacy/route/symlink/C2 scenarios, 10 hidden profile/duplicate route scenarios, 2 selected Chat URL tamper issuer/verifier scenarios, 4 trusted v1 receipt scenarios (3 status/timestamp tamper and 0700 permission mismatch). Positive issued 0600 receipt VERIFIED. All negatives refused; no external action or state mutation. Combined report SHA256 **b1aab6919c3a4d93338897ea953885bba7fcdf9400cbee9e8c08795dcc922b61**; receipt-specific independent report SHA256 **cd6704a34d762c9d55726299d96092cb3224eba318296a1903208b9d7e820494**.
- Independent wrapper PASS JSON SHA256 **e744d77483ed638b55a8c8af517c183a014a46af59ed0316ec3a16f8a095e2b3**.
- Validated exact two-file source delta SHA256 **627d6cc8ea8a0b27bafce848c4321b4d8435b6567268158c03b29716a5af6b04**.

Private local evidence stored at `/tmp/trusted-recovery-issue-402-private/`, with accepted/running/terminal, executor.log, full test logs, independent security reports, wrapper JSON, source patch and candidate-commit.json. This temporary path is NOT a durable checkpoint; this exact file on pinned GitHub `codex/checkpoints` is the immutable implementation evidence.

## Mandatory independent review and boundaries

**Independent wrapper PASS is NOT final Chat PASS**. One independent READ-ONLY FULL CUMULATIVE exact SHA Code Review against base 7e03521158db16731801e55803dbb8c870f5288c must inspect the full cumulative C2/v1 diff at SHA 34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7, independently adjudicate any reviewer findings, and preserve exact Chat route chat-369. Do not reuse #401 review from prior SHA.

No merge approval, no official installer/legacy adoption, native helper signing, Runner/LaunchAgent/browser/CDP, Sandbox merge, real target activation, protected main/dev changes, Windows, Priceup, Clean Energy or Phase B actions. The only user-authorized iteration is 19/19; no implicit 20/20.
