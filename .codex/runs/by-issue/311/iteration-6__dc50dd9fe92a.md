# Immutable macOS callback implementation — human-approved REVISE 6/6, Control #311

- Project: `orchestrator-dev`; exact Chat callback review_route: **`chat-303`**.
- Repository: `jackie-water/ChatGPT-Codex-Orchestrator`; nonprotected task branch: `fix/macos-callback-send-receipt-20261018`.
- **Exact implementation SHA: `dc50dd9fe92ac9814e4c9a7b999e437ca5d9ca82`.** Parent SHA: `5ceea8c7dfd39dd4c0210e2da4eb874fe6fd4151`. Initial task source baseline for the full review: `e1e502fa349a902bda7ba836d38eb5d7a4966b67`.
- Human authorization: explicit user approval on 2026-10-18 for **this task only** to raise the 5/5 implementation iteration cap to **6/6**, addressing only two deterministic callback blockers. Does not approve merge, deployment, production Runner, native PID timeout policy change or other project scope.
- Review predecessor: Control #310 exact-SHA Code Review checkpoint `16a6d128bd50302fd28d67556d1bb21adef9d53c`, path `.codex/reviews/by-commit/5ceea8c7dfd39dd4c0210e2da4eb874fe6fd4151.md`, final Chat decision NEEDS_HUMAN before one-time authorization.
- Implementation executed only by Mac local Codex CLI in isolated worktree. Codex executor state `EXECUTED_UNVALIDATED`, exit 0, task `orchestrator-dev-311-6`. Executor log SHA256 `e4428e156f1c9ee14bef872ac14d2c6653f234364e1aa250bbc28537a9c3eada`. No Windows runner, installer, production workflows, live Chat callback, merge or protected branch changed.
- Changed surfaces only: `runtime/scripts/callback-delivery.mjs`, `runtime/scripts/wake-chat.mjs`, `tests/callback-reliability.test.mjs`.
- Changes: disabled Stop/Cancel controls no longer treated as active generation by callback composer discovery, draft insertion, or strictly identified Send selection. A **proven pre-click** wake deadline clears `DRAFT_INSERTED` back to `PENDING`; an ambiguous Runtime.evaluate / possible click remains `SUBMISSION_ATTEMPTED` and is reconcile-only. Preserve exact Chat URL, user-authored draft protection, strict complete user-role callback receipt, idempotency, no blind resend.
- Native Mac PID identity `TIMEOUT_MS=250` untouched, with separate ongoing intermittent `RUNNER_TIMEOUT` availability limitation.

## Independent Mac wrapper validation — PASS

- Wrapper terminal: local instance-private `short-turn-evidence/issue-311-macos-callback-validation-v1/terminal.json`, SHA256 `0a7a25b0f43a8b7b79ab4463b705273189d84c40786c335da607d0c0896bde41`.
- `fingerprint_verified=true`: all files matched before and after routine validation; clean protected macOS base unchanged; allowed file list and `git diff --check` PASS.
- Node syntax checks PASS. Callback focused default **30/30 PASS**, callback focused serial **30/30 PASS**.
- Full regression default: **399 total, 389 PASS, 0 FAIL, 10 SKIP**. Full regression serial: **399 total, 389 PASS, 0 FAIL, 10 SKIP**.
- Real automatic browser callback delivery remains **unverified**; exact user-role callback #303 was manually submitted with appended prose in this Chat. Never retry #303 blindly or claim DELIVERED from a draft.
- User-set execution ceiling for all future project Chat runs: **600 seconds per cycle** including evidence and settlement; this local Codex child had 300-second bound. This is not the native PID security timeout.

## Mandatory exact-SHA independent review and merge safety

- Independent **read-only Code Review** required for the full task diff from `e1e502fa349a902bda7ba836d38eb5d7a4966b67` to **`dc50dd9fe92ac9814e4c9a7b999e437ca5d9ca82`** on the same nonprotected task branch, preserving review_route `chat-303`.
- Only Chat may independently adjudicate PASS/REVISE/NEEDS_HUMAN. 6/6 is the final separately authorized iteration; further code-changing work needs another explicit human decision.
- Even a Code Review PASS is review-only; no merge unless user explicitly approves the exact final SHA. No release, Sandbox merge, target activation or live installer/testing is implied.
