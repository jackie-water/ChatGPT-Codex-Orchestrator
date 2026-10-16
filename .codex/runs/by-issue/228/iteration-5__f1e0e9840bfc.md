# P3 macOS official installer — immutable fifth implementation checkpoint

- project: orchestrator-dev
- Control issue: 228
- implementation_iteration: 5/5 (the last iteration under the configured project maximum 5; no sixth authorized)
- exact_source_repository: jackie-water/ChatGPT-Codex-Orchestrator
- exact_source_branch: feat/macos-official-installer-migration
- exact final source SHA: f1e0e9840bfc62467af96d6bcc96c67f2bb0b516
- immediate source parent SHA: 53949ca6ede0072c996a84b0e524345fe757f0f9
- initial reviewed stacked parent before P3: a7eea5213d87440e7cdf351a5e9a1271439dd185 (P2.2b.2 PASS, not merged)
- registered current Chat route: chat-212 (true user-role [CHAT-ROUTE-REGISTERED] received)
- Codex implementation session: 01a14431-05f8-7f31-acc6-1ac33639e7e4 (same logical fifth iteration)
- Mac Codex CLI version 0.162.1 / model gpt-5.6-luna
- fifth iteration initial Codex exit code: 0, no CodeX Git commit/push/merge done by that session
- source commit chain of fifth logical iteration: existing 53949ca6... was present in repo on resume as a separately persisted narrow prior branch candidate, then this exact f1e0e9840bfc62467af96d6bcc96c67f2bb0b516 contains the fifth-session migration-intent evidence change. Source repository tasks remained on non-protected branch, no merge.
- exact-SHA merge approval: NOT GRANTED
- near-final independent Code Review: NOT YET COMPLETED
- Chat disposition: NEEDS_HUMAN (P3 functional acceptance incomplete and 5/5 rotations exhausted)

## Implementation / validation evidence
Final Codex revision augmented `src/lib/macos-platform.mjs` migration intent with preserved source/destination Git dirty/untracked status, registry bindings, callback/route state and Codex session inventory names; rejects ownership/symlink conflicts for an existing intent. This builds on earlier P3 increments: `Install.command`/install.sh official CLI invocation, native Darwin preflight/dry-run, private Control/Sandbox setup gate, runner label vs LaunchAgent label isolation, Mac-only Control template and native Sandbox dispatcher, exact static trusted GitHub owner, source/target-disabled validation, LaunchAgent conflict and ownership checks, and code-review/merge entrypoints explicitly fail-closed.

Independent Mac controller executed `node --test tests/*.test.mjs`: **220 total / 211 PASS / 0 FAIL / 9 expected platform SKIP** at current source content before final commit. Node syntax checks and `git diff --check` PASS. Codex sandbox itself had 23 fixture failures caused by lack of filesystem permission beneath the hard-coded HOME; these DID NOT reproduce on the actual Mac controller. The independent Mac suite is authoritative for this fixture.

GitHub exact-SHA CI run: https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38885832626, pending final result at evidence publication, never claim CI success without exact SHA. Local branch/remote task branch HEAD equals f1e0e9840bfc62467af96d6bcc96c67f2bb0b516; worktree clean and source main is unchanged.

## Remaining known P3 acceptance blockers
Even if GitHub Node and Windows CI are green, P3 **cannot be marked PASS**:
- Native self-hosted GitHub runner installation/registration, source ownership from active old Windows machine, unique existing Mac/browser profile/port and active runner conflict evidence are not fully wired into a complete non-destructive migration takeover with verified live lifecycle.
- Mac workflow independent Code Review and Merge approval scripts `runtime/scripts/macos-code-review.mjs` and `runtime/scripts/macos-merge-approved.mjs` still intentionally refuse with exit 78; this is safe fail-closed but cannot complete the required Sandbox-first E2E or human approved exact-SHA merge.
- Official native setup does not establish full Sandbox COMPLETE, verified callbacks and real-target activation path; target must stay disabled.
- Existing first-run partial Control+Sandbox repository preparation is not fully validated under crash/remote ambiguity using behavioral fake-GitHub/launchctl integration. The migration intent preserves evidence but does not constitute a proven coordinated handoff/rollback process.
- Current focused tests include basic synthetic P3 cases but no fully isolated end-to-end fixture proving authorized Windows->Mac ownership relinquishment, physical runner registration/start/stop, exact registered two-Chat callback, Sandbox-only Code Review and merge. These belong to P3 completion and P5 live E2E gating, not assumptions.
- Do not silently count a green CI or an explicit nonzero stub as product readiness. A sixth P3 correction requires a separate explicit user authorization, and any genuine platform/architecture ambiguity must remain NEEDS_HUMAN.

## Guardrails preserved
Windows v0.1.0 release and public protected `main` remain unchanged. No P3 launchctl runner was installed/started/stopped, no local credential store copied, no live private Sandbox merge, no real target enablement, no Priceup or Clean Energy production infrastructure changed. No merge/production deployment authority. Default P3 iteration cap remains 5. Current originating chat route `chat-212`, no default reviewer or Ponytail/origin discovery.
