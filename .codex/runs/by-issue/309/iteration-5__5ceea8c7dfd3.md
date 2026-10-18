# Immutable macOS callback implementation evidence — Control #309 iteration 5/5

- Project: orchestrator-dev; originating registered route: **chat-303**.
- Repository: `jackie-water/ChatGPT-Codex-Orchestrator`.
- Isolated macOS source task branch: `fix/macos-callback-send-receipt-20261018`.
- Original fully reviewed macOS source baseline: `e1e502fa349a902bda7ba836d38eb5d7a4966b67`.
- Exact predecessor candidate for this delta: `5eb33b2304889dd282d9640208a19caef9e2ad70` (Control #308).
- **Exact final code candidate: `5ceea8c7dfd39dd4c0210e2da4eb874fe6fd4151`.** This is the source SHA to independently review across the **complete** task diff from `e1e502fa349a902bda7ba836d38eb5d7a4966b67`.
- Current remote task branch points to the exact final code candidate; original macOS baseline, main and dev branches are unmodified.
- Revisions #304, #305, #307, #308 and #309 used separate local Mac Codex CLI implementation executions; each successor preserved route chat-303. This task exhausted configured 5/5 iteration cap, with no authorization for iteration 6.
- The final narrowly scoped change canonicalizes the wake-chat CLI entrypoint using native realpath identity for `/var` versus `/private/var`, whitespace and Unicode. Earlier task commits addressed bounded callback wake deadlines, busy-response Send suppression, exact composer button selection and safe callback reconciliation. Their entire combined diff MUST be included in review.

## Independent macOS wrapper proof — #309

- Authoritative private terminal: `~/.chatgpt-codex-orchestrator/instances/1832f0bb/short-turn-evidence/issue-309-macos-callback-validation-v1/terminal.json`.
- Terminal SHA256: `bda8330acd35d7557890beeff87b69181858af0b7b41868c5ab4074428225c7f`.
- Terminal state `PASS`, `fingerprint_verified=true`, exact route `chat-303`, base `5eb33b2304889dd282d9640208a19caef9e2ad70`.
- Independent `git diff --check` PASS, Node syntax checks PASS, allowed-surface and exact source fingerprint before/after checks PASS.
- Focused callback tests: default 28/28 pass; serial 28/28 pass.
- Full regression: default 397 total / 387 pass / 0 fail / 10 skip; serial 397 total / 387 pass / 0 fail / 10 skip.
- The preceding #308 wrapper failed deterministically for a canonical macOS `/var` versus `/private/var` entrypoint mismatch; #309 fixed it, and the same regression tests passed without weakening route, draft, or receipt checks.
- The independent wrapper was executed outside Codex. Codex's own test claims are NOT the acceptance evidence.

## Required independent Code Review and gates

- Review the **exact same final 40-character source commit** `5ceea8c7dfd39dd4c0210e2da4eb874fe6fd4151` and all changes since `e1e502fa349a902bda7ba836d38eb5d7a4966b67`.
- Preserve explicit-route-v1, pinned destination URL, full-payload exact user-role receipt, idempotent outbox and reconcile-only after an ambiguous submit; no generic submit/feedback click, never pretend a draft was delivered.
- Do NOT mistake a passing fake-CDP fixture for proof of real automatic user-role delivery. Registration callback #303 was manually sent with additional text and its previous outbox did not have exact automatic receipt proof.
- The pre-existing native Mac process-identity `TIMEOUT_MS=250` intermittent `RUNNER_TIMEOUT` / `MACOS-NATIVE-PID-PROOF-FAILED` remains separately unresolved and must NOT be masked, bypassed or misattributed to this callback work.
- No live installer, launchctl, code merge, production runner or workflow activation, Windows machine execution, deployment or Sandbox COMPLETE is authorized or claimed.
- Code Review outcome must be independently adjudicated PASS / REVISE / NEEDS_HUMAN. PASS is review-only and does not authorize merge. After iteration 5, any further technical REVISE requires a separate explicit human decision.
