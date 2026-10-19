# Immutable implementation and independent wrapper evidence — Control #358

Project: orchestrator-dev
Exact registered Chat review route: chat-333
One-time user-approved modification iteration: 18/18
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Task branch: feat/macos-short-turn-autoloop-20261018
Exact source SHA: 59c626d7e4bfedce348c0543ab5327440f4907ba
Immediate reviewed predecessor: dcaeefe895ffca3e5338211e282510cb7c9f7e86
Full cumulative independent Code Review base: 7223744265267b8043b78433324fca0ce1f355b5
Executor: local MacBook-Air.local Codex CLI, model gpt-5.6-luna medium reasoning, exit 0.
Executor log SHA-256: b6752aa2396142a159bb185edb9acd3d0fb184ba6327ab90f2a504652f104eff

## Implementation: exact allowed surfaces only

Only src/lib/macos-short-turn-autoloop.mjs and tests/macos-short-turn-autoloop.test.mjs changed: 30 inserted and 3 removed lines.
Signed Ed25519 authorization scope.maxIterations is now required to equal the requested task budget before first task state.json/journal/outbox persistence. Mismatched budget emits SCOPE_BUDGET_MISMATCH instead of persisting an unreadable task. Independently unprovisioned Chat-only tasks continue without protected-action capabilities. No real signer key provisioned; no callback or Codex execution.
Native Helper PID identity 500ms, terminal stale-action revocation, signed route and receipt trust, journal CAS/outbox and callback four-state invariants preserved.

## Independent validation (PASS)

| Test | Total | Pass | Fail | Skip | Log SHA-256 |
|---|---:|---:|---:|---:|---|
| Syntax: ledger and tests | N/A | PASS | 0 | N/A | empty output |
| Focused ledger | 26 | 26 | 0 | 0 | 8225ff9f6cdeb052dc07b7f1794f24c88774197e6932a7cc47e430384f95118a |
| Full default | 451 | 441 | 0 | 10 | 6157dbae0d927b01e1774e93e4811c62e57470cb2207e0239bd9f253af5110ab |
| Full serial | 451 | 441 | 0 | 10 | 7b65b0b3e9043ec5f90ad5e8ff8f862647bb4ffc6c0a4b2e647226c62fcdfec0 |

Independent disposable Mac security replay: 6/6 PASS. Valid signed/requested 5/5 and 1/1 register and reload. Mismatches signed/requested 5/10, 10/5, 1/2 fail SCOPE_BUDGET_MISMATCH without any persisted tasks root, state, journal or outbox. A truly absent issuer preserves Chat-only task with no protected capability.
No real Chat message or Codex code execution occurred in this replay; temporary HOME and task files were cleaned.
Security replay SHA256 ac78ca48ef459847fd8453de546c9e046de0e4b30943b0b4a13404ba8384226a.
Independent adjudication SHA256 85f635387f9f447e9bfc10608b370ffe70c1ad3ce0366d08d201ed9dfe80b727.
Independent wrapper also verified exact task branch/HEAD, allowed file changes, unchanged Native Helper/CLI, and unstarted #332 on distinct chat-303.

## Gates

Isolated wrapper PASS is review-only. Mandatory independent cumulative full-diff Code Review on exact source SHA 59c626d7e4bfedce348c0543ab5327440f4907ba is PENDING as of this evidence report.
The new short-turn controller remains intentionally disabled/unbundled, official Runner and browser delivery disabled, no real trusted issuer keys provisioned. No source merge, formal installer or Sandbox/real target action authorized.
Source was committed and pushed to the isolated task branch only, with GitHub remote and Mac local exact SHA matched and worktree clean. Protected main/dev and Priceup/Clean Energy/Windows untouched.