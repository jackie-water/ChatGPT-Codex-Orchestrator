# Immutable implementation and independent wrapper evidence — Control #349

Project: orchestrator-dev
Registered review route: chat-333
Source repo: jackie-water/ChatGPT-Codex-Orchestrator
Task branch: feat/macos-short-turn-autoloop-20261018
Exact source SHA: d7401c2c821ad3982a21001dc847fcc6f8ff266a
Exact predecessor SHA: ee4c8e48e6e7edf587c54849320b53b66d1d6541
Full cumulative review base SHA: 7223744265267b8043b78433324fca0ce1f355b5
Approved iteration: 13/13, one-time human approval for authenticated trustedScope provenance only
Codex executor: MacBook-Air.local, gpt-5.6-luna medium, exit 0
Executor log SHA-256: 329ad05cd86cdfd00adb5259feb3279bbc1eda0c2415199711f1d2560b7e8892

## Implementation scope

Only src/lib/macos-short-turn-autoloop.mjs and tests/macos-short-turn-autoloop.test.mjs modified on task branch. No runtime CLI, packaging, runner, browser, installer or production code outside this local ledger was modified.

- Raw caller-supplied trustedScope / scope / authorization no longer mints actionCapability.
- A protected-action scope must derive from independently provisioned instance-root issuer public key and Ed25519-signed per-task authorization record, binding instance/project/pinned Chat URL/route/task/source branch/exact source SHA/allowed action kinds/iteration limit/control issue/expiry.
- Private owner/mode and no-symlink checks, signature verification, and state reload re-verification are present. Without an issuer trust anchor, protected intents remain denied while Chat-only intents remain possible.
- No production signing key, issuer, installed runtime, or live controller was provisioned or activated. Ed25519 private-key operations exist in disposable test fixtures only.

## Independent wrapper PASS (all 0 failures)

| Check | Tests | Pass | Fail | Skip | Log SHA-256 |
|---|---:|---:|---:|---:|---|
| Source + test JavaScript syntax | N/A | PASS | 0 | N/A | outputs empty |
| Focused ledger tests | 19 | 19 | 0 | 0 | 5e9d0af8aed8bda3b24319dac9a57dbdb41d1439c636463971a25b1d8402b2a1 |
| Full default tests | 444 | 434 | 0 | 10 | 66fa9c90ab827863478af420db4df9e994c6708477ade3e5ae5481c056a4b384 |
| Full serial tests | 444 | 434 | 0 | 10 | e882bf5a724f94e4ecc0b789cae1413165677f6efb5e10d7573a27bad46d77b7 |

Independent Mac negative test against the actual registered chat-333 route, using ONLY disposable task state: raw trustedScope -> UNTRUSTED_SCOPE_INPUT; absent signing issuer -> no capability and protected CODEX_RUN -> TRUSTED_SCOPE_REQUIRED. No protected action was executed. No actual issuer key was provisioned.
Independent scope probe SHA-256: 42a5a21c132d80f3d9fee4ad37080e4fc5291d844ec3071ae554c48936c61415.
Independent audit report SHA-256: ca9c8a56344f3b28dfaa81a17207e2de5fae95c6de3373174beaceef59a5f003.

## Security and deployment gates

Implementation isolated wrapper: PASS. Independent exact-SHA cumulative Code Review still PENDING.
The system is an intentionally disabled local intent producer, not an installed or live Chat-to-Codex autoloop. Trust issuer provisioning and runtime packaging are separate human-authorized integration tasks. Test results are not merge authorization.
Main/dev/Windows/Priceup/Clean Energy/real target untouched. Old Control #332 and route chat-303 remain untouched. Native Helper PID 500ms policy and existing four-state callback delivery remain unchanged.
