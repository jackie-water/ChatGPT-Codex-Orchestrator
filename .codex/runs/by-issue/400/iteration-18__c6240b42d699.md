# Immutable implementation evidence — Trusted Recovery Evidence v1, Control #400 (18/18)

Project: orchestrator-dev
**Exact originating registered Chat callback review_route: chat-369**
Repository: jackie-water/ChatGPT-Codex-Orchestrator
Non-protected source branch: feat/macos-trusted-recovery-evidence-v1-20261020
**Exact committed and remote-verified implementation source SHA: c6240b42d699250aa814379d593eea252ce99366**
Immediate committed predecessor and previous independently reviewed source: 94c7bfbddd9c25a333efec9d8e26dd9009846e3d.
Full cumulative C2 + Trusted Recovery v1 review base: 7e03521158db16731801e55803dbb8c870f5288c.
Previous exact-SHA independent Code Review #398 checkpoint commit fa8e408c23221c4618255cd282ce6a6a19ff69d5; applies ONLY to predecessor SHA.
User explicitly authorized ONE REVISE 18/18; NO 19/19 or merge authority.

## Implementation scope and deterministic failure
Previously authorized REVISE 17/17 Control #399 had uncommitted 2-file candidate on exact predecessor SHA. Its scoped syntax checks passed but 169 focused tests showed 168 PASS / 1 FAIL, log SHA256 fbe2437bbdb1a85377d85af0680e8513fb9a4b4fc145cfe99b40e8833f706292. A private independent test-only diagnosis found its new macOS dry-run test's HOME was a symlinked os.tmpdir() alias /var on Mac, so safe_home refused; using fs.realpathSync(os.tmpdir()) then revealed missing private control-routing-migration-* identity snapshot, making existing-instance inspector report missing migration_snapshot_metadata and refuse earlier. A temporary copy with canonical HOME plus matching private migration snapshot returned the EXPECTED dry-run ERROR MACOS-TRUSTED-RECOVERY-EVIDENCE and passed 1/1 (log SHA256 0b1415505068fb856fb4c718fc1891eeb942d3f78add2bd04b3156a2468a7bd1).

The user approved one concise 18/18 delta **exclusively editing tests/dry-run.test.mjs**, not source. The predecessor authorized uncommitted patch SHA256 was 9b79bf9d74b6f3ebe70849c17d8185a72369d5d3a44570503a4ff09bb05129c8. This Codex 18/18 changed only the disposable test fixture: canonical macOS temporary HOME and a 0700 migration snapshot directory with 0600 coherent Control/instance/installation/Sandbox role identity before the deliberately malformed trusted receipt. Test still demands dry-run ERROR MACOS-TRUSTED-RECOVERY-EVIDENCE, empty plan and no mutation. Independently verified that `src/cli.mjs` uncommitted patch bytes remained EXACTLY identical to the previous authorized #399 candidate. Production fix remains limited to macOS-only structured loadState error, non-Darwin rethrow to prior global error handling, and fail-closed CONFLICT receipt refusal before any prerequisites.

The immediate implementation commit includes exactly these two files relative to predecessor SHA: `src/cli.mjs` (preserved prior user-approved #399 source correction) and `tests/dry-run.test.mjs` (corrected #400 fixture). Codex executor exited 0, timed_out=false, elapsed 21.07s, made NO commit/push; log SHA256 f6e3bbc0e9f0827c5de98af29954d97ef35575da8f6b6bf8cb9755e2ef4dd889. Independent wrapper, not Codex, created the exact task-branch commit and fast-forward pushed it to remote after all validation PASS, with clean working tree and verified matching HEAD.

## Independent wrapper validation — exact candidate source
All tests ran on MacBook-Air.local using private disposable canonical HOME and redirected GH_CONFIG_DIR and installer state, without GH/GITHUB/OpenAI credentials; no real installation or user instance was mutated.
- Strict edit scope, unchanged prior src/cli.mjs bytes, git diff --check, JavaScript syntax: **PASS**.
- Focused five-suite dry-run/C2/P3/trusted-recovery/runtime: **169 tests / 169 PASS / 0 FAIL / 0 SKIP**. Log SHA256 c86630059aab346273bc36f487677e8d5c1361dcca276720af2cb4fe7b9e7a93.
- Full default Node suite: **501 total / 491 PASS / 0 FAIL / 10 SKIP**, log SHA256 ff41d1f940ae8d51a07ea6fc8179b715905d17079463696adc4c6529b85d79ca.
- Full serial Node suite: **501 total / 491 PASS / 0 FAIL / 10 SKIP**, log SHA256 cd8a4550f05e610b010ff007a9e476dc11e9bdbeca0a1145a145ff163f9ac1df.
- Independently executed **30/30 private-HOME security checks** on this exact uncommitted candidate: 2 wrong-instance setup/resume structured fail-closed, 16 legacy/role/route/symlink scenarios, 10 hidden-profile/duplicate route scenarios, 2 callback Chat URL tamper/issuer scenarios. All refusals have zero external command mutations and no unauthorized route acceptance. Consolidated probe JSON SHA256 **27fcdf0bcae3b3be0011b4029247bac93049e649e5582f7ed05ca2ba3cf284ad**.
- Validated two-file source patch SHA256 **ad933e552822f06ec3a223d2f49a69458847c48398b9738450d7ff79d42ded13**.
- Independent PASS wrapper JSON SHA256 **78160ca55fc788d6beed9618e06fc4beafe5c47c5a0269063e7a2c6fc0c8e3aa**.

Local private Mac evidence: /tmp/trusted-recovery-issue-400-private/ (accepted/running/terminal, executor log, prior candidate patch, corrected source patch, focused/default/serial logs, independent security reports and wrapper JSON, candidate-commit.json). **This /tmp directory is ephemeral**; this immutable exact-SHA GitHub checkpoint is the durable report.

## Remaining independent safety gate
**Independent wrapper PASS is NOT Chat PASS.** One independent STRICTLY READ-ONLY FULL CUMULATIVE Code Review from exact base 7e03521158db16731801e55803dbb8c870f5288c through c6240b42d699250aa814379d593eea252ce99366 MUST run once, with same route chat-369. Chat independently adjudicates every finding. Previous #398 Code Review applies to a different SHA and cannot be substituted. The user authorized a maximum of 18/18; no automatic 19/19.

NO merge authorized; no official installer, legacy-instance migration/adoption, native signer, Runner/LaunchAgent/browser/CDP, Sandbox merge, target activation, protected main/dev edits or Priceup/Clean Energy/Windows/Phase B work.
