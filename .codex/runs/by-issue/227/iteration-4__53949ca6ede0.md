# P3 macOS official installer — immutable implementation iteration 4/5

## Authoritative identity and limits
- project: orchestrator-dev
- control issue: 227, one logical Codex iteration 4/5 (same-session bounded deterministic corrections)
- source repository: jackie-water/ChatGPT-Codex-Orchestrator
- source task branch: feat/macos-official-installer-migration
- exact final source commit: 53949ca6ede0072c996a84b0e524345fe757f0f9
- task parent before this logical iteration: 587075b91dd38d074bf9336ae754e8211b66014b
- in-iteration first commit: 8d1b473a3885680851d4475b0b3d0aa3a368d9c2 (full journal + LaunchAgent changes)
- final in-iteration corrective commit: 53949ca6ede0072c996a84b0e524345fe757f0f9 (unknown runner ownership response, same session)
- reviewed P2.2b.2 stacked base: a7eea5213d87440e7cdf351a5e9a1271439dd185
- registered originating Chat review_route: chat-212; historical chat-165 preserved separately
- Codex CLI: 0.162.1, native Mac session 01a14423-e29a-70a1-bb1b-704042f916cd, model gpt-5.6-luna low, same-session continuation exit=0
- configured task max_iterations: 5 (not exceeded)
- human exact SHA merge approval: NOT_GRANTED
- independent final whole-P3 Code Review: not yet requested (phase incomplete, REVISE)

## Scope of this iteration
Changes vs 3/5 parent are limited to P3 src/cli.mjs, src/lib/control-env.mjs, src/lib/control-render.mjs, src/lib/macos-platform.mjs, tests/macos-p3-journal-launchctl.test.mjs. Existing Mac official installer and shared Windows behavior preserved.

P3 private PREPARED migration intent now uses shared canonical 8-char installation identity consistent with official generated Control/Sandbox repository and per-instance path naming, saved at ~/.chatgpt-codex-orchestrator/instances/<exact-id>/migration-intent.json rather than an unsafe shared global file. Missing installation_id refuses timestamp fallback, private directories/files checked for symlinks, UID, modes, and atomic owner-only writes. Same exact installation/repo/path/source/destination ref/dirty count replay is idempotent; conflicting intent fails closed. No destructive rollback, source Git reset/clean, credential copy, or callback resend. It records identifiers, Git state and rollback intent without copying credentials.

LaunchAgent controller propagates injected fake commandRunner through migration preflight and launchctl checks; uses list and print proof and re-probes post start/stop. Unknown runner ownership does not start any service and returns NEEDS_USER_ACTION with action_id resolve_runner_ownership and launchctl_state=unknown. Unsafe/conflicting other cases remain ERROR. GitHub runner label remains codex-orchestrator-<id>, separate launch_agent_label com.chatgpt.codex.<id>; historical Windows defaultLocalPaths casing is preserved.

## Independent validation / exact CI
- Mac native Node v24.22.0: node --test tests/*.test.mjs -> 220 total / 211 PASS / 0 FAIL / 9 expected platform SKIP.
- Dedicated behavioral tests tests/macos-p3-journal-launchctl.test.mjs -> 5/5 PASS: exact8 per-instance identities, two journals isolation and stable replay, conflicting target refusal, symlink ancestor refusal, unknown launchctl state no bootstrap, post-start unverified state fails closed, Windows path casing.
- node --check on affected files and git diff --check: PASS.
- A prior in-iteration test attempt had 1 FAIL due missing launchctl_state="unknown"; corrected in SAME session, no iteration 5 consumed.
- GitHub CI run 38885477759 on exact source SHA 53949ca6ede0072c996a84b0e524345fe757f0f9: Ubuntu node-tests SUCCESS and Windows-static SUCCESS, overall SUCCESS.
- Local task branch HEAD and remote branch exact SHA 53949ca6ede0072c996a84b0e524345fe757f0f9, clean worktree. Draft PR #9 remains DRAFT, base feat/macos-postexecution-wrapper; protected main remains 85361876d587d824b18bf28e7367ef86c32040cf.
- Control Issue #227 queued Windows-only workflow 38883690707 canceled and run-codex job verified CANCELLED before native Mac 4/5 executor, no duplicate Codex.
- No real runner, LaunchAgent or browser profile installed/started, no Control/Sandbox live installation, no real target activation, no user credential access. Only isolated fake HOME/Git fixtures.

## Chat disposition: REVISE (not PASS)
The Phase P3 contract remains incomplete despite green CI. The official native installer has not demonstrated real Sandbox-first life-cycle under isolated fake services; migration PREPARED journal does not yet reconcile partial Control/Sandbox side effects into a full recoverable install; no authenticated official self-hosted native GitHub runner setup/ownership transfer; native read-only exact-SHA Code Review and exact-SHA Sandbox merge adapters remain deliberately fail-closed stubs. Live end-to-end Sandbox, multiple-Chat isolation and Windows actual runner regression belong to P5 and have NOT been performed. Missing old Windows runner ownership or callback delivery must not be bypassed.

P3 next implementation iteration 5/5 (last configured rotation) may address only deterministic completion gaps, on EXACT source 53949ca6ede0072c996a84b0e524345fe757f0f9 with same review_route chat-212. Do not merge or deploy; PASS requires verified tests, independent read-only Code Review of final exact SHA and no blocking findings. If fifth iteration cannot close P3 safety gates, return NEEDS_HUMAN, do not silently exceed configured 5 iterations.

Original Windows Install.cmd/install.ps1/PowerShell runner and public main untouched, likewise Priceup/Clean Energy production, private Sandbox and real E2E target.
