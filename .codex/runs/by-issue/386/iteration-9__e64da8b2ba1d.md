# Immutable implementation evidence — Trusted Recovery Evidence v1, Control #386 (9/9)

Project: orchestrator-dev
Exact registered originating Chat review_route: chat-369
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Non-protected task branch: feat/macos-trusted-recovery-evidence-v1-20261020
**Exact committed and verified remote source SHA: e64da8b2ba1dea6c9569371bf6d513cba2106c0a**
Immediate committed predecessor: fd5102c5f4af8043c89c24c1352af1246f5b1dee
Full cumulative C2 + Trusted Recovery v1 baseline: 7e03521158db16731801e55803dbb8c870f5288c (not merged).
Previous C2 independent review checkpoint: 51bb2c1431845ca3e070a858db2187cb3d7a305d (ONLY for predecessor SHA).
Separate v1 initial task #378 followed by technical revisions #379–#386; current user explicitly approved ONE 9/9. All Codex edits executed on authorized MacBook-Air.local with explicit route chat-369. Codex did not commit or push. Independent wrapper committed and fast-forward pushed to task branch only AFTER all required testing and 26 offline adversarial cases PASS. Working tree clean and source HEAD/remote equal above exact SHA. Protected main/dev remain unchanged.

## Implementation and trust boundaries
New versioned source src/lib/macos-trusted-recovery-evidence.mjs and docs/recovery-evidence-v1.md, with Mac-only CLI integration, private Control repo metadata and original P3 tests. GitHub Control/Sandbox privacy/owner/repo IDs, exact explicit active route and GitHub Issue user/body/project/installation/Chat URL are checked against private Mac Control/migration/manifest fields with dependency-injectable external GitHub reads. No state-only trusted status. Direct issue creation and real installer/adoption were NOT performed. This iteration #386 changes strictly tests/macos-trusted-recovery-evidence.test.mjs versus prior uncommitted candidate to align the negative test's actual missing gate trusted_manifest_version; test still strictly requires NEEDS_HUMAN_LEGACY and mutations_performed:false for locally forged VERIFIED while offline.

Immediate task-branch commit changes eight paths: AI_INSTALL.md, docs/recovery-evidence-v1.md, src/cli.mjs, src/lib/control-env.mjs, src/lib/macos-existing-instance-recovery.mjs, src/lib/macos-trusted-recovery-evidence.mjs, tests/macos-p3-setup-resume.test.mjs, tests/macos-trusted-recovery-evidence.test.mjs.
Full cumulative diff from C1 base includes prior C2 tests (10 paths, 1224 additions, 26 deletions).

## Independent Mac wrapper validation
All tests executed under a private canonical disposable HOME, GH_CONFIG_DIR and installer state root; network auth variables removed; no real instance modified.
- Syntax/allowlist/git diff --check: PASS. Only test diagnostic expectation changed in this final 9/9 delta.
- Focused 35 tests / 35 PASS / 0 FAIL / 0 SKIP, log SHA256 e48058167e4c2bf5a9b5bf123afa3ec777a45424dc85fe0fa7a3cbaafb7d55dc.
- Default full Node tests 480 total / 470 PASS / 0 FAIL / 10 SKIP, log SHA256 0bd419f7b9d64e0f02879d18600e684840c6b6a8137d48dd7287f5670004441a.
- Serial full Node tests 480 total / 470 PASS / 0 FAIL / 10 SKIP, log SHA256 eac54ea6e26d7fbe8208797ff5230fa4cf0520f3667bd095545fcb8fe71287f1.
- 16 historical existing-instance scenarios: all denied safely without trusted v1 manifest, zero external commands, zero mutations, empty plan; SHA256 f7c7e285221883ac5776fc60a3937c2ba2cd23837360824ce7886be042b4b78e.
- 10 private hidden-directory/symlink/duplicate-route scenarios: all denied safely without trusted v1 manifest, zero mutations and empty plan; SHA256 f16de8b0e817fdc92955597fac8a70c4dd5de5cf8df0d88a4a97945df60ccd0c.
- Versioned v1 positive issue/receipt issuance and second/idempotent resume with mocked private GitHub provenance PASS in focused tests.
- Wrapper record SHA256 cccca632384e0ee4dfaa8e80d5df72f6f76a38e8d8e62c2d973319926fa434ae.
- Final uncommitted candidate byte fingerprint before task branch commit: e229d907142e01d65bfb19a013fbe6eba13a4d090fb0e8bac3e88c2c50b2f411.

Private Mac evidence directory: /Users/Jackie/.chatgpt-codex-orchestrator/instances/1832f0bb/short-turn-evidence/issue-386-trusted-recovery-v1-iteration-9/ includes accepted.json, prompt.txt, executor.log, focused.log, default and serial logs, both adversarial probes, independent-wrapper.json and candidate-commit.json.

## Remaining gate
**Implementation wrapper PASS is not final Chat PASS.** One independent READ-ONLY Codex Code Review must examine entire cumulative diff 7e03521158db16731801e55803dbb8c870f5288c to e64da8b2ba1dea6c9569371bf6d513cba2106c0a, reviewing private trust provenance, bootstrap and recovery, and independently assess each finding. Do not reuse the previous #377 review (different SHA). Chat arbitrates PASS/REVISE/NEEDS_HUMAN. The 9/9 budget is exhausted.

**NO merge approved. NO real installer, old instance migration/adoption, signer, Runner/LaunchAgent/browser/CDP, Sandbox merge, or target activation; main/dev, Windows, Priceup and Clean Energy untouched.**
