# P2.2b.1 — Human-approved 10/10 immutable implementation checkpoint

## Exact identity

- project: orchestrator-dev
- Control issue: 218
- human authorization: explicit approval for **one** P2.2b.1 technical correction iteration 10/10 only; NOT merge approval
- configured project max_iterations: **5** (unchanged; manual exception limited to this work package)
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- task branch: feat/macos-execution-lifecycle
- exact source SHA: d621599808feb7e04d8486d5fa6c165233ca3d7e
- exact parent SHA independently reviewed before this correction: 9da0ef5cc606a801d906da680a16e34465a8b145
- full-task diff base: b435f9620bd8235fb19ee2f424af10aa6ce34962
- registered current Chat review_route: **chat-212**, actual delivered [CHAT-ROUTE-REGISTERED]; old Issue #211 historical chat-165 preserved and not redirected
- previous independent review checkpoint: d3154a21dac92ba7e93dda41d33d8b48579b1088
- prior review path: .codex/reviews/by-commit/9da0ef5cc606a801d906da680a16e34465a8b145.md
- native Mac Codex executor session: 01a142e5-4a19-7ff2-999e-e03eb5d9c2fa (same single tenth-iteration session reused for focused test correction)
- Codex CLI: 0.162.1, gpt-5.6-luna low, workspace-write
- Codex executor final exit: 0
- merge approval: NOT_GRANTED
- new exact-SHA independent Code Review: PENDING

## Source change under authorization

Only two source files changed versus exact parent:
1. `src/lib/macos-codex-execution.mjs`
2. `tests/macos-codex-execution.test.mjs`

Commit diff: **133 insertions, 2 deletions**.

Confirmed prior P1: the `claim()` helper opened an exclusive `wx` ledger then called `writeFileSync` and `fsyncSync` outside the guarded execution section. If either operation failed after file creation, the claim could remain `CLAIMED` without a durable original-Chat failure Outbox, silently blocking all retries. Independently reproduced on the exact parent before tenth iteration: injected `ENOSPC` on claim-fd fsync -> original `CLAIMED`, zero Outbox, thrown ENOSPC, no fake Codex launch.

This revision guards claim errors and discriminates `EEXIST` (immutable duplicate/uncertain state: NO mutation and NO second callback) from other I/O failures. For partial claim writes or fsync failures, the **immutable authorized snapshot** supplies project, issue, iteration and original Chat. A sanitized source-SHA-less P1 `PENDING` `EXECUTION_CLAIM_PERSIST_FAILED` incident is persisted, then ledger atomically reconciled to `UNKNOWN` when storage allows. If Outbox or ledger writes fail again, it throws sanitized typed `EXECUTION_CLAIM_PERSIST_FAILED`, preserving partial claim, prepared journal and/or durable P1 record; it never deletes the uncertain claim or triggers Codex. The no-retry contract still fails closed.

## Independent evidence and fault injection

- Mac fake Control / private temporary HOME / fake Git remote and fake Codex, no real target execution:
  - initial claim write ENOSPC: durable UNKNOWN ledger, one original chat-212 PENDING no-SHA P1 incident; fake Codex never launched
  - initial claim fsync ENOSPC: same
  - initial claim failure + Outbox JSON rename ENOSPC: sanitized exception, original partial/CLAIMED claim retained, prepared P1 journal retained for future recovery, no Codex
  - initial claim failure + UNKNOWN ledger rename ENOSPC: sanitized exception, original claim retained, one durable original-Chat Outbox incident, no Codex
  - preexisting exclusive claim: unchanged, no incident, no new Codex execution
- New checked-in regression cases cover all five scenarios, original Chat identity, sanitation and idempotent no-rerun.
- An initial attempt at two secondary-storage regression fixtures omitted the prerequisite claim-fsync injection; wrapper caught exactly those 2 test fixture failures (177 total/166 pass/2 fail/9 skip) **before any source commit**, and the same authorized Codex session made a narrow test-only correction. Final validation below is authoritative.

## Final wrapper validation

- MacBook-Air.local Node.js v24.22.0, `node --test tests/*.test.mjs`: **177 tests total, 168 PASS, 0 FAIL, 9 expected platform SKIP**.
- `node --check src/lib/macos-codex-execution.mjs`: PASS
- `node --check tests/macos-codex-execution.test.mjs`: PASS
- `git diff --check`: PASS
- source branch clean, exact source commit pushed to `refs/heads/feat/macos-execution-lifecycle`, public `main` unchanged
- GitHub exact-SHA Development CI run **38849532242**: `node-tests` SUCCESS and `windows-static` SUCCESS; overall SUCCESS on source SHA `d621599808feb7e04d8486d5fa6c165233ca3d7e`.
- queued Windows-only Control GitHub workflow `38848970224` for #218 was **canceled before** running native Mac Codex (run-codex CANCELLED) to avoid duplicate executor.

## Open gates

This checkpoint records code/validation, **NOT** a final Code Review PASS. A new independent **read-only** Codex Code Review must inspect the exact final source SHA `d621599808feb7e04d8486d5fa6c165233ca3d7e` and full P2.2b.1 task diff against base `b435f9620bd8235fb19ee2f424af10aa6ce34962`, using current registered route `chat-212`. Chat must independently adjudicate every finding. Source SHAs from earlier iterations do not authorize review/merge of this one.

No merge, no production deployment, no Sandbox merge, no target activation, no release. Windows v0.1.0 and public `main` unchanged; Priceup, Clean Energy, E2E Sandbox/real target projects unaffected. P2.2b.2–P6 remain subject to original phase boundaries and acceptance gates.
