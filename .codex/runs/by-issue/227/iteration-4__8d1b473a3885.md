# P3 macOS official installer — immutable iteration 4/5 implementation report

- project: orchestrator-dev
- control_issue: 227
- implementation_iteration: 4/5
- registered_chat_review_route: chat-212 (delivered real current-Chat registration)
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- exact_source_branch: feat/macos-official-installer-migration
- exact_source_SHA: 8d1b473a3885680851d4475b0b3d0aa3a368d9c2
- exact_parent_SHA: 587075b91dd38d074bf9336ae754e8211b66014b
- stacked_previously_reviewed_P2.2b.2_base: a7eea5213d87440e7cdf351a5e9a1271439dd185
- existing Codex CLI session: 01a14423-e29a-70a1-bb1b-704042f916cd (same fourth-iteration session, no new CODEX-RUN)
- original fourth-iteration parent immutable evidence: a19e87ca80869e95f29213660654e10d7e4d796c at .codex/runs/by-issue/226/iteration-3__587075b91dd3.md
- implementation_scope: P3 non-destructive installation intent, LaunchAgent state/runner ownership, exact instance identity
- default configured project iteration cap: 5 (unchanged)
- user merge authorization: NOT GRANTED
- independent exact SHA near-final Code Review: NOT YET REQUESTED
- Chat verdict: REVISE (P3 not yet complete)

## Implementation delta and source scope
Only 5 P3-authorized files changed versus reviewed parent: src/cli.mjs, src/lib/control-env.mjs, src/lib/control-render.mjs, src/lib/macos-platform.mjs, tests/macos-p3-journal-launchctl.test.mjs. Source commit diff: 146 additions, 18 deletions. The migration intent is now written before attempted Control/Sandbox mutations under instance-bound HOME path using atomic 0600 file and owner-only directory guards. It pins an eight-character canonical instance identity, exact Control/Sandbox names, source/destination references, dirty/untracked summaries, callback identity, and manual non-destructive rollback metadata. An existing prepared intent may be reused only for a matching identity; conflicts and symlinks refuse mutation. Historical Windows default local paths retain their original case where required; Mac/Control identity uses canonical lowercase.

The LaunchAgent native boundary adds injectable launchctl command adapter for isolated tests, detects unknown runner ownership and returns NEEDS_USER_ACTION action_id=resolve_runner_ownership and launchctl_state=unknown with mutations_performed=false, and verifies post-start/post-stop launchctl status. It still refuses unverified runners and does not stop legacy Windows services or activate the real target.

## Independent controller validation
- Native Mac Node v24.22.0.
- Focused synthetic P3 migration/launchctl tests: **5 / 5 PASS**, including instance identity, journal collision, symlinked ancestor refusal, unknown ownership/no bootstrap, post-start verification failure, historical Windows path casing.
- Full native `node --test tests/*.test.mjs`: **220 tests / 211 PASS / 0 FAIL / 9 expected SKIP**.
- `node --check` for P3 changed source/test files: PASS.
- `git diff --check`: PASS.
- GitHub Development CI for exact SHA: [38885079735](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38885079735), pending result at report creation. Do NOT claim CI PASS without verifying exact source SHA and both jobs.
- Task source branch local and remote both 8d1b473a3885680851d4475b0b3d0aa3a368d9c2, clean worktree after commit and push. No published Windows main or other project modifications.

## Remaining gates
P3 remains **REVISE**, NOT PASS. A remaining 5/5 deterministic revision is permissible only for the original P3 plan and exact current route. Key open work: (a) independent trusted evidence that existing Windows runner relinquished ownership before any Mac activation; (b) real official macOS Sandbox-first setup resume and native runner installation/safe launchctl semantics, verified against mocked GitHub/launchctl/Control and actual ownership/collision gates; (c) native review/merge adapters remain explicitly nonzero fail-closed, so full P3 workflow cannot yet complete; (d) preservation and idempotent recovery of callback queues, routes and existing migrated dirty/untracked project state with crash injection. P4 watchdog/recovery, P5 isolated live Sandbox E2E and Windows full regression, P6 release still pending.

PASS is review-only and would not authorize merge. No source merge to protected main, no Mac user service installed/started, no live Control/Sandbox/target bootstrap, no real-project activation, no Priceup/Clean Energy runner touched.
