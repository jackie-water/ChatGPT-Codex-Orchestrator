# Immutable implementation checkpoint — Trusted Recovery Evidence v1, Control #389 (11/11)

Project: orchestrator-dev
**Registered exact originating Chat review_route: chat-369**
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Nonprotected task branch: feat/macos-trusted-recovery-evidence-v1-20261020
**Exact implementation source SHA, committed and remote verified: 841dedb5212d1f00d1ce109fcc91c87aa0c37854**
Immediate predecessor SHA: e64da8b2ba1dea6c9569371bf6d513cba2106c0a
Full cumulative C2 + Trusted Recovery v1 code review baseline: 7e03521158db16731801e55803dbb8c870f5288c
Previous exact-SHA independent Code Review #387 checkpoint: 59f3b0597daaf43064c34dbc9190cfca163e2dfc, applicable ONLY to predecessor SHA.
User explicitly approved one deterministic iteration 11/11. Control implementation issue #389. No implicit 12/12 or merge authority.

## Changes and security intent

Independently confirmed previous #388 failure: `canonicalLocalPaths()` in `src/lib/macos-trusted-recovery-evidence.mjs` derived the canonical Control clone via `defaultLocalPaths({home, installationId, projectKey: state.sandbox_project_key})`; an incomplete legacy/wrong-instance installer state omitted `sandbox_project_key`, causing Node `path.join(undefined)` TypeError before the existing C2 fail-closed refusal could be returned. Independent throwaway HOME diagnostic had setup/resume exit 1, empty stdout, no external commands and unchanged state; proof SHA256 5eeb92810131a4ad57fd588eb59dfa7479a181a1339ea83d88be1083e163be36.

The new implementation safely supplies a non-authoritative project placeholder solely for the *unused project path* in the existing official `defaultLocalPaths` derivation. **Canonical Control path remains exactly HOME/ChatGPTCodexOrchestrator/control-<historical installation short ID>, while the canonical Chat route file stays under that instance's root.** No missing project value is accepted as identity verification. Issuer and verifier still demand independently verified GitHub Control/Sandbox and active exact Chat route, private local provenance, root/path/no-follow ownership, and fail-closed legacy handling. The existing C2 negative tests now additionally assert both setup and resume have empty stderr, structured `MACOS-EXISTING-INSTANCE-REVIEW`, `mutations_performed:false`, unchanged state and no external calls.

Immediate source commit includes ONLY 5 modified paths: docs/recovery-evidence-v1.md; src/lib/macos-trusted-recovery-evidence.mjs; tests/macos-existing-instance-recovery.test.mjs; tests/macos-p3-setup-resume.test.mjs; tests/macos-trusted-recovery-evidence.test.mjs. The docs and P3 changes were retained *byte-for-byte identical* to the prior authorized #388 uncommitted patch; this 11/11 delta only corrected allowed verifier/test surfaces. Codex edited only, exited 0 without commit/push. Independent wrapper produced the commit and fast-forward push to task branch after all validations passed, and source local HEAD/remote match exactly.

## Independent wrapper evidence (MacBook-Air.local)

All execution used private canonical disposable HOME with GH_CONFIG_DIR and installer state redirected, and GitHub authorization/token variables removed. No real instance migration, installer, signing, Runner, LaunchAgent, browser/CDP or target activation occurred.

- Exact source scope, diff --check, JavaScript syntax, preserved prior non-delta file content: **PASS**.
- Focused Mac trusted-v1/C2/P3/dry-run: **36 total / 36 PASS / 0 FAIL / 0 SKIP**. Log SHA256 b92415c43811d64e6e7b4d646bdcb8112c41d10b501b950ad1e8549d2d993333.
- Full default Node test: **481 total / 471 PASS / 0 FAIL / 10 SKIP**. Log SHA256 4d77f1bd2340fd0e81754996e954e95c9fb5854ee0a2c1c63eddbca24f6896ab.
- Full serial Node test: **481 total / 471 PASS / 0 FAIL / 10 SKIP**. Log SHA256 d803066fcd50b20d746a5e7f33c0b4a518e0da61f21c076cd724eb6aa75bbc9f.
- Independent new wrong-instance child-process injection: **2/2 PASS**, both setup and resume return structured `MACOS-EXISTING-INSTANCE-REVIEW`, mutations:false, no stderr, external command false, installer state unchanged. Probe SHA256 eb7e8507facae16dfda15573aad092fbe6e0a8891461e520b4a42e780acb92f5.
- Independent legacy/repo-role/symlink/missing-proof boundary probe: **16/16 PASS**, all fail closed without v1 manifest, no external command, empty plan. SHA256 472643a8fc0127f7275a916404342b4982ef72661a40d978dd073917deafa364.
- Independent private hidden-path/duplicate-route probe: **10/10 PASS**, all missing-v1-auth refusals, no external command/mutations. SHA256 f104940c25bdc6ebc85fd5add299048c3c175eaa036824b372bef1c2a6eeadf0.
- Validated source patch SHA256 e8c09091325ba1d302ca97161eb8ab126306783015c5e90eb00ef6dd0ae9e425.
- Independent wrapper report SHA256 f2aaa8e1ae5d1cdb67134aa247a6bb9c9b47fc68b1d94195d850e2df4216c997.
- Local Codex executor log SHA256 aca537266096a71903c4fa794a57d44a1f7229ca1ac1f0513c87c6913a10c69c.

Private local evidence: `/Users/Jackie/.chatgpt-codex-orchestrator/instances/1832f0bb/short-turn-evidence/issue-389-trusted-recovery-v1-iteration-11/` (accepted.json, prompt.txt, terminal.json, executor.log, scoped wrapper, focused/default/serial logs, 28 adversarial probe logs and reports, candidate-commit.json).

## Mandatory remaining gate and prohibitions

**Independent wrapper PASS is not final Chat PASS.** One independent strictly READ-ONLY Code Review of entire cumulative code diff from SHA `7e03521158db16731801e55803dbb8c870f5288c` through this exact source SHA is mandatory, then Chat independently adjudicates each finding PASS/REVISE/NEEDS_HUMAN. Do not reuse #387 review for a different SHA. User authorized 11/11 only; further revisions require explicit separate approval.

**NO merge authorized**, no real installation/legacy adoption, no Runner/LaunchAgent, no signer, browser/CDP, Sandbox merge, real target activation, or protected main/dev edits. Phase B #332/chat-303, Windows, Priceup and Clean Energy remain untouched.
