# INTERRUPTED, NOT PASS — Trusted Recovery Evidence v1 REVISE 20/20, Control #404

Project: orchestrator-dev
**Originating Chat review_route: chat-369**, registered and confirmed as delivered user-role callback route.
Control repository: jackie-water/chatgpt-codex-orchestrator-control-1832f0bb
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Non-protected source branch: feat/macos-trusted-recovery-evidence-v1-20261020
**Last COMMITTED, independently reviewed and remote verified source SHA: 34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7**
Prior independent Code Review #403 immutable checkpoint: cf1e3ec3082d8aed5c8224d6042b06be8925c0b4, file .codex/reviews/by-commit/34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7.md
Full cumulative review base (for any eventual NEW source SHA): 7e03521158db16731801e55803dbb8c870f5288c
User explicitly approved **one REVISE 20/20 only**, with NO merge/install/Runner permission.

## Exact verified progress

Before dispatch, the MacBook-Air.local isolated source worktree was clean at the old committed SHA and GitHub remote matched. Current Chat route receipt `chat-369` was previously verified delivered as a user-role message; Control issue #404 was created once with exact route, branch, parent SHA, strict 2-file allowlist, and deterministic delta-only instructions.

Manual isolated Mac Codex executor for Control #404 ran **exactly once**, returned **exit code 0, timed_out false, duration 37.38 seconds**, and did **NOT commit or push**. Executor log SHA256 **d62a0120d3866da7bc4ed600e937645c456d68a762fc8fdeed56c05f5f5bf9fd**. At terminal, committed HEAD remained `34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7`, task branch unchanged, with **ONLY TWO UNCOMMITTED SOURCE FILES**:
- src/lib/macos-trusted-recovery-evidence.mjs
- tests/macos-trusted-recovery-evidence.test.mjs

The implementation changes `routeRecords()` to fail closed on malformed raw records instead of silently dropping them, for both supported array and object-map route registries. Existing canonical registered Chat URL/issue binding remains. A fresh independent disposable-Mac-HOME proof run against this **UNCOMMITTED candidate** showed:
- Valid active route with only Chat URL tampered: proper refusal before and after receipt.
- Malformed extra active `../foreign` route before first issuance: issuer **DENIED** with `route registry contains a malformed record`.
- Extra active record MISSING `route` after valid receipt: verifier **CONFLICT**, `chat_route_registry_integrity` gate; idempotent issuer **DENIED**.
Proof SHA256 **9488c5ef7b2e8be308ffc19de8253940ceff6985b0ca62927f7755823a733da8**, local `/tmp/trusted-recovery-issue-404-private/independent-malformed-route-probe.json`.

Independent wrapper on SAME uncommitted candidate:
- Allowlist/diff --check and 2 modified .mjs syntax: PASS.
- Focused Mac C2/P3/Trusted Recovery/dry-run/runtime: **174 total / 174 PASS / 0 FAIL / 0 SKIP**, log SHA256 **dce29b8f017e73a7ded201eb50f874c4d1af9b8333d8cc4b9531b0b43b6292b5**.
- Default full Node suite: **506 total / 496 PASS / 0 FAIL / 10 SKIP**, log SHA256 **a6c2877dc774fbbb9bedfa0416eb31f0ba8ba982bbdb2c48afb91eea8605731b**.
- Serial full Node suite: **506 total / 496 PASS / 0 FAIL / 10 SKIP**, log SHA256 **e6e3c0ad529ec276323b1cc32b97e66f0423aee2e35fea9a38f3ee70144f33b6**.
- Wrapper stopped at `TESTS_PASS_PENDING_INDEPENDENT_SECURITY_PROBES`, NOT final wrapper PASS.

## Infra interruption and exact blocker

Further independent historical safety probe re-execution (2 wrong-instance setup/resume, 16 legacy/security, 10 hidden/duplicate-route, 4 receipt modes/status/timestamps; prior SHA had 34/34) could not be reliably completed. Mac Remote Desktop Commander began returning *"This tool call was blocked by OpenAI's safety checks"* for some remote commands, and then a Mac ping `call_id=825846e3-fd0d-4c50-b25d-55c72ca492cd` stayed **pending**, while the device list showed MacBook-Air.local online with stale last-seen data. The remote tool had previously displayed a **99% monthly Desktop Commander usage warning**. Do not assume the warning is definitely the cause. The Mac's actual current connectivity and task-branch worktree state after the last completed wrapper read are not reconfirmed.

Some PRIVATE `/tmp/trusted-recovery-issue-404-private` probe copies created during attempted resume may have tool read-output wrapper text prepended (e.g. `[Reading ...]`), so their syntax is **NOT VERIFIED**. Do not treat these copied scripts or their failed runs as authoritative negative results. On reconnection, reconstruct clean probe scripts from the retained parent evidence or original verified source, with output references and issue ID changed to #404. Do not overwrite parent evidence.

**There is NO new source commit, no new implementation checkpoint report tied to a new source SHA, no independent Code Review for a new SHA, and NO Chat PASS.** Explicit final state is `WAITING_INFRASTRUCTURE / NEEDS_HUMAN`, not a technical P1/P2 review verdict.

## Resume instructions (NO new Codex)

1. Restore/check Mac Remote Desktop Commander response and exact authorized MacBook-Air.local device ID `08bd11ff-f0fe-412c-817b-51eeeb6be991`. Inspect real Git status, branch and persistent progress on Mac before any mutation.
2. **DO NOT rerun completed Codex #404**. Last confirmed worktree was dirty with exactly two authorized files and base committed HEAD `34657...`. If the Mac restarted and local state changed, reconcile from GitHub issue #404 and ephemeral private logs; do not recreate earlier runs/routes.
3. Read `/tmp/trusted-recovery-issue-404-private/accepted.json`, `terminal.json`, `executor.log`, `wrapper.py`, `independent-wrapper.json`, `focused.log`, `full-default.log`, `full-serial.log`, and independent-malformed-route-probe.json if present; verify hashes and source diff.
4. Correct/read-only isolate any malformed probe harness copies (do NOT alter production source). Rerun independent historical and receipt permission/adversarial checks on the same candidate. Reject unknown/unsafe results, never certify PASS on the basis of stale parent proofs.
5. Only if every independent wrapper, security test, exact source fingerprint, Chat route and protected-ref check passes, wrapper may commit and push **ONLY the nonprotected task branch**, pin immutable implementation report with NEW actual 40-char source SHA, and issue **ONE independent STRICT READ-ONLY full cumulative Code Review for SAME SHA** with review_route chat-369. Chat then independently adjudicates PASS, REVISE, or NEEDS_HUMAN. Do NOT create a new 21/21 Codex request without separate user approval.
6. **PASS never grants merge approval.** No official installer, legacy adoption, native signer, Runner/LaunchAgent/browser/CDP, Sandbox merge or real target activation; no protected main/dev, Windows, Priceup or Clean Energy modifications.

This GitHub checkpoint is an **interruption record, not an implementation-complete checkpoint and not Code Review evidence**. Private `/tmp` files may be lost upon reboot.
