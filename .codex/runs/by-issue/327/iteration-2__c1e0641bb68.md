# Immutable implementation report — Phase B Stage 1 macOS Sandbox-only merge approval preflight

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- review_route: chat-303
- source_branch: feat/macos-sandbox-only-merge-20261018
- exact_source_sha: c1e0641bb68b0342000aae248e47f28054f1121e
- reviewed_cumulative_base: 7223744265267b8043b78433324fca0ce1f355b5
- iteration: REVISE 2/5; Control #327, previous issue #326
- status: IMPLEMENTATION_WRAPPER_PASS
- independent_Code_Review: NOT_YET_RUN
- merge_approval: NOT_GRANTED

## Implementation content
- Stage1 preflight module: src/lib/macos-sandbox-merge-runtime.mjs (new, from #326).
- Real local bare Git tests: tests/macos-sandbox-merge-runtime.test.mjs (new, from #326, corrected by Codex issue #327).
- Runtime preflight is read-only for remote state and does not push/merge, create callbacks, alter global GitHub permissions, launch Runner or install native Helper. The actual entrypoint runtime/scripts/macos-merge-approved.mjs remains unchanged and exits 78.
- Identity constraints: authentic trusted [MERGE-APPROVE] issue, private instance/projects/active exact route, Sandbox-only project/repo, exact approved source commit, default-branch ancestry, checkpoint review marker and exact SHA/source details, rejection of tampered reports, dirty/symlinked clone and untrusted origin/pushurl.
- Existing default refs main and dev, and macOS spike branch remain unchanged. No live Sandbox, real target, Windows, Priceup, Clean Energy, or production Runner operations.

## Codex and independent wrapper
- Codex implementation #327 terminal: short-turn-evidence/issue-327-macos-merge-preflight-fixture-revise-codex-v1/terminal.json; Codex exit 0. Executor log SHA256 df5a30317d330adca680bb95d24c541fa3a010ffc1cdfefb0475730a91623df7.
- Wrapper stage1: short-turn-evidence/issue-327-macos-merge-preflight-fixture-wrapper-stage1-v1/terminal.json; independent syntax and Git diff checks PASS; focused default and serial 54/54 PASS each; source fingerprint_verified true. SHA256 f18fcd029c2cf17abe0bfe02433c77f7b20c9561abd690ace7c9ca1cfdca3c55.
- Wrapper stage2 full-default: 435 tests total, 425 passed, 0 failed, 10 skipped; exit 0; log SHA256 602b045609aac6a3a53e17b0d54d8eccfb61f5fc5d3f301795c410f32ff70abc.
- Wrapper stage2 full-serial: 435 tests total, 425 passed, 0 failed, 10 skipped; exit 0; log SHA256 49d33b8b44644132e98d5ae388acee0a489cff2ffde7d27d67eb2e282707db67.
- Stage2 terminal state FULL_REGRESSION_FAIL is an independent wrapper bookkeeping false positive, NOT a test failure: wrapper assumed the task remote branch must be missing, but the parent candidate 12b9098082dedf391006e4d74c6009e79a88844d was intentionally published to it. Exact source SHA/fingerprint, full-suite zero-fail logs and protected branch refs reconciled independently.
- Durable signed-by-source reconciliation state FULL_REGRESSION_PASS_RECONCILED (NOT overwriting original terminal), short-turn-evidence/issue-327-macos-merge-preflight-fixture-wrapper-stage2-v1/reconciliation.json; SHA256 cf20eff2ac14006de1283a612189600edf1bfb5d7d23595e87b5c2f8441e66f0.
- Git source current exact SHA c1e0641bb68b0342000aae248e47f28054f1121e and clean task worktree, no post-test source mutation; only allowed cumulative files changed since 7223744265267b8043b78433324fca0ce1f355b5.

## Code Review and subsequent gates
- REQUIRED next: independent READ-ONLY exact-SHA Code Review of this whole Phase B Stage1 cumulative delta against 7223744265267b8043b78433324fca0ce1f355b5, and independent Chat adjudication of ALL findings. No review evidence for another SHA can be substituted.
- This report is implementation evidence, NOT Code Review PASS or human merge approval.
- Phase B Stage1 is preflight only. Running macOS Sandbox-only merge adapter remains blocked by exit 78 and merge-approved workflow job has no contents:write permission. Any future live Sandbox-only push needs a separate explicit security/policy approval, tested adapter, exact SHA review, and explicit user merge approval for the Sandbox target.
- Phase C post-Sandbox activation remains unsupported. Never bypass PROJECT_DISABLED and never touch the real target before installation Sandbox COMPLETE.
