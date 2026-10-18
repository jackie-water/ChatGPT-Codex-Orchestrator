# Immutable macOS Phase B Sandbox Merge preflight iteration 3/5 — Control #329

- project: orchestrator-dev
- review_route: chat-303
- source_repository: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-sandbox-only-merge-20261018
- exact_source_commit: 0b3b30fd0f0def9adac45af60ce668b5f3340c07
- exact_parent_commit: c1e0641bb68b0342000aae248e47f28054f1121e
- phase_B_stage1_cumulative_base: 7223744265267b8043b78433324fca0ce1f355b5
- implementation_issue: 329
- iteration: REVISE 3/5
- stage: READ-ONLY Sandbox merge approval preflight ONLY
- implementation_wrapper_adjudication: PASS
- independent_Code_Review: NOT_RUN
- user_merge_approval: NOT_GRANTED

## Exact isolated Mac Codex implementation
- Native Mac Codex iteration 3/5 executor exited 0; log SHA256: e75f77968d1d4193eb5b1daf847f22688d69710d77cc1aff1d4cb4ed99db2e6b.
- Modified only src/lib/macos-sandbox-merge-runtime.mjs and tests/macos-sandbox-merge-runtime.test.mjs.
- Fixed false CHECKPOINT_DIVERGED when a genuine independent review checkpoint branch forks from default instead of reviewed task SHA. Strict reviewed SHA and checkpoint metadata check preserved; source must be descendant of default.
- Preflight now safely fetches exact, narrow, verified Sandbox default/source/checkpoint refs into local private automation clone, compares fetched local refs to pinned remote heads, fails closed on drift/missing object, no remote push/checkout/rebase/merge.
- Added temporary real bare-Git integration tests for independently forked valid checkpoint and stale local clone with remote updated after initial clone.

## Independent wrapper validation
- Focused default/serial each: 57 total / 57 PASS / 0 FAIL; syntax/diff checks PASS.
- Full default/serial each: 438 total / 428 PASS / 0 FAIL / 10 SKIPPED; source fingerprints match precisely before/after both modes.
- Focused wrapper terminal SHA256: 28fba9861600ccce5416c5e44e94553df30900bd15197a6157d933bdfc4f5706.
- Full wrapper terminal SHA256: 9689db05f259335815dfde79e8cfc5a91f3b11e65f1f7d9a51c92716b5fb9913.
- Source SHA identical to exact remote HEAD on the isolated task branch.

## Preserved invariants and gates
- The native merge entrypoint runtime/scripts/macos-merge-approved.mjs remains the unchanged three-line exit(78) stub, deliberately rejecting ALL actual merge attempts.
- No GitHub Actions merge job permission change, Control/Sandbox/Target mutation, runner enablement, official installer, LaunchAgent, browser/CDP callback, or any real Sandbox merge.
- Protected main/dev remain at 85361876d587d824b18bf28e7367ef86c32040cf; the human-approved macOS spike remains at 7223744265267b8043b78433324fca0ce1f355b5.
- Original native libproc 500ms one-shot PID identity contract and fail-closed scope preserved.
- REQUIRES independent read-only exact-SHA Code Review of whole Phase B Stage 1 delta from 7223744265267b8043b78433324fca0ce1f355b5 to 0b3b30fd0f0def9adac45af60ce668b5f3340c07, followed by Chat adjudication. Implementation PASS does NOT authorize merge.
- Later Stage 2 actual Sandbox push/job-scoped contents write and Phase C target activation require separate human security, exact SHA, and merge approvals; do not auto-dispatch.
