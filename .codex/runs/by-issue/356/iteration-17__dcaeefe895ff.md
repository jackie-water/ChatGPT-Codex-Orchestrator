# Immutable implementation and independent wrapper evidence — Control #356

Project: orchestrator-dev
Registered review route: chat-333
Human-approved narrow logical iteration: 17/17
Source repo: jackie-water/ChatGPT-Codex-Orchestrator
Source task branch: feat/macos-short-turn-autoloop-20261018
Exact source SHA: dcaeefe895ffca3e5338211e282510cb7c9f7e86
Source predecessor SHA: 7dadea6c3992dd190a455c4deb729f72639da680
Full cumulative Code Review baseline: 7223744265267b8043b78433324fca0ce1f355b5
Local MacBook-Air.local Codex CLI, model gpt-5.6-luna with medium thinking, exit 0.
Executor log SHA256: f1787006cca3791ed90444d11f5bf5d01db0ad9fc6f64f6d1fbd690ada7d5284.

## Exact source scope
Only src/lib/macos-short-turn-autoloop.mjs and tests/macos-short-turn-autoloop.test.mjs changed.
makeAction uses Object.hasOwn(input, 'logicalIteration') to default only on actual omission; all explicitly provided non-positive, noninteger, falsy/null/NaN/undefined logical iterations are rejected INVALID_ITERATION rather than misrepresented as the current task iteration.
Tests added in readable scoped cases verify CHAT_CONTINUE, CODEX_RUN, VALIDATE, CODE_REVIEW with invalid explicit values, valid iteration one and omission; rejected intents do not mutate ledger state or journal.
Source changes are limited to 38 insertions and 1 deletion across the two allowed files.

## Independent validation — PASS
| Run | Tests | Pass | Fail | Skip | Exit | Log SHA-256 |
|---|---:|---:|---:|---:|---:|---|
| JS ledger/test syntax | N/A | PASS | 0 | N/A | 0 | empty |
| Focused short-turn test | 25 | 25 | 0 | 0 | 0 | ff6a06f473160cf379866343d75cdf839d823fe3a2b7398920274cf32d3eaade |
| Full default | 450 | 440 | 0 | 10 | 0 | e7b3813da602534ccda765933f1a74ca53859ff73893fc7bf591b29278057946 |
| Full serial | 450 | 440 | 0 | 10 | 0 | 7518a313b60168ee716cca40e2fdf7086b4d22e44255d00b4a76bce3ba2e3d60 |

Independent Mac disposable signed-issuer fixture regression: 20/20 PASS across protected CODEX_RUN and CHAT_CONTINUE. Explicit 0/null/NaN/undefined/false/empty/negative/fraction rejected with zero action intents and no state/journal mutation; valid one and genuinely omitted property accepted at iteration one. No actual Codex or Chat was called. Probe SHA256 d046fea733d5c692da761715d6fcff67578158b9b16f6913533fed18f3d386d6.
Independent wrapper adjudication report SHA256 7363246995d99e910573b6290db3929c5f4f3ff88af1cc2967569467b6b92249.

## Gate
Independent isolated implementation wrapper: PASS; mandatory independent exact-source-SHA Code Review: PENDING at this evidence publication. Source commit verified at GitHub origin; Mac worktree clean.
Controller/Runner/browser remain disabled. Signed issuer not provisioned for actual instance. Official installer/runtime bundling and live Chat-to-Codex E2E are not part of this isolated fix.
No merge, actual Sandbox/target activation, Windows/Priceup/Clean Energy, main/dev, old Control #332/chat-303, native Helper PID 500ms, protected branch or callback delivery contract changed.
PASS is review-only and no merge approval is inferred. No additional implementation rotation unless separately explicitly approved.