# macOS offline Chat registration and callback reliability — implementation revision 3/5

## Immutable source, route and execution identity

- Project `orchestrator-dev`, exact registered originating Chat route **`chat-232`**, routing `explicit-route-v1`.
- Existing private Control Issue [#238](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/238), an approved deterministic REVISE under Incident source [#10](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/issues/10) and root implementation #233.
- Source `jackie-water/ChatGPT-Codex-Orchestrator`, non-protected `fix/macos-chat-registration-offline-20261017`; Source Draft PR #11 remains open/unmerged.
- **Exact new source implementation SHA: `0dacd2149b79292359ec4d8347b71d55b452915d`**.
- Exact reviewed parent SHA `c208f4ac04026a984e7228f2dbe77a3a9b2f2527`; full incident cumulative base `f4c189962e94661d1f4dde06c798c476e2aa149b`.
- Independent previous incident review: checkpoint `ef095e34457be75f0b3256ab1d9464f6ffb142e0`, report `.codex/reviews/by-commit/c208f4ac04026a984e7228f2dbe77a3a9b2f2527.md` found queue ownership evidence, runner metadata, Windows directory fsync and lock replacement gaps.
- IMPORTANT RESUME: At the start of this Chat's continuation, the already-existing isolated Issue #10 worktree had **four uncommitted modified files on exact parent SHA**, apparently partially implemented in a previous operation. Controller DID NOT restart the completed predecessor iterations or overwrite that workspace. It inspected existing diff, tested it, then directed **one concise same-issue delta correction** for an independently confirmed signed Issue/title race to Mac Codex CLI 0.162.1, model `gpt-5.6-luna`, implementation session `01a147d8-6fde-7842-87db-296eaa44fd1b`. This completed the pre-existing logical **iteration 3/5**, without creating another Control CODEX-RUN or advancing iteration.
- Controller committed exact four-file changes and non-force-pushed the source task branch; Codex itself was not authorized to commit, push or merge. `max_iterations` remained the configured **5**.

## Narrow cumulative delta

Only four existing changed files, **75 insertions / 17 deletions**:
1. `runtime/scripts/register-chat-mac.mjs`: independent native private-Control GitHub Issue identity intake creates/reuses local route without Windows runner and **performs zero mutating GitHub Actions calls**. Queued Actions runs with absent signed Issue number are reported as `CONTROL_QUEUE_UNPROVEN_CANDIDATE`, not falsely attributed/cancelled. An active relevant run with matching signed issue ID but changed title now explicitly fails closed rather than bypasses concurrent-run refusal; exact signed same-Issue matching-title runs remain unresolved; foreign signed Issue and unrelated active work refuse. Multi-page runner inventory now requires known online/offline status, valid unique IDs, complete labels and installer-generated instance-scoped runner label; unknown/incomplete/cross-instance evidence refuses. Preserves no fallback Chat/origin discovery or runner startup.
2. `runtime/scripts/callback-delivery.mjs`: preserved per-callback lock, durable pre-click journaling and POSIX parent directory fsync. Win32 path explicitly skips unsupported directory open/fsync (while preserving file fsync and atomic rename); bounded power-failure limitation documented. Release checks opened lock descriptor identity against final lstat before unlink, refusing replacement; no stale lock auto-delete.
3. `tests/macos-register-chat.test.mjs`: isolated fake GH/Actions regression covers signed same-Issue changed title refusal, signed correct Issue unresolved, wrong signed issue refusal, unsigned same-title candidate warning, pagination and status unknown; zero real GH mutation and no route creation for rejected races.
4. `tests/callback-reliability.test.mjs`: mock win32 dir-fsync failure contract, POSIX callback state/lock identity and replacement fault, preserved no-double-send and trusted receipt semantics.

## Independent wrapper validation and CI

- Exact reviewed parent and task branch verified against GitHub before reuse; only four allowed files changed. `node --check` and `git diff --check` / staged diff check: PASS. Clean worktree after controller commit.
- Focused Mac callback + registration: **31/31 PASS**, 0 FAIL.
- Full Mac Node test suite: **346 tests / 337 PASS / 0 FAIL / 9 expected platform SKIP**; actual process exit 0, log `/private/tmp/orch-issue10-rot3-full-final.log`.
- Native independent READ-ONLY uncommitted-delta Codex pre-review: after the signed Issue/title guard correction, **no definite actionable regressions identified**. Read-only sandbox temp-directory creation was restricted, but independent controller tests fully executed, log `/private/tmp/orch-issue10-rot3-prereview-final.log`.
- Exact-source [GitHub CI Run #38998036318](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38998036318) **COMPLETED SUCCESS**, `node-tests` and `windows-static` jobs both SUCCESS; no retired physical Windows runner used.
- Exact source branch remote head verified `0dacd2149b79292359ec4d8347b71d55b452915d`. Published Windows `main` unchanged at `85361876d587d824b18bf28e7367ef86c32040cf`. Parallel P3 reviewed-PASS code candidate `9203170f74b57dade7702fb0530e994ecf531c17` remains on its own task branch without modifications.

## Safety, incomplete gates, next action

- Control workflow ID `373801036` deliberately `disabled_manually`, registered runners 0; real target must stay disabled until Sandbox verified; no Mac Runner/LaunchAgent installed or started. Priceup, Clean Energy, retired Windows services untouched.
- The implementation and wrapper evidence above are **NOT Code Review PASS**; create independent exact-SHA native Mac READ-ONLY Code Review on exact source commit `0dacd2149b79292359ec4d8347b71d55b452915d` across full cumulative incident diff from source `f4c189962e94661d1f4dde06c798c476e2aa149b`. Save immutable evidence, Chat independently adjudicates findings; if blocking deterministic REVISE, use max 4/5 successor with **delta-only** same `chat-232`, not another 3/5.
- Native Code Review and Merge adapters (currently fail-closed exit78) remain a **separate** implementation track. This incident branch is based on older P3 `f4c189...` and must not be blindly merged into newer P3 `9203170...`; future integration needs independent regression/conflict validation on a separate task branch.
- No source/Control `main` merge, Sandbox run/merge, live callback delivery, browser, deployment or real target activation authorized or performed. **PASS is review-only and never merge authority.**
