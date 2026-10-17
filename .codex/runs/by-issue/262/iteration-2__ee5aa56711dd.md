# Native macOS exact-SHA Code Review adapter — deterministic REVISE iteration 2/5

## Exact immutable identity and scope

- Project: `orchestrator-dev`, originating Chat explicitly registered `review_route=chat-232`, routing `explicit-route-v1`.
- Human-authorized continuation from private Control `[CODEX-RUN]` [#262](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/262), **iteration 2/5** on existing nonprotected task branch `feat/macos-native-code-review-adapter-20261017`; no additional issue/rotation.
- Source repository: `jackie-water/ChatGPT-Codex-Orchestrator`.
- **Exact source candidate SHA `ee5aa56711dd3a9208fe3b3a42de215fe851f826`.**
- **Exact prior independently reviewed source parent `5db7059a1daedc30bfec3cddfcabeef52751ade5`.**
- Adapter cumulative review base `9203170f74b57dade7702fb0530e994ecf531c17` — independently reviewed P3 core candidate.
- Prior independent Code Review checkpoint `1aa5ba2f7e658a48b7b749fe4b85332a5a17f15b`, report `.codex/reviews/by-commit/5db7059a1daedc30bfec3cddfcabeef52751ade5.md`, verdict **REVISE** for three deterministic security issues.
- Implemented by Mac native Codex CLI 0.162.1, model `gpt-5.6-luna`, original 2/5 session `01a1481f-c489-7522-b3b7-15aacca3932f` resumed for narrow deterministic corrections, low effort. During controller-mediated correction, an additional short local Codex session `01a14823-5544-7572-a72a-0ff4363ee5fa` also touched the **same uncommitted worktree** and was corrected by a subsequent resume of the original session; **no second CODEX-RUN Issue/iteration or intermediate source commit**. The controller alone staged, committed and non-force pushed the final exact SHA.
- Configured project max_iterations still 5; no merged or protected branch mutations. Native Merge adapter remains deliberate exit78.

## Three accepted security corrections and follow-up proof

Three permitted paths only, **86 insertions / 13 deletions**:
1. `runtime/scripts/macos-code-review.mjs`: detached checkpoint report publication now routes through `writeCheckpointEvidence`, performing symlink-unsafe path/refusal and exclusive review file creation rather than unguarded recursive mkdir/write. Existing report cannot be overwritten. Standalone checkpoint git push now explicitly uses `git -c core.hooksPath=/dev/null push` (nonforce; preserves checkpoint prepush remote head/CAS preflight). The report publisher's temp workspace uses canonical `fs.realpathSync(os.tmpdir())`, not Mac's default `/var` symlink alias.
2. `src/lib/macos-code-review-runtime.mjs`: validates source task branches as component-safe Git refs (rejects empty slash segments, dotdot, trailing dots, .lock, @{}, protected/main/default) before use in any Git remote queries. Official `codex/checkpoints` remains accepted as checkpoint branch. Implements `writeCheckpointEvidence`: verifies each ancestor component using `lstat`, rejecting symbolic links, foreign-owned or insecure non-system paths, then writes exclusive `0600` with `O_NOFOLLOW`, `fsync`. Allows only explicitly canonical system `/tmp` or `/private/tmp` when root-owned directory mode precisely `01777`; other group/world-writable path ancestors fail. Also canonicalizes detached read-only review workspace.
3. `tests/macos-code-review-runtime.test.mjs`: isolated Mac fixtures verify malformed/protected source refs rejected, tracked checkpoint symlink cannot escape into outside canary, existing immutable report cannot be overwritten, ordinary private checkpoint success, correct canonical Mac temp workspace root and narrow root-owned sticky temp exception, rejection of unrelated writable dirs. A temporary local bare Git repo with harmless pre-push canary confirms `-c core.hooksPath=/dev/null` blocks hooks, and a source-bound assertion ties the test to actual publisher argv. No real GH/network/Chat/browser/Codex review/Target mutations.
- All changes remain independent from separate Issue #10 reviewed SHA `e0ce4e79b9fb399028dd78a6f1516e54e71ec977` (Draft PR #11, unmerged) and already review-only PASS P3 SHA `9203170...` (Draft PR #9, unmerged).

## Independent controller/wrapper validation

- Branch/source parent exact `5db7059a1daedc30bfec3cddfcabeef52751ade5` verified before work; task allowlist precisely the above 3 files; git diff/staged diff `--check`, Node syntax checks PASS. Worktree clean after controller commit. Remote exact HEAD equals `ee5aa56711dd3a9208fe3b3a42de215fe851f826` after nonforce push; source `main` unchanged at `85361876d587d824b18bf28e7367ef86c32040cf`.
- Final focused native review/bundling/runtime refresh tests: **133/133 PASS, 0 FAIL**.
- Final complete native Mac Node suite: **356 total / 347 PASS / 0 FAIL / 9 expected platform SKIP**, command exit 0; detailed wrapper log on private Mac `/private/tmp/mac-adapter-262-full-final.log`.
- Native Mac preliminary independent READ-ONLY uncommitted-delta Codex session reported **no definite actionable bug** after deterministic sticky-system-temp fix; review sandbox could not create some temporary paths (EPERM) but actual unrestricted isolated wrapper tests completed. Preliminary review is not a final exact-SHA Code Review.
- [GitHub Actions exact SHA CI #39003504714](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/39003504714): **COMPLETED SUCCESS**, `node-tests` and `windows-static` jobs **SUCCESS**. Windows-static is hosted static compatibility only, **retired Windows physical runner not used**.
- [Draft PR #12](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/pull/12): HEAD exact SHA `ee5aa56711dd3a9208fe3b3a42de215fe851f826`, base P3 branch SHA `9203170f74b57dade7702fb0530e994ecf531c17`, still OPEN/DRAFT/unmerged.

## Safety and next exact review gate

- Actual private Control workflow ID 373801036 stays `disabled_manually`, registered runners 0, no active queue; no live Mac review worker/runner/LaunchAgent, real Sandbox CODE-REVIEW/merge, direct Chat callback, real Target activation, Windows/Priceup/Clean Energy actions.
- This is **implementation and isolated wrapper validation only**; not actual production Code Review adapter success or E2E PASS.
- **NEXT** create one `[CODE-REVIEW]` Control Issue with same exact `review_route=chat-232`, task branch and reviewed source SHA above; independently assess complete cumulative native adapter diff from P3 base `9203170f74b57dade7702fb0530e994ecf531c17` to `ee5aa56711dd3a9208fe3b3a42de215fe851f826`, and publish immutable by-SHA review evidence on `codex/checkpoints`. Chat independently adjudicates PASS/REVISE/NEEDS_HUMAN; any deterministic REVISE requires concise successor within existing 3/5 cap. PASS is review-only and never authorizes merging. No merge without explicit human same-SHA approval and dependency sequencing.
