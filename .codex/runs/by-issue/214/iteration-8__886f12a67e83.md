# P2.2b.1 — Human-authorized iteration 8/8 immutable implementation report

## Identity and authorization
- project: `orchestrator-dev`
- control_issue: `214`
- exact_work_package: `P2.2b.1`, implementation_iteration: `8/8`; **one additional iteration expressly approved by user in the originating Chat**
- default_project_max_iterations: `5` (**unchanged**)
- source_repository: `jackie-water/ChatGPT-Codex-Orchestrator`
- source_branch: `feat/macos-execution-lifecycle` (nondefault task branch, not merged)
- exact_source_commit: `886f12a67e83dc696f5dd722992c590f67918685`
- exact_reviewed_parent_source_commit: `2a4cf659dad3299de03f6621f6b3efb4492abb5f`
- independent_parent_review_checkpoint: `763de80cdf78d4ded97649a05ba7b428d398a77a` at `.codex/reviews/by-commit/2a4cf659dad3299de03f6621f6b3efb4492abb5f.md`
- task_full_diff_base: `b435f9620bd8235fb19ee2f424af10aa6ce34962`
- registered_current_review_route: `chat-212` (true user-role [CHAT-ROUTE-REGISTERED] callback; no fallback)
- original_issue_211_route: `chat-165` (old historical route unchanged)
- merge_approval: `NOT_GRANTED`
- independent_new_exact_sha_review: `PENDING`

## Mac Codex execution and exact code delta

- native Codex CLI: `0.162.1`, MacBook-Air.local
- model: `gpt-5.6-luna`, low reasoning
- Codex implementation session: `01a142a0-6db0-7760-be3f-5b8ce3107081`
- execution_exit: `0`
- reason for narrow revision: accepted active registered Chat URLs with trailing `/` were frozen raw by `src/lib/control-event-normalizer.mjs`, but `prepareFailureForAuthorizedSnapshot()` rejected them as noncanonical, causing source-SHA-less original-Chat failure callback loss. This was independently reproduced and adjudicated as P1 on preceding exact SHA.
- fixed: validate active registered Chat URL under existing strict allowed path/host contract, canonicalize its trailing slash *before* storing immutable authorized snapshot, leave originating Chat route/identity unchanged, and preserve fail-closed rejection for untrusted URLs.
- changed files **only** `src/lib/control-event-normalizer.mjs` and `tests/control-event-normalizer.test.mjs`; commit delta **29 additions / 4 deletions**.
- regression uses temporary HOME/fake Control registry, active trailing-slash Chat route, authorized snapshot, `prepareFailureForAuthorizedSnapshot`, persisted source-SHA-less P1 `PENDING` failure and identical replay reuse; rejects invalid external domain. Standard no-slash routes are covered by prior tests.
- previous P2.2b.1 executable path safety, private log initialization, async ENOSPC `UNKNOWN` failure evidence, and no-rerun behavior were retained without unrelated changes.

## Independent wrapper validation

- Mac Node `v24.22.0`: `node --test tests/*.test.mjs` -> **164 total / 155 PASS / 0 FAIL / 9 expected SKIP**.
- `node --check src/lib/control-event-normalizer.mjs`: PASS.
- `node --check tests/control-event-normalizer.test.mjs`: PASS.
- `git diff --check`: PASS.
- exact remote task branch `feat/macos-execution-lifecycle` contains source SHA `886f12a67e83dc696f5dd722992c590f67918685`; worktree clean after commit/push.
- GitHub CI: [Development CI run 38842858353](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38842858353), filtered by **exact SHA** `886f12a67e83dc696f5dd722992c590f67918685`: `node-tests` SUCCESS and `windows-static` SUCCESS.
- Old queued Windows-only Control run 38842490526 canceled **before** Mac Codex implementation, preventing duplicate execution.
- Synthetic tests never accessed real Codex task projects, real browser credentials, Priceup, Clean Energy, real E2E target or production runner.

## Open safety gates

- This is bounded implementation evidence, **not** independent Code Review or full product acceptance. Independent *read-only*, whole-task diff Code Review must target **exact source SHA `886f12a67e83dc696f5dd722992c590f67918685`** and be newly initiated with `review_route=chat-212`.
- P2.2b.1 `EXECUTED_UNVALIDATED` is an internal lifecycle state. P2.2b.2 wrapper-owned post-execution source SHA validation, immutable runtime success checkpoint and success callback remain outside this work package.
- No merge approved, no production deployment, no Sandbox merge, no real target activation, no modifications to published Windows v0.1.0 or `main`.
