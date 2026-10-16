# P3 macOS official installer / migration takeover — immutable iteration 1 report

## Identity and user-authorized scope

- project: `orchestrator-dev`
- Control issue: **224**, first implementation iteration **1/5**; same Codex session used for deterministic in-iteration fixes
- source repository: `jackie-water/ChatGPT-Codex-Orchestrator`
- task branch: `feat/macos-official-installer-migration`
- exact source SHA: `c4e99fb103563ea54a0a128ef79b93253e39fa93`
- exact stacked parent/source base: `a7eea5213d87440e7cdf351a5e9a1271439dd185` (independent PASS P2.2b.2, not merged)
- current Chat registered review_route: `chat-212`, with actual delivered user-role registration
- older historical issue #211 route `chat-165` preserved, no fallback
- Codex CLI `0.162.1` on Mac, same logical 1/5 session `01a143ca-eea3-7163-aef1-f67393b55146` continued for bounded deterministic fixes
- final Codex continuation exit code: `0`
- Control GitHub Windows-only run `38872724967` canceled before Mac implementation; no duplicate executor
- user merge approval: **NOT_GRANTED**
- independent near-final exact-SHA Code Review: **NOT YET REQUESTED** (candidate has deterministic blocking P3 completion gaps; REVISE)

## Files changed and completed first-iteration work

Exactly 10 P3-authorized files, **222 insertions / 9 deletions**, include:
- new `Install.command` and `install.sh`
- new `src/lib/macos-platform.mjs` and `tests/macos-platform.test.mjs`
- targeted `src/cli.mjs`, `src/lib/state.mjs`, bilingual locale files, `AI_INSTALL.md`, `tests/guided-installer.test.mjs`

Initial Mac official bootstrap shares the existing Node CLI and performs a read-only dry-run. Fixes validated Node major v21/v22/v24 parsing, local Git inventory target cwd (separate HEAD/status) and non-destructive dirty/untracked awareness, component-scoped HOME checks for private LaunchAgent XML renderer, reverse-DNS label validation and XML escaping, new Darwin setup action and bilingual approval, a recoverable WAITING status that does **not** claim a runner/real target was installed, and native migration conflict output. Windows Install.cmd and install.ps1 remained unchanged.

Read-only sandbox evidence: independent fake HOME reported no state directory created by dry-run (`mutations_performed=false`), and Node v24 prereq was initially incorrectly rejected, then corrected in same session. A valid label and non-home path were initially erroneously conflated, then corrected. Windows guided installer test now verifies all Windows action IDs while separately checking the Darwin-only setup approval action.

## Independent controller validation

- Native Mac Node v24.22.0, `node --test tests/*.test.mjs`: **207 total / 198 PASS / 0 FAIL / 9 expected platform SKIP**.
- Syntax checks for CLI/state/mac platform and focused tests: PASS.
- `git diff --check`: PASS.
- GitHub exact-SHA Development CI run **[38874822968](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38874822968)**: Ubuntu `node-tests` SUCCESS; `windows-static` SUCCESS; overall SUCCESS for `c4e99fb103563ea54a0a128ef79b93253e39fa93`.
- Source task branch HEAD and remote head equal `c4e99fb103563ea54a0a128ef79b93253e39fa93`, local worktree clean.
- Draft PR **#9** stacked onto base `feat/macos-postexecution-wrapper` (not protected `main`), stays DRAFT and unmerged.
- Mac's existing `~/.chatgpt-codex-orchestrator/instances/1832f0bb` and browser debug port 9333 were only probed read-only. No new LaunchAgent, runner registration, Control or Sandbox repo, real target modification, credential migration, installation or deployment.

## Chat deterministic adjudication: **REVISE (not PASS)**

Although first-iteration tests and CI pass, **P3 is functionally incomplete**. These are determinate missing original acceptance criteria, not a new product decision:

1. **Official macOS setup does not progress:** after one `macos_setup_approval` the Darwin CLI just saves `macos_native_setup=WAITING_APPROVAL_FOR_RUNNER` and returns `WAITING` indefinitely. It never proceeds through the same official `AI_INSTALL.md` Sandbox-first Control environment creation, generated private repo authorization, explicit Sandbox Chat registration, trust, or target-disabled gate. `Install.command` initially only did dry-run; `install.sh --setup/--resume` now calls the CLI but cannot install anything.
2. **No LaunchAgent lifecycle:** only a rendered plist string exists. No safely installed, started, stopped, inspected or recovered per-user LaunchAgent; no standalone Mac GitHub runner registration or meaningful ownership check. `macosRuntimeAction` mutating actions are permanent `NEEDS_APPROVAL` stubs. `status` can infer runner_running from mere path presence rather than a verified service. `repair` returns a generic action with no verifiable ID.
3. **Control workflow remains Windows-only:** generated template `templates/control-repo/orchestrator.yml.template` hardcodes `runs-on: [self-hosted, Windows, X64,...]` and PowerShell entrypoints, therefore a registered macOS runner could not service registration/Codex/review/merge. Add a separate Mac workflow variant and safe native dispatch, preserve Windows template unmodified.
4. **Migration takeover/rollback incomplete:** current inventory and conflict list are read-only, but no authenticated atomic migration preparation/ownership handoff/recorded rollback path or formal check that an old Windows runner is inactive. Never stop existing Windows runner automatically or overwrite callbacks/routes, browser profile, Codex settings/sessions, or credentials. Unknown ownership must remain blocked.
5. **Focused tests too shallow for P3 acceptance:** currently 4 basic native tests. Need synthetic fake HOME/gh/launchctl/control snapshots to verify positive and negative setup/resume progression, exact route and approvals, dry-run zero mutations, no double runner, profile/port collisions, target disabled until Sandbox COMPLETE, preservation of dirty/untracked and ambiguous callback state. Never run real installer or create private repositories during unit validation.

Next move: concise, delta-only successor P3 iteration 2/5 rooted at **exact source SHA `c4e99fb103563ea54a0a128ef79b93253e39fa93`**, same project/task branch/current `chat-212`. Keep completed P3 preflight code and previous P0–P2.2b.2 invariants. Controller owns routine validation; Codex must not commit/merge/deploy. Near-final independent exact-SHA Code Review remains required before future PASS.

No merge approval or real installer usage. Public Windows v0.1.0, main `85361876d587d824b18bf28e7367ef86c32040cf`, Priceup and Clean Energy, real target and private Sandbox were untouched.
