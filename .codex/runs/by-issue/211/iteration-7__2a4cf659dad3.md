# P2.2b.1 — Issue #211 immutable iteration 7/7 implementation evidence

- project: orchestrator-dev
- control_issue: 211
- implementation_iteration: 7/7 (human-authorized for this exact work package; **not** iteration 8)
- project_configured_max_iterations: 5 (unchanged)
- source_repository: jackie-water/ChatGPT-Codex-Orchestrator
- implementation_branch: feat/macos-execution-lifecycle
- exact_source_commit: 2a4cf659dad3299de03f6621f6b3efb4492abb5f
- exact_reviewed_parent_commit: 5d870908b686ad71800e0d5ef083fa32b80b298b
- stacked_base: b435f9620bd8235fb19ee2f424af10aa6ce34962
- originating_review_route: chat-165 (immutable Issue #211 route; must not be changed)
- continuation_chat_route: chat-212 (separately registered and delivered; for **new** Code Review and future requests only)
- codex_session: 01a1423f-a686-7cf2-9adc-5a77ba7be27b (reused existing session, not a new CODEX-RUN)
- codex_cli: 0.162.1, authenticated local MacBook
- executor: Codex CLI on MacBook-Air.local; initial session gpt-5.6-luna, final same-session continuation gpt-6.1-sol
- codex_exit_code_for_continuation: 0
- wrapper_validation: PASS for bounded P2.2b.1 candidate, with caveats below
- independent_exact_sha_code_review: PENDING (must review whole task difference, including earlier stacked commits, bound to source SHA above)
- exact_sha_merge_approval: NOT_GRANTED

## Exact committed changes

Only two implementation surfaces changed in this commit (versus parent 5d870908b686ad71800e0d5ef083fa32b80b298b):
- `src/lib/macos-codex-execution.mjs`
- `tests/macos-codex-execution.test.mjs`

Diff stat: 187 insertions, 5 deletions. The local Codex output originally produced F1/F2 changes without committing. This Chat resumed the *same already-authorized seventh Codex session* to correct one additional deterministic in-scope log I/O failure; existing uncommitted changes were preserved and combined in one new source commit.

## Verified original findings and corrections

1. **Executable ancestor trust**: resolved Codex realpath, checks resolved target ownership/mode, checks resolved parent chain for untrusted writable directories, preserves narrowly trusted root-owned sticky `/private/tmp` boundary and private user-owned installs. Regression rejects 0777/0775 parent and unsafe executable targets before spawn.
2. **Pre-claim log directory failure**: prepares/checks `macos-execution-logs` before creating durable `CLAIMED` record; fake symlink and non-directory failures create exactly one source-SHA-less P1 `PENDING` incident for the immutable originating Chat without starting Codex.
3. **Post-execution log atomic persistence failure**: independent isolated failure injection (fake Codex exit, `renameSync` throws simulated ENOSPC only for log file) previously reproduced: uncaught exception escaped callback; execution Promise never settled, ledger stuck `CLAIMED`, failure outbox empty. The corrected callback rejects/settles; guarded lifecycle attempts source-SHA-less P1 failure persistence bound to original `chat-165`, writes ledger `UNKNOWN`, and does **not** falsely mark success or rerun the uncertain Codex task. Mock regressions exercise successful and nonzero child exits, original route retained despite a newer active Chat, no duplicate execution on retry, redaction, and outbox/ledger I/O degradation. If underlying storage prevents one or both durable writes, the function fails closed; the existing claim continues blocking re-execution and a prepared P1 journal may be recoverable. It does not pretend durable delivery occurred when storage remains unavailable.

## Independent validation

- Mac native Node.js: v24.22.0.
- `node --test tests/*.test.mjs`: **163 tests; 154 PASS; 0 FAIL; 9 expected platform SKIP**.
- `node --check src/lib/macos-codex-execution.mjs`: PASS.
- `node --check tests/macos-codex-execution.test.mjs`: PASS.
- `git diff --check`: PASS.
- GitHub Actions run `38841670909` on exact source commit `2a4cf659dad3299de03f6621f6b3efb4492abb5f`: **node-tests SUCCESS; windows-static SUCCESS**.
- Fixtures used only temporary HOME and fake executable / temporary Git repositories; neither the original Control registry, real target, Windows release nor Priceup/Clean Energy environments were used.

## Outstanding gates (do not overclaim)

- Independent read-only Codex Code Review of the **exact source SHA and full task diff** is still required, using *new* control request with review_route `chat-212`. Review outcome not yet adjudicated.
- This is only P2.2b.1 native Codex child lifecycle. `EXECUTED_UNVALIDATED` means P2.2b.2 independent wrapper validation, immutable runtime success publication and success callback are **not yet implemented**.
- P3 Mac installer/LaunchAgent, P4 durable supervisor/callback recovery, P5 isolated live Sandbox E2E and Windows end-to-end regression, P6 docs/release remain pending.
- PASS is review-only and **does not grant merge**. No merge, deployment, Sandbox activation, or modifications to real target / Windows v0.1.0 / public main.
