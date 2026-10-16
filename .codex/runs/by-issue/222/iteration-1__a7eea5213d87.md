# P2.2b.2 — macOS post-execution wrapper, immutable run evidence

## Authoritative implementation identity

- project: `orchestrator-dev`
- Control Issue: `222`
- bounded work package: `P2.2b.2`, implementation iteration `1/5` (continued existing logical first iteration, not a second CODEX-RUN)
- current registered originating review_route: `chat-212` (verified user-role [CHAT-ROUTE-REGISTERED] message)
- original issue #211 historical route: `chat-165`, preserved without redirect
- repository: `jackie-water/ChatGPT-Codex-Orchestrator`
- task branch: `feat/macos-postexecution-wrapper` (nondefault, unmerged)
- exact final source SHA: `a7eea5213d87440e7cdf351a5e9a1271439dd185`
- reviewed stacked parent/base: `7af944631d5153dc4d4d87e7fdac8fa6124d85f8` (P2.2b.1 independent Code Review PASS, NOT merged)
- implementation commit: `ea5d426b103ffc1d0b0aaa383371ff631f256f2b`
- same-session deterministic Linux CI fixture follow-up commit: `a7eea5213d87440e7cdf351a5e9a1271439dd185`
- Codex CLI existing session: `01a142fe-2130-7bd1-a603-dfe21b0fb71f` resumed directly by the user in Mac Terminal, not a new session/iteration
- Codex CLI version: `0.162.1` on MacBook-Air.local, user-authenticated
- Codex session final message: work package changes completed; task-specific routine tests/commit/push were not performed within Codex
- exact Codex process exit status at the user's terminal: not independently captured; do not infer
- GitHub source branch remote and local worktree: exact final SHA, clean
- human merge approval: `NOT_GRANTED`
- independent exact-SHA Code Review: `PENDING`

## Bounded source changes

Against the independently reviewed stacked P2.2b.1 base the complete P2.2b.2 diff is 6 allowed files, **958 insertions / 7 deletions**:
1. `src/lib/macos-postexecution-wrapper.mjs` (new)
2. `runtime/scripts/macos-finalize-codex.mjs` (new)
3. `tests/macos-postexecution-wrapper.test.mjs` (new)
4. `docs/macos-codex-execution.md`
5. `src/lib/macos-codex-run-contract.mjs` (minimal trusted immutable plan addition)
6. `src/lib/macos-codex-execution.mjs` (minimal exact run-ledger linkage)

Wrapper binds post-execution to the immutable validated plan and `EXECUTED_UNVALIDATED` ledger, original project/issue/iteration, authorization digest, exact private clone, observed pre/post execution SHAs, and configured original Chat route, refusing unknown or mismatched state before Git mutation. Uses explicit trusted Git source and *push* URL validation, strict protected branch guards, symlink/foreign-owner rejection, separate finalization intent/journal, safe non-shell structured argv validation, bounded redacted evidence, verifier process-group supervision, clean source and SHA drift detection, first-create/fast-forward-only source task branch push and remote query after ambiguous response. Publishes exact per-issue/per-iteration/exact SHA report to the checkpoint branch without substituting latest-run, persists original-Chat `PENDING` callback (never asserts `DELIVERED` without user-role receipt), and preserves idempotency after interrupted publication or SUBMISSION_ATTEMPTED.

No source merge, target activation, Windows runtime rewrite or production browser callback delivery is part of this work package.

## Independent Mac validation / deterministic CI repair

- Mac local Node: `v24.22.0`
- Final exact-source Mac full test command: `node --test tests/*.test.mjs` — **202 total, 193 PASS, 0 FAIL, 9 platform SKIP**, verified by controller.
- The final fixture regression contains 23 standalone P2.2b.2 scenarios plus existing test coverage, using temporary HOME, fake Control and local Git bare remotes; no real GitHub network push or live Codex task.
- Syntax check of changed test file: PASS.
- `git diff --check`: PASS.
- An initial full-suite run for the test-only delta had one transient old P2.2b.1 log redaction fixture failure under parallel load (log empty after simulated 500 ms timeout). Rerunning the old focused suite: **32/32 PASS**. Independent repeat of the full default suite: **202 total / 193 PASS / 0 FAIL / 9 SKIP**. No production redaction logic was changed to hide the flaky observation.
- First implementation commit `ea5d426b103ffc1d0b0aaa383371ff631f256f2b`, GitHub CI `38855022024`: Ubuntu Node `20 FAIL`, Windows static `SUCCESS`. Ubuntu Node v22.23.3 `/opt/hostedtoolcache/node/22.23.3/x64` failed trust check `VALIDATOR_EXECUTABLE_UNAVAILABLE` in the *isolated test harness*, cascading across P2.2b.2 success/replay fixtures.
- Same logical iteration Codex test-only delta: single private Node binary copy under original runner HOME with private 0700 bin path prepended to fixture PATH; original environment restored and copy removed at suite end. Only `tests/macos-postexecution-wrapper.test.mjs` changed (**29 lines added, 1 removed**) relative to first implementation commit; **production executable trust logic was NOT loosened**.
- Final exact-SHA GitHub CI run **[38856179106](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38856179106)**: Ubuntu `node-tests` **SUCCESS**; `windows-static` **SUCCESS**; workflow overall **SUCCESS** bound to source SHA `a7eea5213d87440e7cdf351a5e9a1271439dd185`.
- The previous queued Windows-only Control GitHub Action for #222 `38851288847` was canceled before native Mac Codex to prevent execution duplication.
- Draft PR #8: `https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/pull/8`, BASE `feat/macos-execution-lifecycle`, HEAD `feat/macos-postexecution-wrapper`, DRAFT/unmerged.

## Not-yet-completed gates / scope limits

This is an immutable implementation report, **not** Chat PASS, independent Code Review result or merge approval. Independently review exactly `a7eea5213d87440e7cdf351a5e9a1271439dd185`, entire P2.2b.2 diff since `7af944631d5153dc4d4d87e7fdac8fa6124d85f8`; inspect implementation and wrapper evidence and independently adjudicate every finding. Source may not be replaced with older SHA `ea5d426...`. Default project max iterations remains 5. P3 native Mac official installer/LaunchAgent, P4 supervisor/outbox recovery, P5 isolated Sandbox full E2E and Windows regression, P6 docs/release remain separate gates.

No modification to Windows published v0.1.0, `main` (remote remains `85361876d587d824b18bf28e7367ef86c32040cf`), Priceup, Clean Energy, real E2E target or private Sandbox. There is no Sandbox merge, target activation, production deployment or public release.
