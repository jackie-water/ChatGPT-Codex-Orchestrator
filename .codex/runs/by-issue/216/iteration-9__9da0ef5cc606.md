# P2.2b.1 — Approved ninth implementation / immutable evidence

## Exact identity
- project: orchestrator-dev
- control_issue: 216
- user_authorization: ONE P2.2b.1 additional implementation rotation 9/9, explicitly approved in originating Chat
- project_default_max_iterations: 5 (unchanged)
- originating_review_route: chat-212 (verified actual user-role registration in this Chat)
- original Issue #211 legacy route: chat-165 (historical, untouched)
- source_repository: jackie-water/ChatGPT-Codex-Orchestrator
- task_branch: feat/macos-execution-lifecycle
- exact_final_source_commit: 9da0ef5cc606a801d906da680a16e34465a8b145
- immediate_parent_source_commit: ac4ca58036893e088d819762925e8019c4d537be
- reviewed_parent_before_iteration: 886f12a67e83dc696f5dd722992c590f67918685
- full_P2.2b.1_diff_base: b435f9620bd8235fb19ee2f424af10aa6ce34962
- Codex implementation session (single logical 9/9 iteration): 01a142ce-6b7a-7f82-b9ca-622fb14b2f6b
- Codex_cli: 0.162.1 on MacBook-Air.local; initial gpt-5.6-luna low; same-session continuation gpt-6.1-sol and gpt-5.6-luna low
- Codex final continuation exit_code: 0
- source_commit_chain_for_this_single_rotation:
  - ac4ca58036893e088d819762925e8019c4d537be: process group and fail-closed UNKNOWN supervision plus fault tests, GitHub CI 38847647062 node-tests FAIL / windows-static PASS
  - 9da0ef5cc606a801d906da680a16e34465a8b145: same-session narrowly scoped cross-platform process-tree test timing correction, CI 38847971019 both jobs PASS
- merge_approval: NOT_GRANTED
- independent_code_review_for_final_SHA: PENDING

## Verified narrow implementation scope
User explicitly approved deterministic P2.2b.1 fix after read-only review #215 found a reproducible timeout descendant bug at parent 886f12a....

On macOS, original runCodex() called child.kill(SIGTERM/SIGKILL) on only direct Codex child. Isolated temporary HOME/fake-Codex implementation proof showed a grandchild changing a mock Git clone AFTER wrapper returned TERMINAL_FAILURE. Ninth iteration changes only:
- src/lib/macos-codex-execution.mjs
- tests/macos-codex-execution.test.mjs

The native Mac Codex child now starts in a detached private process group with guarded group-PID signaling, scoped TERM then bounded SIGKILL escalation. A terminal timeout requires verified private group absence. If group signaling/probing fails or the group persists, the wrapper rejects with sanitized CODEX_TERMINATION_UNVERIFIED, persists ledger UNKNOWN and original registered Chat's source-SHA-less P1 PENDING incident when writable, and fails closed with durable run claim protection if persistence itself is unavailable. Existing executable realpath/ancestor trust, preclaim log directory setup, asynchronous log ENOSPC UNKNOWN, output redaction, idempotency and Windows adapter boundaries remain in place.

Fixture tests exercise ancestor-safe normal paths, fake descendant surviving SIGTERM, process-group cleanup, forced signal EPERM, SIGKILL failure, group liveness/probe uncertainty, callback identity, outbox and ledger write failures, rerun suppression, and no late mutation after wrapper returns. No real project, real Codex task, production callback browser or other product runner was used.

## Independent wrapper validation
- MacBook-Air.local: Node.js v24.22.0
- node --test tests/*.test.mjs: 172 total / 163 PASS / 0 FAIL / 9 expected platform SKIP
- node --check src/lib/macos-codex-execution.mjs: PASS
- node --check tests/macos-codex-execution.test.mjs: PASS
- git diff --check: PASS
- GitHub exact-source Development CI run 38847971019: node-tests SUCCESS; windows-static SUCCESS on 9da0ef5cc606a801d906da680a16e34465a8b145.
- GitHub earlier source ac4ca580... CI run 38847647062: node-tests FAIL only for fixture descendant sleep=1s racing the 1s SIGKILL grace on Ubuntu; existing Mac test suite passed. Under same authorized Codex session, fixture now schedules mutation after 3s and checks after return and after a 3.5s observation. It accepts fail-closed UNKNOWN where OS cannot verify process-group absence, never EXECUTED_UNVALIDATED; exact final CI is green.
- Windows-only GitHub Actions Control run 38846852742 for #216 was canceled BEFORE native Mac Codex execution to prevent a duplicate; cancel confirmed.

## Outstanding gates
Independent full-task read-only Codex Code Review must examine this exact final SHA (9da0ef5cc606a801d906da680a16e34465a8b145) against P2.2b.1 stacked base b435f9620bd8235fb19ee2f424af10aa6ce34962, with new registered route chat-212. Chat will independently adjudicate findings. Previous #215 independent review of SHA 886f12a... was read-only and independently reproduced, but writing its immutable review checkpoint was tool-policy-blocked; do not fabricate a checkpoint for that previous SHA.
P2.2b.1 review PASS is not merge approval. P2.2b.2 runtime independent wrapper/immutable completion callback, P3 installer, P4 supervisor, P5 live isolated Sandbox E2E and Windows regression, P6 release still pending. No merge/deploy/Sandbox activation/real target modification. Public main and Windows v0.1.0 preserved; Priceup and Clean Energy infra untouched.
