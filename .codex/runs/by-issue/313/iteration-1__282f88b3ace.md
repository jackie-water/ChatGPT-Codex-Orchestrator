# Immutable macOS Native PID 500ms implementation — Control #313 iteration 1/5

- Project: `orchestrator-dev`; originating exact review_route: **`chat-303`**.
- Repository: `jackie-water/ChatGPT-Codex-Orchestrator`.
- Independent isolated Mac worktree task branch: `fix/macos-native-pid-500ms-20261018`.
- **Exact source candidate commit: `282f88b3aceac7460d8d91cd1161486267a760e7`.**
- Exact source parent/spike baseline: `dc50dd9fe92ac9814e4c9a7b999e437ca5d9ca82`.
- Owner expressly authorized a single Native PID helper spawnSync time budget increase from **250ms to 500ms** in this Chat on 2026-10-18. Approval does not include merging, helper signing/install, weakening identity, changing production Runner, or changing four native PID observations.
- Control [#313](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/313) holds the initial implementation prompt. Mac local Codex CLI executed task `orchestrator-dev-313-1`, exited 0, immutable private executor terminal `short-turn-evidence/issue-313-macos-native-pid500-codex-v1/terminal.json` SHA256 log `e9610a0ef9bf14480150dae36b04d3eb87bae3b38fad81e385a791c717ff0cd9`. No model-authored commit/merge.
- Changed exactly two files: `src/lib/macos-native-process-identity.mjs` (fixed single native `TIMEOUT_MS = 500`), `tests/macos-native-process-identity.test.mjs` (deterministic tests of single exact privileged spawnSync invocation with 500ms and fail-closed ETIMEDOUT/signal/native errors). No `runtime/native/macos/process_identity.c` changes. No helper binaries installed or signed.
- Preserved: `shell:false`, pinned private `PATH`/`LC_ALL`, `cwd:"/"`, `maxBuffer:4096`, trusted helper owner/ancestor/symlink validation, exact `pid/start_sec/start_usec` parser, `RUNNER_TIMEOUT` on signal/ETIMEDOUT, no retries/fallbacks. Existing four independent native proof observations remain untouched.
- User-set total Chat run budget remains **600 seconds per cycle**. Implementation was bounded to 230 seconds and finished normally. Only MacBook Air was used.

## Authoritative independent macOS wrapper — PASS

- Private terminal: `~/.chatgpt-codex-orchestrator/instances/1832f0bb/short-turn-evidence/issue-313-macos-native-pid500-wrapper-v1/terminal.json`.
- Terminal SHA256: `11c3982591bd3b1c5633222172a245c41458ab0eb45956c96bed3c0c151301a9`.
- Terminal `state=PASS`, `fingerprint_verified=true`, route `chat-303`. Allowed change scope, independent syntax checks and `git diff --check` PASS.
- Focused native identity and Darwin resume default **18/18 PASS**, focused serial **18/18 PASS**.
- Full test suite default **402 total / 392 PASS / 0 FAIL / 10 skipped**, full serial same **402 / 392 / 0 / 10**.
- Independent wrapper asserted original libproc source worktree stayed exactly `e1e502fa349a902bda7ba836d38eb5d7a4966b67` and previous callback source worktree exactly `dc50dd9fe92ac9814e4c9a7b999e437ca5d9ca82`, both clean.
- This is deterministic regression validation, not proof of a zero-long-term-failure startup rate. Earlier isolated 500ms cold launch experiment observed 0/64 timeouts, but was not statistically conclusive; the official installer remains unrun and Helper UNBOUND.

## Mandatory independent exact-SHA Code Review and merge gates

- Read-only Codex Code Review **for exact `282f88b3aceac7460d8d91cd1161486267a760e7`** and base `dc50dd9fe92ac9814e4c9a7b999e437ca5d9ca82`; Chat independently adjudicates. Neither wrapper PASS nor review PASS automatically authorizes merge.
- All review requests must use `review_route=chat-303`; no fallback or `chat-267`.
- **No merge** (not even spike), official installation, Sandbox verification, Runner/launchctl deployment or production PID policy activation has been approved. Production spike still contains `250ms` until separately approved exact-SHA merge.
- Keep `main`/`dev`, Priceup, Clean Energy, Windows, target repo and private installer state completely unchanged.
