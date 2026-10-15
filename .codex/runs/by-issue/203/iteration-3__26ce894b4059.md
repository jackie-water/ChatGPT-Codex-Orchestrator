# P2.2b.1 implementation issue 203 iteration 3/5
project: orchestrator-dev
source_branch: feat/macos-execution-lifecycle
exact_source_commit: 26ce894b40590b14c52dbc53e4a954a96e4df381
parent_commit: 710e5c12f68c785144255a66cde29dd99721d59c
stacked_base_commit: b435f9620bd8235fb19ee2f424af10aa6ce34962
registered_review_route: chat-165
Codex_exit_code: 0
Chat_result: READY_FOR_INDEPENDENT_CODE_REVIEW
merge_approval: NONE

Scoped changes: src/lib/macos-codex-execution.mjs, src/lib/macos-codex-run-contract.mjs, tests/macos-codex-execution.test.mjs.
Root defects addressed: execute uses private immutable approved plan snapshot rather than user-mutated planned.plan; execution ledger/automation/log instance_id bound to the first registered Control normalization instance identity, no unsafe second read of instance.json. Tests cover tampering plan fields and instance metadata after validation.
Independent Mac Node v24 wrapper: 152 tests total, 143 pass, 0 fail, 9 expected platform skips. All source syntax and diff checks passed. Exact source branch pushed and working tree clean.
Previous full P2.2b.1 suite uses disposable bare Git remotes, fake executable, no real cloud or browser: correct temporary repo success EXECUTED_UNVALIDATED, fail/timeout P1 terminal outbox source SHA unavailable, duplicate ledger idempotency, wrong Git origin / dirty/symlink clone rejection.
Unimplemented downstream steps: wrapper validation, source commit publication, immutable GitHub run report, exact-Chat success callback, full macOS installer, independent watchdog, Sandbox E2E. New exact-SHA independent Code Review needed. No merge or production activation.