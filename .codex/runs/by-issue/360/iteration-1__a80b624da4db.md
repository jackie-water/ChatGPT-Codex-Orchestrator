# Immutable Phase C1 implementation evidence — Control #360, iteration 1/5

Project: orchestrator-dev; registered Chat review route: chat-333.
Phase: C1 default-disabled macOS short-turn runtime packaging/CLI integration.
Source repo: jackie-water/ChatGPT-Codex-Orchestrator
Task branch: feat/macos-phase-c1-dormant-integration-20261019
Exact source commit: a80b624da4dbe762385c3e56d5b65599cf99ef04
Exact original reviewed base: 59c626d7e4bfedce348c0543ab5327440f4907ba
Previous full cumulative independent Code Review checkpoint: 53c0e1594c79f61577a082401fa87d6518922659.
Codex local MacBook-Air.local CLI gpt-5.6-luna medium, exit 0, log SHA256 3c3fac6e340a4862ac11837bf8a4f28813bd047f49bc227b6d0e5f4bb95eb6a2.

## Exact implementation scope

Only src/lib/control-runtime-bundle.mjs, runtime/scripts/macos-short-turn-controller.mjs and tests/control-runtime-bundle.test.mjs changed, 45 insertions, 6 deletions.
Added explicitly enumerated short-turn CLI and ledger to the Control runtime payload, using existing strictly static source-relative import path normalization, without adding execution service, Codex dispatcher, browser, signer keys, or installer activation.
Adjusted CLI to omit missing `trustedScope` property, reject explicitly supplied raw `--trusted-scope`, and strictly validate explicit budgets including zero/fractionals/NaN. Entry is still local intent-only and disabled.
New isolated Control staging tests checked packaged relative import and unsigned Chat-only registration. Old source worktree and main/dev were preserved.

## Independent wrapper — FAIL / CHAT REVISE

| Run | Total | Pass | Fail | Skip | Log SHA256 |
|---|---:|---:|---:|---:|---|
| Source/CLI/test syntax | N/A | PASS | 0 | N/A | empty logs |
| Focused bundle tests | 12 | 12 | 0 | 0 | 029d1247a07427b8ab826c99ff89b4080ef5214acce77b2d3b9896188b724ee2 |
| Focused short-turn ledger | 26 | 26 | 0 | 0 | 7c8b8039b10066a4a182429c5bd1297c681fadc0c548cf67898299cf617c1fb9 |
| Full default | 452 | 435 | 7 | 10 | 631e736677464cc8de6f08fce5b2e92bbeeb63cfd8657c95e012e83240e2dc33 |
| Full serial | 452 | 435 | 7 | 10 | 6bfc21be3516a25a40d4196b6a26b21c857c4409c197959e2809dc292954ec43 |

All seven full-suite failures are from `tests/control-runtime-refresh.test.mjs` fixture expectations. Existing fake nativeModules fixture copies only six previous library files and now fails lstat ENOENT when the new explicit runtime bundle requires src/lib/macos-short-turn-autoloop.mjs. The platform-specific Windows test failures share this artificial fixture precondition, not Windows implementation behavior. No Native Helper PID timeout errors were evidenced.
Independent local adjudication SHA256 2a9e775b1a13f67712fe806d35db5013bcb67a78969eb102ea402d7e0910bfb3.

## Deterministic next step

Chat adjudication: REVISE — delta-only successor Control #361 to add `macos-short-turn-autoloop.mjs` to fake fixture nativeModules list in `tests/control-runtime-refresh.test.mjs` ONLY. Do not modify Windows production, manifest closure rules, installer, signer, Runner, browser, older worktrees or other repos. No independent exact-SHA Code Review for this failed-wrapper candidate. Successor remains pinned to review_route chat-333, same task branch, and exact predecessor SHA a80b624da4dbe762385c3e56d5b65599cf99ef04.

No merge approval, no installed runtime writes, no official setup, no Sandbox or target activation, no production infrastructure modified. PASS still requires independent default+serial full validation and separate exact-SHA Code Review.