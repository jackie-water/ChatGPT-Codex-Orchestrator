# P3 macOS official installer / migration — immutable implementation iteration 3/5

## Pinned task identity
- project: orchestrator-dev
- Control issue: 226
- logical Codex implementation iteration: 3/5; no duplicate run
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- branch: feat/macos-official-installer-migration (unmerged Draft PR #9)
- reviewed parent source SHA: 9bbe2deb2f2bc9345baf23e686be6d2e1c518543
- exact iteration-3 source SHA: 587075b91dd38d074bf9336ae754e8211b66014b
- stacked PASS-reviewed P2.2b.2 base SHA: a7eea5213d87440e7cdf351a5e9a1271439dd185
- current originating review_route: chat-212, delivered user-role registration
- Codex CLI 0.162.1 on MacBook-Air.local, model gpt-5.6-luna, reasoning low
- native Codex implementation session: 01a1440f-f9c9-7dc2-a9b4-d9aebdf0f8a1; same-session deterministic corrections; final Codex continuation exit=0
- human exact-SHA merge approval: NOT_GRANTED
- independent full P3 exact-SHA Code Review: NOT REQUESTED (P3 incomplete, REVISE)

## Exact scoped changes

Five P3 surfaces modified (122 insertions / 8 deletions compared with parent):
- runtime/scripts/macos-dispatch.mjs
- src/cli.mjs
- src/lib/control-env.mjs
- src/lib/control-event-normalizer.mjs (minimal explicit immutable instance binding)
- tests/macos-revise-iteration-3.test.mjs

The generated private Sandbox clone now uses the exact instance-private automation path under ~/.chatgpt-codex-orchestrator/instances/<instance_id>/automation/sandbox-<id> rather than a mismatched historic folder. Source preflight now compares the bound project and exact registered private Sandbox repository and verifies both remote.origin.url and effective remote.origin.pushurl before starting Codex. The dispatcher rejects a wrong enabled project, instance ID, real target activation or Git destination; it attempts to preserve original-Chat source-SHA-less failure evidence through recordMacosPreflightFailure after an authorized plan is obtained, never claims READY without executor + finalizer.

Existing dirty/untracked and symlinked Control/Sandbox/target checkout paths are inspected before fetch/clone/metadata writes; repository creation remains private and belongs to the official installer, never a separate manual Sandbox. The Darwin CLI fixes the bootstrap ordering: initial GitHub/ChatGPT connection and current Chat URL are collected before generated-repo creation; **exact generated** Control and Sandbox repository access is a separate post-creation gate. A new generated_repo_authorization answer records exact installation ID, both repo names and actual current ChatGPT conversation URL, without deriving a fake review_route from URL text. Sandbox Chat route registration remains separate; an eventual actual [CHAT-ROUTE-REGISTERED] callback is required before Sandbox CODEX-RUN. The CLI cannot itself query the ChatGPT GitHub connector; real confirmation must be independently performed by ChatGPT via the connected GitHub integration, not guessed from local gh or user boolean.

## Independent controller evidence

- Mac Node v24.22.0, full `node --test tests/*.test.mjs`: **215 total / 206 PASS / 0 FAIL / 9 expected platform SKIP**.
- Dedicated P3 iteration-3 tests: **4/4 PASS** after in-session correction of stale static assertions. Behavioral temp-HOME child-process invocation of the actual `src/cli.mjs answer` confirms boolean and forged Control/Sandbox/Chat URL or pre-creation authorization are rejected; exact post-creation repo/Chat URL/installation ID binding persists, no fake Sandbox route is inferred.
- Syntax `node --check` for affected CLI/control/env/dispatcher/test files: PASS; `git diff --check`: PASS.
- Exact-source GitHub CI run [38883191490](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38883191490): Ubuntu `node-tests` SUCCESS, Windows `windows-static` SUCCESS, workflow overall SUCCESS for 587075b91dd38d074bf9336ae754e8211b66014b.
- Local worktree clean and remote task branch exact same SHA. Draft PR #9 remains DRAFT, base feat/macos-postexecution-wrapper, not main.
- Windows-only queued Control GitHub run 38877680114 for issue #226 canceled before Mac Codex, run-codex job CANCELLED; no duplicate implementation.
- No actual private repos, launchctl/LaunchAgent, GitHub self-hosted runner, browser profile, existing callback queue, Sandbox, real target, Windows production or secrets were mutated by this development iteration. All tests used fixture HOME/local Git.

## Chat verdict — REVISE, NOT PASS

This is immutable implementation evidence, not an independent review or merge approval. P3 has remaining deterministic blockers:
1. **Actual Sandbox-first installer lifecycle not yet validated:** prepareControlEnvironment is real-GitHub-capable but there are no comprehensive fake gh/Control/LaunchAgent integration tests of crash/resume/partial prepared state, and an installation-intent journal is not durable before side effects. The code can safely refuse a dirty partial checkout, but may fail to recover it automatically.
2. **Runner ownership and native service completeness:** per-user LaunchAgent registration/runner installation, action-scoped approval, browser profile/port collision and Windows runner ownership evidence need deeper behavioral testing and a resumable transfer/rollback contract; missing or unknown old runner ownership must block rather than be bypassed.
3. **Native read-only independent Code Review and exact-SHA merge workflow remain explicitly fail-closed stubs**; code-changing Sandbox acceptance cannot be completed until real native read-only reviewer and human-approved exact-SHA Sandbox-only merge are implemented and reviewed. No silent merge under any circumstances.
4. **Pre-execution failure coverage** for every invalid dispatcher state and full callback delivery/reconciliation with two Chats still requires integrated fake tests and P4/P5 later live verification.
5. Default project max_iterations stays 5; P3 iteration 4/5 should be concise delta-only work from exact SHA 587075b91dd38d074bf9336ae754e8211b66014b, review_route chat-212. Independent full-task near-final Code Review and explicit user SHA merge approval are separate future gates.

Protected public main stays 85361876d587d824b18bf28e7367ef86c32040cf; Windows v0.1.0, Priceup, Clean Energy and real target untouched. No merge, deployment, P5 live E2E or Sandbox activation performed.
