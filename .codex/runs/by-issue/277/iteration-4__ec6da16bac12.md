# Immutable implementation report — Control Issue #277 iteration 4/5

- Project: orchestrator-dev
- Registered explicit Chat route: chat-267
- Exact source branch: feat/macos-durable-submit-return-20261017
- Exact parent SHA: b6f8a230dadd58883d686894f8cbea5f3a5fc65b
- Exact new source SHA: ec6da16bac12df60d900a9608b248ab7b6409c3e
- Source repository: jackie-water/ChatGPT-Codex-Orchestrator
- Source changed paths: src/lib/macos-durable-intake.mjs, tests/macos-durable-intake.test.mjs
- Source aggregate SHA-256: 839f6931285f6b55bd73adfe3d9d16d3d5db6c28d4067cadf9f4c95e45e1403a
- Parent Code Review #276 immutable checkpoint: cd26a5be0d31b8c6397d14cc7a1d2adae319706e
- Corrective scope: validate intent before orphan-state reconciliation; durable worker/lock owner process identity rather than PID-only; RUNNING without claim is UNKNOWN, no Codex rerun.
- Codex execution exit 0, terminal EXECUTED_UNVALIDATED; wrapper independently verified exact file contents.
- Wrapper validation terminal: PASS, all syntax and Git diff checks passed.
- Focused tests: 14 PASS, 0 FAIL.
- Full npm tests: 359 total / 350 PASS / 0 FAIL / 9 SKIPPED.
- Focused log SHA-256: 60daa3003bf99e844febae1da3872448c37451844666c883c30519211bcf6d83
- Full log SHA-256: 80dca955b68d9463f11d6b4f48da39828124f5065e58e0493d36538e84e5aed2
- Validation terminal SHA-256: 7b91dbb1ca68e44559599d0625410fe0cf7e5a6aed3d025730a3f76f52e0c260

## Gates
Implementation and validation evidence only, not independent Code Review PASS. An exact-SHA independent review of ec6da16bac12df60d900a9608b248ab7b6409c3e remains required.
Control workflow/Runner remain disabled; Windows, Sandbox, real target and production infrastructure unchanged. No merge approval.
Explicit Chat route, exact commit identity, no callback fallback, no rerun on callback outage, exact-SHA human merge approval remain mandatory.
