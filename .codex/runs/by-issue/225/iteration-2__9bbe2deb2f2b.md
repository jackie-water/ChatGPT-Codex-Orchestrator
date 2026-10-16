# P3 macOS official installer — immutable implementation iteration 2/5

- project: orchestrator-dev
- source_repository: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-official-installer-migration
- Control issue: 225 (deterministic REVISE 2/5)
- reviewed parent: c4e99fb103563ea54a0a128ef79b93253e39fa93
- exact source commit: 9bbe2deb2f2bc9345baf23e686be6d2e1c518543
- reviewed work-package stacked baseline: a7eea5213d87440e7cdf351a5e9a1271439dd185
- originating registered Chat review_route: chat-212 (verified user-role receipt)
- Codex implementation CLI session: 01a143df-cc66-7290-bb44-40996f2c4167 (same session used for scoped fixes, not duplicate successor)
- Codex CLI version: 0.162.1, model gpt-5.6-luna, effort low; same-session continuation exit 0
- configured default implementation limit: 5
- merge_approval: NOT_GRANTED
- independent final exact-SHA Code Review: NOT YET REQUESTED, P3 incomplete

## Exact delta and retained safety

Nine allowed P3 native files changed compared with iteration1 parent (145 insertions, 20 deletions): src/cli.mjs, src/lib/control-env.mjs, src/lib/control-render.mjs, src/lib/macos-platform.mjs, new runtime/scripts/macos-dispatch.mjs, macos-code-review.mjs, macos-merge-approved.mjs, templates/control-repo/orchestrator.macos.yml.template, tests/macos-revise-iteration-2.test.mjs. GitHub Actions workflow is a Darwin-specific template with macOS/ARM64 self-hosted dedicated runner; original Windows template and Windows Install.cmd/install.ps1 unchanged. The workflow's trusted GitHub user now comes from installer-vetted static Control metadata/template rather than the issue author. The dispatcher uses one authorized plan, checks original Sandbox project enabled/real target disabled, invokes trusted Mac Codex executor then finalizer only on EXECUTED_UNVALIDATED, and stores original route. GitHub Actions runner_label remains historically codex-orchestrator-<id>; separate native per-user launch_agent_label com.chatgpt.codex.<id>. Native Code Review/merge entrypoints deliberately exit nonzero (78), do not false-PASS or merge.

The Darwin CLI now asks for explicit prerequisites and full ChatGPT GitHub connector authorization in addition to local gh; private repo access may NOT be inferred merely from gh repo view. Native LaunchAgent writes/launchctl actions require exact action-specific approval plus restricted Sandbox-only owner and path scope. No actual runner or service installed/started, no actual Mac target activated.

## Independent wrapper validation

Mac Node v24.22.0: `node --test tests/*.test.mjs` 211 total / 202 PASS / 0 FAIL / 9 platform SKIP. Syntax checks and `git diff --check` pass. First controller run exposed a static Windows label regression in control-render due using reverse-DNS for GitHub runner on Mac; same authorized second-iteration Codex session restored original runner-label contract and kept LaunchAgent label separate. GitHub CI run [38877306663](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38877306663) bound to exact 9bbe2deb2f2bc9345baf23e686be6d2e1c518543: Ubuntu node-tests SUCCESS; windows-static SUCCESS; overall SUCCESS. Local and remote task branch match exact SHA, clean worktree.

## Deterministic remaining P3 gaps — Chat verdict REVISE (NOT PASS)

This is intermediate source progress only. Native macOS setup/activation is still NOT complete, and the current implementation is NOT verified for real Control/Sandbox installation. The code-review and merge adapters intentionally fail closed; the Mac installation may not proceed to full E2E until authorized exact-SHA native adapters and Sandbox-only lifecycle are verified. Further deterministic work needed under same P3 authorization/cap:
- Verify Darwin shared Control/Sandbox preparation is safely resumable for partial states; avoid repeat creation, protect existing dirty destination and all callback/route IDs; never claim ChatGPT private repo OAuth verified on a boolean alone.
- Enforce real runner ownership/legacy Windows offline/refusal and per-instance LaunchAgent/private profile/port isolation with testable exact state transitions; make approval and rollback crash-safe.
- Native dispatcher should not construct or guess a clone path inconsistent with the official installer; derive verified original Control instance and exact mapped Sandbox clone, and use fail-closed original Chat incident evidence on pre-exec failure. No apparent source READY if never executed.
- P3 launchctl workflow still needs integration tests against fake HOME, Git, gh, Control and Sandbox (not real services). Current focused new tests are mostly static and do not show end-to-end CLI progress or launchctl idempotency.
- No Sandbox FULL E2E (P5) or Windows actual runner regression, and no merge permission.

No direct changes to Windows public main (85361876d587d824b18bf28e7367ef86c32040cf), published Windows v0.1.0, Priceup, Clean Energy, production runners, Sandbox/target live services or user secrets. Draft PR #9 remains DRAFT/unmerged, base feat/macos-postexecution-wrapper.
