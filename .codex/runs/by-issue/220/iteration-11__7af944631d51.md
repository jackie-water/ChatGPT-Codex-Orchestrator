# P2.2b.1 — Human-approved iteration 11/11 immutable implementation checkpoint

## Pinned identity and authorization
- project: orchestrator-dev
- Control implementation issue: 220
- authorized implementation iteration: 11/11 (explicit user approval for ONE bounded correction; no iteration 12)
- configured default max_iterations: 5 (unchanged)
- source repository: jackie-water/ChatGPT-Codex-Orchestrator
- task branch: feat/macos-execution-lifecycle
- exact final source commit: 7af944631d5153dc4d4d87e7fdac8fa6124d85f8
- exact reviewed parent commit: d621599808feb7e04d8486d5fa6c165233ca3d7e
- full P2.2b.1 task diff base: b435f9620bd8235fb19ee2f424af10aa6ce34962
- current originating Chat review_route: chat-212 (delivered [CHAT-ROUTE-REGISTERED] user-role message)
- original historical issue #211 route: chat-165 (unchanged, never substituted)
- previous independent review checkpoint: ab7b9700eeed1a090e055f61443598981324d54a
- previous review path: .codex/reviews/by-commit/d621599808feb7e04d8486d5fa6c165233ca3d7e.md
- Codex implementation session: 01a142f1-dc1a-7d92-8ce2-b4a52bd87e1c (same session used for in-iteration test correction)
- native Mac Codex CLI: v0.162.1, gpt-5.6-luna low reasoning, workspace-write
- executor exit code: 0
- source commit status: pushed, clean task branch
- human merge approval: NOT_GRANTED
- independent exact-SHA Code Review: PENDING, requested as Control Issue #221, route chat-212

## Exact scope and deterministic correction
Changes relative to exact parent: ONLY
- src/lib/macos-codex-execution.mjs
- tests/macos-codex-execution.test.mjs

Diff stat: 79 insertions / 1 deletion.

Confirmed blocker from independent read-only full-task review #219: the detached private Codex process group's direct parent can exit 0 (or nonzero) while inherited-group background children continue operating, yet runCodex child.on("close") finalized immediately. A synthetic Mac fake Codex before this fix returned EXECUTED_UNVALIDATED in ~413 ms, then a descendant changed an isolated temporary Git clone afterward.

The new finishAfterClose path checks private process group liveness after direct Codex child close, and when needed signals only its own guarded detached group with TERM followed by bounded KILL and re-verification. Verified absence permits preserving the original parent exit result, including code 0 or nonzero. If process-group signaling/liveness cannot be conclusively verified, the existing sanitized typed CODEX_TERMINATION_UNVERIFIED path yields ledger UNKNOWN and a source-SHA-less original-Chat P1 PENDING failure outbox when durable writes are possible. It does not report false success or blindly rerun. Existing timeout handling, claim partial-write/fsync reconciliation, log ENOSPC UNKNOWN, executable ancestor permissions, private paths, redaction, immutable authority and explicit-route-v1 remain unchanged.

New isolated temporary HOME/fake Control+Git+Codex tests cover parent close with inherited-group descendant at exit=0 and exit=7, delayed attempted mutation after result, and cleanup signal denial producing UNKNOWN plus original Chat P1 and idempotent rerun rejection. Tests do not invoke a real Codex target or other product runners.

## Validation evidence
- Independent native Mac wrapper: Node v24.22.0, `node --test tests/*.test.mjs` **179 total / 170 PASS / 0 FAIL / 9 expected platform SKIP**.
- Node syntax checks for both changed files: PASS.
- `git diff --check`: PASS.
- A first test attempt had one incorrect assertion accessing result.state on the successful result where contract uses result.execution_state. Corrected in the SAME Codex session before commit/push; final full suite passed.
- GitHub Development CI run [38850538686](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38850538686), exact source SHA 7af944631d5153dc4d4d87e7fdac8fa6124d85f8: node-tests SUCCESS, windows-static SUCCESS, overall SUCCESS.
- Control Issue #220 Windows-only workflow 38850104800 canceled BEFORE native Mac implementation, run-codex job CANCELLED. Control Issue #221 Windows-only review workflow 38850584284 canceled BEFORE Mac independent read-only review, code-review job CANCELLED. No double Codex/review execution.
- Only fake Git repositories and temporary HOME were used for actual child lifecycle fixtures; real Sandbox/target, Priceup, Clean Energy, published Windows v0.1.0 and public main were not modified.

## Remaining gates
This report is immutable implementation evidence, NOT an independent Code Review PASS or merge approval. Independent read-only full-task review of exactly source 7af944631d5153dc4d4d87e7fdac8fa6124d85f8 from base b435f9620bd8235fb19ee2f424af10aa6ce34962 must be completed, findings independently adjudicated, and immutable review report published with its own checkpoint. P2.2b.2 runtime wrapper validation, success evidence and delivery, P3 Mac installer, P4 recovery supervisor, P5 isolated Sandbox live E2E and P6 release remain distinct phases. No source merge, production deployment, Sandbox activation, real-target change or public main update authorized.
