# Immutable implementation evidence — Control Issue #275, iteration 3/5

- Project: orchestrator-dev
- Explicit Chat route: chat-267
- Control issue: #275 (consolidated REVISE 3/5)
- Source repository: jackie-water/ChatGPT-Codex-Orchestrator
- Exact task branch: feat/macos-durable-submit-return-20261017
- Exact reviewed parent SHA: 5e80d93f68d6782bc026b5806a3ad7baf6900e6b
- Exact new source SHA: b6f8a230dadd58883d686894f8cbea5f3a5fc65b
- Blocking review precursor: #274; immutable review checkpoint e86a147fba11cdec9e7a3687449299cdb7d9fb07
- Corrections: backward-compatible legacy macOS username flag plus validated array; LF/CRLF sensitive-field redaction; orphan worker claim UNKNOWN reconciliation; canonical authorization snapshot comparison; stale receipt lock handling.
- Source paths limited to four files: runtime/scripts/macos-dispatch.mjs, runtime/scripts/macos-durable-worker.mjs, src/lib/macos-durable-intake.mjs, tests/macos-durable-intake.test.mjs
- Exact file aggregate SHA-256 (pre-commit bytes verified equal exact SHA tree): d17217dc20fa995b039dd6fe013c053dbf6c5761d08a0b102b5ef652a4cd7195
- Codex execution: EXECUTED_UNVALIDATED, exit 0, no Codex rerun due to callback loss.
- Independent wrapper validation terminal: PASS, all syntax and diff checks pass.
- Focused tests: 10 pass, 0 fail, 0 skip.
- Full npm tests: 355 total, 346 pass, 0 fail, 9 skipped.
- Focused test log SHA-256: 583494d61751e43300196d4f5aadc31e0ed0e176a09295a27f2ad0546c4c8552
- Full test log SHA-256: 0e113a0dcc0b6b5ab3b8ba02a48597c2e9ceb3e919d957e69060fbdc5c093d3e
- Validation terminal SHA-256: 3b5f432d7bdc6329800e5411d3499006b83fda88a934970f421fa8a62c62f589

## Status and restrictions

Implementation evidence and tests only, not independent Code Review PASS. A NEW exact-SHA independent read-only review of b6f8a230dadd58883d686894f8cbea5f3a5fc65b is required.
No Control workflow, runner, Sandbox, real target or Windows modifications; no merge approval or deployment. Keep chat-267 callback route, exact SHA, no fallback, and explicit human approval for merge.
