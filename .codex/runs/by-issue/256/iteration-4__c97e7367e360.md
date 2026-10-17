# Immutable Issue #10 native Mac register runtime-bundle correction — iteration 4/5

## Identity and explicit authorization

- Project: `orchestrator-dev`, originating current Chat **`review_route=chat-232`**, `explicit-route-v1`.
- Private Control deterministic REVISE [#256](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/256); previous full incident review Control #255, exact previous review checkpoint `6d986dd6d3cad862c6dfd584d3931479e950a281`, path `.codex/reviews/by-commit/0dacd2149b79292359ec4d8347b71d55b452915d.md`.
- Source [Issue #10](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/issues/10), existing unmerged Draft PR #11, nonprotected task branch `fix/macos-chat-registration-offline-20261017`.
- **Exact committed source SHA: `c97e7367e36084e568987c07fe87405fed7b4951`.**
- Exact reviewed parent `0dacd2149b79292359ec4d8347b71d55b452915d`. Full issue #10 cumulative comparison base `f4c189962e94661d1f4dde06c798c476e2aa149b`. Independent already-PASS P3 Mac branch SHA `9203170f74b57dade7702fb0530e994ecf531c17` remains separate, untouched and unmerged.
- Native Mac Codex CLI 0.162.1, model `gpt-5.6-luna`, same logical Issue #10 rotation **4/5**, implementation session `01a147e0-4117-73f0-892d-9479e534086d`. One concise delta-only correction to a single independently confirmed P1 from predecessor review. Codex modified files only, controller verified and independently committed/pushed exact source SHA. Configured default `max_iterations=5` unchanged, no successor 5/5 created.
- No merge approval, runner/service install/start, Control workflow enable, real Sandbox CODEX-RUN/merge or target activation.

## Precise source change

Exactly **two files**, 10 insertions / 2 deletions:
1. `src/lib/control-runtime-bundle.mjs`: appended `register-chat-mac.mjs` to the explicit `SCRIPT_NAMES` official manifest. This makes the existing independently implemented runner-independent native Mac CHAT-REGISTER intake available at `scripts/register-chat-mac.mjs` within generated private Control runtime. It does not rewrite registration/route logic, add fallback Chat, enable GitHub workflow or cancel any Actions run.
2. `tests/control-runtime-bundle.test.mjs`: matches expanded manifest length; verifies Control-generated script is byte-identical with vetted source `runtime/scripts/register-chat-mac.mjs`, dependency/import closure contains only Node built-ins, no recursive copying, and its native executable reaches a deterministic argument/usage refusal in an isolated private fixture without external network.
- Both English/Chinese Project Instructions retain existing commands from the developer source checkout; this source change does not alter official installer contract or real instance config.
- Windows executable source/PowerShell and Code Review/Merge placeholder adapters remain unchanged.

## Independent controller tests and exact source CI

- Exact parent SHA and single task branch verified, source/remote branch head equal after non-force push; P3 and both default branches unchanged. Source task worktree clean after commit.
- Exactly two permitted modified paths, `git diff --check`, staged diff check, Node syntax for edited files: **PASS**.
- Native Control runtime bundler tests: **10/10 PASS**.
- Full native Mac Node suite: **346 tests / 337 PASS / 0 FAIL / 9 expected platform SKIP**, actual command exit 0. Controller full regression log `/private/tmp/orch-issue10-rot4-full.log`.
- Independent native READ-ONLY uncommitted delta pre-review found **no actionable correctness issue**; reviewer temp-dir fixtures restricted by its sandbox EPERM, while the independent controller executed the tests successfully. Local pre-review log `/private/tmp/orch-issue10-rot4-prereview.log`.
- [Exact-source GitHub CI #38998581515](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38998581515) **COMPLETED SUCCESS**, jobs `node-tests` and `windows-static` both SUCCESS (hosted static Windows checks, not the retired Windows runner).
- Source published Windows `main` remained `85361876d587d824b18bf28e7367ef86c32040cf`.

## Safety and next review-only gate

- Private Control GitHub Actions workflow ID `373801036` remains `disabled_manually` and registered runner count 0, active queue empty. No real browser/Chat callback, Mac runner start, modification of live private Control or real Target. Priceup/Clean Energy untouched.
- **Next:** issue independent read-only `[CODE-REVIEW]` request on SAME exact `review_route=chat-232` for exact source `c97e7367e36084e568987c07fe87405fed7b4951` covering full cumulative incident diff from `f4c189962e94661d1f4dde06c798c476e2aa149b`; publish immutable `.codex/reviews/by-commit/<SHA>.md` with evidence and Chat independent PASS/REVISE/NEEDS_HUMAN adjudication. If further deterministic blockers, at most iteration 5/5, delta-only, no duplicate or unrelated revision.
- Source Issue #10 Draft PR #11 remains unmerged and based on an older P3 SHA, so any later integration requires separately reviewed consolidation on a nonprotected branch. PASS never implies merge. Separate exact-SHA user approval required for any merge. No installer, sandbox E2E or target activation authorized.
