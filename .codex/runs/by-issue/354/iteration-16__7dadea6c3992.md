# Immutable implementation and independent wrapper evidence — Control #354

Project: orchestrator-dev
Exact registered review route: chat-333
Approved iteration: 16/16 (one-time human-approved narrow stale action revocation)
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Source task branch: feat/macos-short-turn-autoloop-20261018
Exact source commit: 7dadea6c3992dd190a455c4deb729f72639da680
Immediate predecessor commit: fba3850b98b6b42227e1a8f8586d42970afb01ce
Full cumulative Code Review baseline: 7223744265267b8043b78433324fca0ce1f355b5
Codex execution: local MacBook-Air.local gpt-5.6-luna medium, exit 0.
Executor log SHA-256: afed0aaf1b74ae9808c5fdee6eebc910231a96280e5985ba4141d39aeadb98d2

## Scope
Only src/lib/macos-short-turn-autoloop.mjs and tests/macos-short-turn-autoloop.test.mjs changed.
Every terminal evidence kind now atomically clears nextAction and old action outbox, archives revoked actions/outboxes and keeps immutable terminalEvidence plus separate resultOutbox PENDING under the task lock and journal transaction.
dispatchIntent, casRegisterNextAction and callback acknowledgement use a fail-closed terminal gate. No old protected action rearmed or emitted after SUCCEEDED, FAILED or UNKNOWN.
Normal nonterminal registered task and Chat-only flow remains supported; no live Codex execution was triggered by this feature.

## Independent wrapper PASS
| Validation | Tests | Passed | Failed | Skipped | Log SHA-256 |
|---|---:|---:|---:|---:|---|
| Source + test syntax checks | N/A | PASS | 0 | N/A | empty outputs |
| Focused short-turn | 24 | 24 | 0 | 0 | 4e1725b8ec093bde07f7979b211906b35a47ea437c6b0ad3855ec45754d8c4ca |
| Full default | 449 | 439 | 0 | 10 | 9eedac2a5c59fb67caae99ad9df3eb0302452ec6cd9cbe186a9eb4df080e42cf |
| Full serial | 449 | 439 | 0 | 10 | 7827c20f768f0da51ec1963fd1aa37d52d20864c3e07119cb1eb5f2bed8b9d11 |

## Independently reproduced security regression
Using ONLY a disposable macOS HOME and local signed test authorization, exercised 20 combinations: five terminal kinds (SUCCESS, FAILURE, VALIDATION_FAILURE, TIMEOUT, UNKNOWN) × protected CODEX_RUN or CHAT_CONTINUE × preexisting outbox absent/present.
All 20/20 PASS: terminalEvidence immutable, resultOutbox PENDING, stale nextAction/outbox cleared, dispatchIntent produced zero intents, new action after terminal rejected TERMINAL_ACTION_GATE, duplicate evidence rejected TERMINAL_EVIDENCE_IMMUTABLE and callback successor ack rejected TERMINAL_ACTION_GATE.
No real Chat callback or protected action was executed; all temporary files cleaned after probe.
Independent reproduction JSON SHA-256: 8f4437dee774b80118315bff92db06ef5dcf3902ed90145e4df6c542b22964dd.
Independent local wrapper-adjudication report SHA-256: 9fbb88303c3390464b8badeda7cf1a31ba4de4fda6e5302a15eded3fac9f7ab7.

## Hard gates
Wrapper PASS is not Chat final PASS or merge authorization. Independent full cumulative read-only Codex Code Review on this EXACT new source SHA is PENDING at evidence publication.
The macOS short-turn controller remains disabled/unbundled, official Runner disabled, signer provisioning absent. Old Control #332 route chat-303 unstarted. main/dev/Windows/Priceup/Clean Energy/actual target and native Helper 500ms PID safety untouched.
No merge, installer, browser delivery, Sandbox activation or live loop authorized by this report.