# P3 macOS migration / Windows compatibility — implementation rotation 12/12

## Immutable implementation identity

- Project: `orchestrator-dev`, exact current Chat's `review_route=chat-232` under `explicit-route-v1`.
- User expressly approved **one** extraordinary P3 technical correction **12/12**, not any new iteration, merge, installation, runner start, Sandbox merge, deployment or target activation. Project's configured default `max_iterations=5` remains unchanged.
- Private Control request: [Issue #251](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/251).
- Source repository: `jackie-water/ChatGPT-Codex-Orchestrator`; non-protected task branch `feat/macos-official-installer-migration`.
- **Exact source implementation commit: `82ad6ec436b33989298903d15215924c5892738d`.**
- **Exact independently reviewed source parent: `66d72b5a5c3dc0b7951a34da02b92a74bd01f8e0`.**
- Full cumulative P3 review base `a7eea5213d87440e7cdf351a5e9a1271439dd185` (not merely this small patch).
- Previous full-P3 read-only Code Review checkpoint `cbc1213a0d14d9ed79bc9715740e45cb66ded543`, path `.codex/reviews/by-commit/66d72b5a5c3dc0b7951a34da02b92a74bd01f8e0.md`, previous adjudication `NEEDS_HUMAN`.
- Mac native Codex CLI `0.162.1`, model `gpt-5.6-luna`, workspace-write implementation with low effort, **single Codex session `01a147b9-4ca9-7871-b29b-7b731db43dd2`**. A narrow delta-only continuation within the SAME session strengthened one fixture; no new CODEX-RUN/iteration, no Codex commit/push/merge.

## Precise scope and rationale

Only **two allowed source files** changed, **36 lines added / 0 deleted**:
1. `src/cli.mjs`: in the original **Windows** `runSetup` path's explicit `Object.assign(state,{...})` from the trusted `prepareControlEnvironment` result, persist `instance_platform: control.instance_platform` and `instance_arch: control.instance_arch`. `prepareControlEnvironment` already produces and independently writes these platform/arch fields into Control `instance.json`. Without persisted state fields, `refreshControlRuntime` `runtimeRefreshIdentity(state)` previously rejected valid freshly installed Windows state. Strict validation remains intact; no untrusted inferred values or new Windows runtime behavior.
2. `tests/control-runtime-refresh.test.mjs`: Mac-hosted **simulated Windows setup** test extracts and evaluates the actual Windows `Object.assign(state,{...})` block from `src/cli.mjs` in a bounded isolated Node VM, applies a trusted `win32/x64` fixture, then calls the actual `refreshControlRuntime` against a fake isolated Control repository/metadata and Git adapter. Matching identity succeeds; absent platform and mismatched arch refuse before fake Git mutations. All existing Mac and Windows/static regression fixtures remain.
- No Windows physical computer/runner, PowerShell execution or real installation. Mac path, trusted identity, Review/Merge exit-78 adapters, actual Control workflow, public source `main` and real Target unchanged.

## Independent controller evidence, not product PASS

- Exact source branch and remote parent verified before implementation and non-force push. After controller commit, local/remote task-branch SHA matched exact `82ad6ec436b33989298903d15215924c5892738d`; worktree clean.
- Changed-files allowlist: precisely two approved files. `node --check` and `git diff --check` / staged diff check: PASS.
- Focused Mac runtime-refresh test suite: **112 tests / 112 PASS / 0 FAIL**. The test executes the extracted real Windows setup mapping using Node VM; no retired Windows runtime touched.
- Entire Mac Node test suite: **343 tests / 334 PASS / 0 FAIL / 9 expected platform SKIP**, command exit 0. Full wrapper log retained Mac locally at `/private/tmp/p3-12-full-controller-251.log`.
- Independent preliminary native READ-ONLY review of uncommitted 12/12 delta reported **no deterministic correction**, but read-only Codex environment could not create temp directories for some tests (`EPERM`). This pre-review is NOT the final full-phase exact-SHA review. Actual controller tests completed.
- [Exact SHA GitHub CI run #38995952002](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38995952002): **COMPLETED SUCCESS**, jobs `node-tests` and `windows-static` both SUCCESS. `windows-static` is GitHub-hosted static Windows compatibility verification, not an execution on the retired computer.
- Source public `main` at `85361876d587d824b18bf28e7367ef86c32040cf` unchanged; P3 PR #9 remains OPEN/DRAFT/unmerged with exact head above.

## Preserved safety and next gate

- Private Control workflow ID `373801036` remains `disabled_manually`; isolated Control runner registrations `0`; old retired Windows runner deregistered; Control task queue empty. No real Sandbox-only CODEX-RUN, runner installation/start, LaunchAgent, actual original-Chat callback, Control/main merge, deployment, real Target activation or Priceup/Clean Energy operations.
- This report is **implementation validation only**, not P3 overall PASS, automatic Code Review PASS or any merge approval. Native macOS independent Review/Merge executor scripts remain deliberately fail-closed (exit 78), and official isolated live Sandbox-first multi-Chat E2E is not yet proven; separate Issue #10 callback-timeout work and private Mac-only Control Draft PR #242 remain unmerged.
- **Next:** independently review exact SHA `82ad6ec436b33989298903d15215924c5892738d` read-only across **the full cumulative P3 difference** from base `a7eea5213d87440e7cdf351a5e9a1271439dd185`; Chat adjudicate each finding as PASS/REVISE/NEEDS_HUMAN. User-approved 12/12 is exhausted; no successor CodeX-RUN or merge/activation without new explicit authorization.
