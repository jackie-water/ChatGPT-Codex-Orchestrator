# macOS P3 iteration 9/9 — authenticated GitHub migration-owner correction

## Exact authorized implementation identity

- Project: `orchestrator-dev`; originating Chat registration and route: **`review_route=chat-232`**, `explicit-route-v1`.
- Authoritative private Control request: [Issue #245](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/245), created after explicit user approval for exactly one P3 9/9 deterministic technical correction.
- Source repository: `jackie-water/ChatGPT-Codex-Orchestrator`.
- Nonprotected source task branch: `feat/macos-official-installer-migration`.
- **Exact resulting source commit SHA: `47c2c8be34cff75989c59f21704f4c9a94325f6c`.**
- **Exact previous reviewed source parent: `eeb3a65f27a6f6b23744ba6adf8503519357f5e5`.**
- Prior independent full P3 review checkpoint: `405578c44d002ed8cfaada079c47af4ef2966570`, path `.codex/reviews/by-commit/eeb3a65f27a6f6b23744ba6adf8503519357f5e5.md`, verdict `NEEDS_HUMAN`.
- Full P3 independent Code Review diff must use cumulative base `a7eea5213d87440e7cdf351a5e9a1271439dd185`, **not** the last patch alone.
- Native Mac Codex CLI version 0.162.1, model `gpt-5.6-luna`, implementation session **`01a14788-c357-7963-a2f0-0826e82b2654`**, initially low effort and then same-session medium/low for precise deterministic test corrections. Codex was implementation-only; controller separately ran tests, committed and pushed. No extra iteration or new implementation session was started.
- The configured project default `max_iterations=5` remains unchanged. User authorized only this exceptional P3 9/9 rotation, not iteration 10, merge, runner start, installer activation or deployment.

## Precisely scoped source delta

Commit `47c2c8be34cff75989c59f21704f4c9a94325f6c` modifies **5 files, 22 additions, 9 deletions**:

1. `src/cli.mjs`: in Darwin setup, invoke the existing `control-env.mjs` authenticated `githubLogin` helper (aliased to avoid collision with the public `github-login` CLI handler) before preparing the migration journal. Carry the authenticated identity to `prepareControlEnvironment`; Windows setup remains unchanged.
2. `src/lib/macos-platform.mjs`: `prepareMigrationIntent` requires explicit, validated `state.github_login` rather than falling back to the target repository's owner; rejects missing or invalid login before writing any journal. An existing journal must additionally match the exact recorded **target repository** when reentered. All existing journal owner/source/destination/SHA checks remain; conflicts refuse silent retargeting and preserve the stored intent.
3. `src/lib/control-env.mjs`: `prepareControlEnvironment` independently revalidates authenticated GitHub identity against the login authorized for migration before any generated repository creation or clone.
4. `tests/macos-p3-journal-launchctl.test.mjs`: regression fixtures now use an explicit login, check owner-bound generated names, wrong-owner/changed-target refusal, missing/malformed login and existing journal preservation; symlink/instance isolation still covered.
5. `tests/macos-p3-setup-resume.test.mjs`: isolated fake `gh api user --jq .login` returns a deterministic trusted account while the target repository is in a different organization; confirms macOS setup still preserves Sandbox-first WAITING and idempotence. No real GitHub access in fixture.

During the SAME logical 9/9 session, independent controller first detected duplicate `githubLogin` syntax and unsafe test stubs, then a missing target-repository reentry comparison. Each deterministic issue was sent back as a concise delta-only same-session correction; no extra Codex rotation or separate implementation SHA was created.

## Independent wrapper validation and exact source CI

- Task branch, parent, exact remote HEAD, clean worktree after controller commit: **VERIFIED**. Push was non-force, limited to existing task branch; `main` unchanged.
- Allowed path allowlist: exactly the five paths above; `git diff --check`, staged diff and `node --check`: **PASS**.
- Focused macOS and runtime-refresh regression suite: **123 PASS, 0 FAIL**.
- Full Mac Node suite: **337 tests, 328 PASS, 0 FAIL, 9 expected platform SKIP**.
- Separate native read-only preliminary review of the uncommitted iteration delta: no definite new deterministic bug; does not substitute for full-phase exact-SHA independent review.
- [GitHub Actions exact source CI #38992529525](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38992529525): completed **SUCCESS**, jobs `node-tests` and `windows-static` both **SUCCESS**. `windows-static` is static compatibility validation, not a real retired Windows runner action.
- P3 source Draft PR #9 remains OPEN/DRAFT/unmerged; public Windows `main` unchanged at `85361876d587d824b18bf28e7367ef86c32040cf`.

## Safety state, unresolved gates, next exact task

- This evidence proves the 9/9 **implementation and controller test results**, **not** P3 product PASS.
- Legacy Control workflow ID 373801036 is `disabled_manually`; no Control runner is registered, Control task queue empty. No installation, launchctl service start, Sandbox merge, real target activation, deployment or Priceup/Clean Energy task was performed.
- Private Control macOS-only candidate PR #242 and separate source Issue #10 registration-timeout fix remain Draft/incomplete; target must stay disabled until isolated Sandbox verification.
- Native macOS independent Code Review and merge executor scripts remain deliberate exit-78 fail-closed placeholders; full official installer/Sandbox-first live E2E, multiple-Chat callback verification, and explicit exact-SHA Sandbox merge approval are not established.
- **Next required gate:** independent READ-ONLY Codex Code Review of the cumulative full P3 diff `a7eea5213d87440e7cdf351a5e9a1271439dd185` → `47c2c8be34cff75989c59f21704f4c9a94325f6c`, followed by independent Chat PASS/REVISE/NEEDS_HUMAN adjudication. PASS is review-only and never merges. The extraordinary user-approved 9/9 correction allowance is exhausted.
