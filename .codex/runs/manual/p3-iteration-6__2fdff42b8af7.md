# P3 6/6 — user-initiated local Codex implementation checkpoint

## Exact identity

- Project: orchestrator-dev
- Original Chat registered callback route: `chat-212`; older historical `chat-165` was NOT reused
- Work package: P3 macOS official installer, user expressly approved ONE additional technical rotation 6/6; default automatic max_iterations stays 5
- **Execution mode: MANUAL USER-INITIATED Codex desktop handoff**, because the normal GitHub `[CODEX-RUN]` Issue creation was blocked by platform safety checks
- **There is no official Control `[CODEX-RUN]` issue/callback/report for this sixth rotation.** Do NOT fabricate one or claim automated runner execution
- Repository: jackie-water/ChatGPT-Codex-Orchestrator
- Source task branch: `feat/macos-official-installer-migration`
- Exact parent reviewed commit: `f1e0e9840bfc62467af96d6bcc96c67f2bb0b516`
- Exact implementation source commit: `2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8`
- Manual Codex main session: `01a14459-56f5-7ed2-92d6-5e5a2649f5e5`; isolated assistance sessions `01a14459-b0dc-7e72-9f6a-795b0652c383`, `01a1445b-4429-77c1-adb9-de981891cd68`, `01a1445c-9d4c-7321-a220-49c85023fb93`, all recorded task_complete in current Mac Codex sessions.
- User authorized local source changes ONLY, not merge/installation/deployment. The main session did not commit/push/merge. Chat controller performed independent validation, explicitly committed/pushed the six scoped files on the non-default task branch.
- No exact-SHA human merge approval granted.

## Exact source surfaces and result

Only six P3-scoped files changed relative to exact parent:
1. `src/lib/control-env.mjs`
2. `src/lib/control-render.mjs`
3. new `src/lib/control-runtime-bundle.mjs`
4. `templates/control-repo/orchestrator.macos.yml.template`
5. new `tests/control-runtime-bundle.test.mjs`
6. `tests/control-runtime-refresh.test.mjs`

Scoped source diff: **867 insertions, 212 deletions**, no unrelated repository changes.

**Prior independently confirmed P1 #1, `ERR_MODULE_NOT_FOUND`:** the generated Control repository lacked native `src/lib` transitive dependencies. The patch adds an explicit 34-file runtime allowlist (scripts + required native modules), validates full ESM import closure, rejects unsafe/symlinked/hardlinked/colliding source and target paths, and adapts the native imports to the generated Control tree layout. Initial installation and refresh now share validated runtime-file preparation. No credentials, arbitrary developer project files or sensitive session state are packaged.

**Prior independently confirmed P1 #2, macOS refresh overwritten as Windows:** the refresh workflow now validates persisted instance platform/architecture, GitHub owner, Control identity, native LaunchAgent label and runner label against immutable Control metadata. It refuses ambiguous/mismatched identities and selects the corresponding verified platform template, retaining macOS native workflow on repeat refresh and Windows renderer for verified Windows identity. Uses source+destination trust checks and exact Control remote/HEAD gates.

Native code-review and merge scripts remain deliberately FAIL-CLOSED exit 78, not implemented, and Sandbox-first real runner migration / E2E are NOT validated.

## Independent wrapper tests and GitHub CI

- Mac Node v24.22.0, `node --test tests/control-runtime-bundle.test.mjs tests/control-runtime-refresh.test.mjs`: **121 tests / 121 PASS / 0 FAIL**.
- Full Mac `node --test tests/*.test.mjs`: **334 total / 325 PASS / 0 FAIL / 9 platform SKIP**.
- `node --check` for changed JS modules/tests: PASS; `git diff --check`: PASS.
- GitHub Development CI exact SHA: [38891692612](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38891692612), overall **SUCCESS** on `2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8`; `node-tests` SUCCESS, `windows-static` SUCCESS.
- Local HEAD and remote task branch both `2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8`, Mac worktree clean.
- Protected public Windows `main` still `85361876d587d824b18bf28e7367ef86c32040cf`.

## Review and remaining hard gates

An independent read-only Codex review of the FULL P3 diff from `feat/macos-postexecution-wrapper` (base `a7eea5213d87440e7cdf351a5e9a1271439dd185`) used exact source `2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8`, session `01a14465-ea97-7f52-9bf7-b6a2dca744d5`, model gpt-5.6-luna medium, exit 0, source worktree unmodified. It reported two P1 candidates, adjudicated independently by Chat as one TRUE and one FALSE POSITIVE; see corresponding immutable review report.

- Confirmed P1: macOS `setup/resume` unconditionally returns `WAITING` after Sandbox preparation, even with `sandbox_verified=true`, so native installer cannot finish (preexisting P3 functional gap, outside the approved narrow two-P1 patch).
- Rejected finding: existing runner label `codex-orchestrator-<id>` and LaunchAgent label `com.chatgpt.codex.<id>` are distinct; isolated fake `launchctl list` showed own LaunchAgent is accepted; only an actual conflicting GitHub runner label triggers conflict.
- Independently known: native CODE-REVIEW/MERGE-APPROVE adapters are non-functional fail-closed exit 78, complete registered Sandbox live E2E and ownership handoff not done.

**Chat verdict for P3 overall: NEEDS_HUMAN, NOT PASS.** No seventh rotation authorized; no automatic Control issue/review route bypass, no merge or target activation. Previously verified code changes are retained on the task branch; no Windows production, Priceup or Clean Energy runtime changes.
