# P3 Mac optional Git pushurl correction — implementation evidence 11/11

## Exact identities and authorization

- Project: `orchestrator-dev`, explicitly registered originating Chat route **`chat-232`**.
- Implementation request: private Control [#249](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/249). The user explicitly approved only ONE P3 exceptional technical revision 11/11, specifically fixing the absent optional `remote.origin.pushurl` argv index and its direct positive/negative tests. Project configured default `max_iterations=5` unchanged.
- Source repo: `jackie-water/ChatGPT-Codex-Orchestrator`; nonprotected source branch `feat/macos-official-installer-migration`.
- **Exact final source commit SHA:** `66d72b5a5c3dc0b7951a34da02b92a74bd01f8e0`.
- **Exact previously reviewed parent SHA:** `866add528c7bc0907b746cc53a4058c21809c019`.
- **Full cumulative P3 review baseline:** `a7eea5213d87440e7cdf351a5e9a1271439dd185`.
- Previous full P3 exact-SHA review checkpoint: `8275e093dd9c9d56318971f7af2eb0093af43032`, report `.codex/reviews/by-commit/866add528c7bc0907b746cc53a4058c21809c019.md`; verdict NEEDS_HUMAN.
- Manual native Mac Codex CLI 0.162.1, `gpt-5.6-luna`, low/medium reasoning, **same original single implementation session `01a147a6-c6b4-7ce1-8b96-70b674294792`** throughout narrow corrections. Codex edited source/tests; controller separately tested, committed, pushed. **No new CODEX-RUN or P3 iteration 12**.
- No merge permission, runner installation/start, Control workflow activation, real Sandbox CODEX-RUN, Sandbox merge, deployment or real Target activation granted.

## Precisely scoped implementation

- Final commit modifies **exactly two files**, 83 lines added/3 deleted.
1. `runtime/scripts/macos-dispatch.mjs`: `isOptionalPushurlQuery` matches exact `git -C <repo> config --get-all remote.origin.pushurl` argument shape, not the previous wrong `args[1]` interpretation; `normalizeOptionalPushurlResult` allows **only** exit status 1 with empty stdout/stderr for that exact optional query. Other Git queries, nonzero statuses, errors, nonempty output and wrong/multiple/malformed remotes remain fail-closed.
2. To make the test exercise the real dispatch logic, the production `main()` calls the extracted `validateSandboxRemotes(repo,expected)` using the same normalized `spawnSync`, after existing exact Control/registered project/Sandbox/clone identity checks. Any failure still goes through `failPreflight` and durable failure machinery. The helper requires a single matching GitHub `origin.url`, and exactly one effective GitHub `pushurl` or the single verified fetch URL fallback.
3. `tests/macos-revise-iteration-3.test.mjs`: direct production-helper integration with a temporary **local** Git repo and no network: normal absent pushurl passes; correct explicit pushurl passes; wrong/multiple/malformed pushurls fail; missing/multiple/wrong fetch origin fail; status2, stderr, spawn failures fail; exact command args observed, no Codex invocation. Small JS template delimiter and fake-Git remote setup mistakes were corrected **in the same approved 11/11 Codex session**.

## Independent controller wrapper validation

- Original two-file change scope verified exactly; non-force push to same nonprotected branch; parent exact `866add528c7bc0907b746cc53a4058c21809c019` and remote source SHA verified `66d72b5a5c3dc0b7951a34da02b92a74bd01f8e0`; clean worktree afterward.
- `node --check` on both modified files: PASS; `git diff --check` / staged diff: PASS.
- Focused Mac dispatcher and Control bundling suite: **21 tests, 21 PASS, 0 FAIL**; includes actual temporary local Git repository and negative injected subprocess results.
- Complete native Mac Node suite: **342 tests, 333 PASS, 0 FAIL, 9 expected platform SKIP**.
- One shell wrapper using zsh erroneously assigned to readonly shell variable `status` AFTER Node finished; this caused a **wrapper-command** exit 1 despite the already completed test process and its complete 342-test **0 FAIL** log. This is not a source/test failure and was explicitly disclosed to the user; test log preserved at `/private/tmp/p3-11-controller-full-249.log`.
- Independent READ-ONLY uncommitted-diff Codex pre-review session `01a147af-60d0-76b2-af60-2bb702fffc2b` reported **no actionable correctness issues**. It could not run some temp-dir tests inside its restricted read-only sandbox (EPERM), whereas controller's unrestricted isolated tests ran to completion. The pre-review is not the final exact-SHA full P3 Code Review.
- [GitHub CI #38995083043](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38995083043), exact source SHA above: **COMPLETED SUCCESS**, both `node-tests` and `windows-static` jobs SUCCESS. Windows-static is GitHub-hosted/static compatibility only; no retired Windows-machine runner was used.
- Public source `main` remains at `85361876d587d824b18bf28e7367ef86c32040cf`; P3 Draft PR #9 remains OPEN/DRAFT/unmerged with latest source SHA.

## Safe state and next mandatory gate

- Private Control workflow ID 373801036 remains `disabled_manually`; Control runner count 0 and task queue empty. Private Control main unchanged. Retired Windows runner remains deregistered.
- Native Code Review/merge adapter scripts still intentionally exit 78; official Mac full isolated Sandbox live E2E, multi-Chat callback, explicit same-SHA Sandbox merge approval and target activation remain unverified. Separate Issue #10 callback timeout remediation and private Mac-only Control Draft PR #242 remain independent and unmerged.
- This is implementation + wrapper validation evidence, **not P3 PASS or merge authorization**. NEXT: independent native Mac READ-ONLY full-cumulative P3 Code Review from exact base `a7eea5213d87440e7cdf351a5e9a1271439dd185` to exact SHA `66d72b5a5c3dc0b7951a34da02b92a74bd01f8e0`, preserve immutable exact-SHA review report and Chat adjudicate every finding PASS/REVISE/NEEDS_HUMAN. No further P3 coding iteration or merge permitted without fresh explicit user consent.
