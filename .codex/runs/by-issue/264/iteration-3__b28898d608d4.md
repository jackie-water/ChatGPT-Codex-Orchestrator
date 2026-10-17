# Native Mac independent Code Review executor — deterministic revision 3/5

## Exact immutable identity

- Project `orchestrator-dev`, same originating Chat's **`review_route=chat-232`** under `explicit-route-v1`.
- Private Control existing work order **#264**, native Mac Code Review implementation **REVISE 3/5**, no duplicate issue or extra iteration. Project configured maximum iterations remains 5.
- Source repository `jackie-water/ChatGPT-Codex-Orchestrator`; task branch `feat/macos-native-code-review-adapter-20261017` (nonprotected, Draft PR #12).
- **Exact resulting source SHA `b28898d608d400a643e738f3b2144b284ba639eb`.**
- **Exact independently reviewed parent `ee5aa56711dd3a9208fe3b3a42de215fe851f826`.** The full adapter cumulative comparison base remains the previously independently reviewed P3 candidate `9203170f74b57dade7702fb0530e994ecf531c17`.
- Prior independent review: immutable checkpoint `7c79503b4b17ea77078eac768855bc74af6a6086`, `.codex/reviews/by-commit/ee5aa56711dd3a9208fe3b3a42de215fe851f826.md`, Chat adjudication REVISE for two independently confirmed credential/isolation P1 findings.
- Native Mac Codex CLI v0.162.1 implementation session **`01a14830-7d3d-7493-9520-cf971a417e5a`**, model `gpt-5.6-luna`, low/medium effort. Same session resumed for limited controller-discovered test/source edge corrections, no new CODEX-RUN, Codex did not run routine tests or commit/merge.
- All task writes remained in the separate Mac worktree `/Users/Jackie/Developer/ChatGPT-Codex-Orchestrator-MacCodeReview-20261017`, never on published `main`, P3 main task worktree, the retired Windows machine or the real Target.

## Exact implementation, allowed paths

Committed exactly **two files**, **54 insertions / 6 deletions**:

1. `src/lib/macos-code-review-runtime.mjs`: production `executeMacosCodeReview()` now calls exported `codexReviewArgv(...)` which includes `-c project_doc_max_bytes=0` alongside `--ignore-user-config`, `approval_policy=never`, `sandbox_mode=read-only` and explicit disabled plugins/apps/hooks. This prevents normal project instruction files from gaining authority over the independent reviewer while retaining exact source SHA and immutable evidence semantics.
2. Its exported `redactReviewOutput()` masks review child's stdout/stderr before any Git checkpoint report construction: GitHub token prefixes, bearer authorization, bounded credential-bearing key/value diagnostics in JSON, plain key=value, camelCase, snake_case, hyphenated and environment-style identifiers such as illustrative `apiKey`, `clientSecret`, `userPassword` or `OPENAI_API_KEY`. It preserves harmless identifiers and diagnostic text, correct 40-character SHA and 20,000-character maximum report text. All tests use **synthetic** values; no actual personal credential was accessed.
3. `tests/macos-code-review-runtime.test.mjs`: isolated fake child-review argv test proves the actual production argv builder includes all security flags. Synthetic stdout/stderr fixtures check conventional, quoted JSON, prefixed environment and camelCase credential fields are hidden, alongside negative harmless-prose examples; test also proves accurate SHA and ordinary words survive.
4. Same logical implementation session corrected deterministic test/API edges without intermediate SHA: initial standalone token regexp masked the harmless word after a value suffix, then added JSON value cases, finally consolidated credential key recognition by normalized naming segments and corrected a fixture expectation for the additional JSON field. Only final two-file candidate was controller-committed.
5. All prior reviewed exact-SHA git source ancestry, validated Sandbox-only active exact route, symlink-safe/no-follow checkpoint publication, hook-disabled push, publication intent isolation, failed-review nonzero workflow result and callback reconcile-only behavior remain unchanged. Native Mac Merge executor remains an explicit exit-78 placeholder.

## Independent controller validation

- Nonprotected task branch and **exact previous parent SHA** verified before the change; Git diff and staging allowlist precisely the two paths above. `git diff --check`, `git diff --cached --check`, `node --check`: **PASS**.
- After final adjustments, focused Mac review/bundle/refresh suite **135 tests / 135 PASS / 0 FAIL**.
- Final complete Mac Node test suite **358 total / 349 PASS / 0 FAIL / 9 expected platform SKIP**, process exit **0**, full wrapper log retained privately on Mac at `/private/tmp/mac-adapter-264-full-certified.log`.
- Independent READ-ONLY *uncommitted* pre-review discovered a source-only redaction gap for prefixed credential environment identifiers; controller independently proved the gap using fake strings, then corrected in **the same 3/5 implementation session** and reran complete tests. The pre-review is NOT a replacement for the new exact-commit independent full adapter review.
- [Exact-source GitHub Actions #39004663980](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/39004663980) **completed SUCCESS**; both `node-tests` and `windows-static` **SUCCESS**. The Windows job is GitHub-hosted static compatibility, not the retired physical Windows runner.
- Controller made a single normal non-force push of exact `b28898d608d400a643e738f3b2144b284ba639eb` to existing task branch. Remote branch verified identical, worktree clean, Draft PR #12 still OPEN/DRAFT/unmerged. Source public `main` remains `85361876d587d824b18bf28e7367ef86c32040cf`.

## Safety and next mandatory independent exact-SHA gate

- Actual private Control GitHub Actions workflow ID `373801036` stays `disabled_manually`, registered runners `0`, active Control jobs `0`. The native code review feature has **not been live-installed, run as an actual Control GitHub Actions job, or used to trigger genuine Chat user-role callback**. No real Sandbox `CODEX-RUN`, Code Review or merge, real Target activation, deployment, Priceup/Clean Energy or retired Windows runner activity.
- Other related branches are separate and unmerged: reviewed P3 core Draft PR #9 SHA `9203170...`, independent Issue #10 registered Chat callback Draft PR #11 SHA `e0ce4e79b9fb399028dd78a6f1516e54e71ec977` (review-only PASS), private Control Mac migration Draft PR #242; native Mac Merge adapter still `exit 78`.
- **Next** create independent `[CODE-REVIEW]` on private Control, **same exact `review_route=chat-232`**, exact new source branch and SHA. Native Mac independently review **the full cumulative adapter diff** `9203170f74b57dade7702fb0530e994ecf531c17` → `b28898d608d400a643e738f3b2144b284ba639eb`. Archive `.codex/reviews/by-commit/<new-SHA>.md` pinned to its exact checkpoint commit; Chat adjudicates PASS/REVISE/NEEDS_HUMAN. PASS is review-only, not merge. A deterministic REVISE successor, if needed, stays within 4/5 and is concise delta-only. Never merge without explicit user approval of exact source SHA or enable private workflow/runner before isolated full Sandbox verification.
