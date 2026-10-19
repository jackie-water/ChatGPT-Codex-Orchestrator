# Immutable Phase C1 implementation and independent wrapper — Control #361

Project: orchestrator-dev
Registered exact callback route: chat-333
Approved phase: C1 disabled-only macOS runtime packaging and CLI; current logical iteration 2/5.
Task branch: feat/macos-phase-c1-dormant-integration-20261019
Exact source commit: 7e03521158db16731801e55803dbb8c870f5288c
Immediate source predecessor: a80b624da4dbe762385c3e56d5b65599cf99ef04
Full phase exact starting reviewed SHA: 59c626d7e4bfedce348c0543ab5327440f4907ba
Predecessor implementation checkpoint: 7cc0c3ff9dddd8a4e84c0895618ce132e59c8244
Predecessor immutable report: .codex/runs/by-issue/360/iteration-1__a80b624da4db.md
Original code-only short-turn PASS review checkpoint: 53c0e1594c79f61577a082401fa87d6518922659.

## Source changes from Phase C1 starting baseline

Iteration 1/5, exact SHA a80b624da4dbe762385c3e56d5b65599cf99ef04:
- Explicit runtime bundle SCRIPT_NAMES now contains macos-short-turn-controller.mjs; LIBRARY_NAMES contains macos-short-turn-autoloop.mjs. Existing static script dependency transform produces correct scripts/../src/lib import in a temporary Control tree.
- Local disabled-only CLI no longer passes own trustedScope undefined when raw scope flag absent. Explicit raw --trusted-scope is rejected UNTRUSTED_SCOPE_INPUT; explicit invalid budgets 0, 1.5, NaN rejected. Disallowed run/execute/browser/codex/review/merge/deploy commands remain disabled. No native runner, signer, installer, or existing runtime mutation.
- Runtime bundle test verifies static closure, source byte preservation, staged CLI register and negative budget/raw scope semantics.
- Independent iteration-1 focused bundle12/12 and short-turn26/26 passed. Full default/serial both FAILED due 7 ENOENT errors from legacy refresh unit test fixture lacking the new manifest-owned library; precise diagnosis and decision REVISE recorded at checkpoint above.

Iteration 2/5, exact SHA 7e03521158db16731801e55803dbb8c870f5288c:
- Changed ONLY tests/control-runtime-refresh.test.mjs nativeModules fake fixture, one added entry for macos-short-turn-autoloop.mjs. No Windows source or actual refresh-runtime implementation edits.
- Codex local Mac CLI gpt-5.6-luna medium exit0; executor log SHA256 a8935739a789d7deeed3f7859242f481eded8e5a150959e2c13b76926ab68533.
- Mac source branch and exact SHA remotely verified, worktree clean. Original 18/18 source worktree still unchanged.

## Independent wrapper PASS on exact source candidate

| Check | Total | Pass | Fail | Skip | Log SHA256 |
|---|---:|---:|---:|---:|---|
| JS refresh fixture syntax | N/A | PASS | 0 | N/A | empty output |
| Refresh targeted suite | 113 | 113 | 0 | 0 | 372279a6fe641b9d38f9336015325a807aca64b27182b0d33d826327e6527186 |
| Runtime packaging/static import suite | 12 | 12 | 0 | 0 | 207f995c8a9547e153cfe3e4e0eec040a8d3fda821be880a7ccb6ea548a8356c |
| Short-turn ledger suite | 26 | 26 | 0 | 0 | 8829462389090a0a50276a757be7a1e82ae1cbcb6a6e089cae424ba23e2657a8 |
| Full default node --test | 452 | 442 | 0 | 10 | be85f509f9d9a34a9de02dca78bbd20f02b356d5ad5692857bdb44b5bb2f39f7 |
| Full serial node --test --test-concurrency=1 | 452 | 442 | 0 | 10 | 7514777eb1859c5ccff56e969829f29a8ef622e87165bb981ea0d4c5195fddfb |

## Independent installation-disabled negative probe

Probe executed in a disposable, private staging Control root + fake HOME with a fake codex sentinel. All 8/8 cases PASSED.
- Verified 37 exact manifest files, staged controller imports the static packaged ledger, and macos-submit.mjs is not bundled.
- Unsigned Chat-only register succeeds with no signed execution capability; caller-supplied --trusted-scope fails.
- Explicit zero, fractional and NaN budget rejected without creating task state.
- All real execution/browser/merge CLI commands rejected LOCAL_SHORT_TURN_ONLY.
- A CHAT_CONTINUE dispatch creates execute:false local INTENT ONLY; CODEX_RUN without independent issuer fails TRUSTED_SCOPE_REQUIRED.
- Fake codex sentinel was never invoked; no actual Codex or real Chat callback ran. Temporary control/home directories removed after probe.
Independent disposable negative probe SHA256 e8d249345ccae5ca924aba4fb3293ecdc3d841c49099ec60604c518db56fa339.
Independent wrapper adjudication SHA256 502e522341c0b281bdbfd8ef7f8c1693e00f535bc949399c9e8434ed40386a7f.

## HARD GATES

Independent implementation wrapper PASS but mandatory independent full-cumulative read-only Code Review on exact source SHA 7e03521158db16731801e55803dbb8c870f5288c is PENDING at this checkpoint publication.
PASS means review only and does NOT authorize merge. All official installer state, existing instances, actual Sandbox target and production configurations untouched.
Current genuine route chat-333 reused, old Phase B #332 pinned to DIFFERENT chat-303 remains PREPARED_NOT_STARTED.
Control workflow disabled; registered Runners zero; native helper PID500 unchanged; no real Ed25519 signing issuer keys provisioned.
Source changes still isolated on task branch; no merges into main/dev or actual target; Windows, Priceup and Clean Energy infrastructure untouched.