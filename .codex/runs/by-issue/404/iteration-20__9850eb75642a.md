# Immutable implementation checkpoint — Trusted Recovery Evidence v1, Control #404 (20/20)

Project: orchestrator-dev
**Registered exact originating Chat review_route: chat-369**
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
**Nonprotected task branch: feat/macos-trusted-recovery-evidence-v1-20261020**
**Exact committed and remote-verified implementation source SHA: 9850eb75642a872b3d21f5ed329ea10d5cdd927e**
Immediate predecessor committed source SHA: 34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7
**Full cumulative macOS C2 + Trusted Recovery Evidence v1 review base: 7e03521158db16731801e55803dbb8c870f5288c**
Prior independent exact-SHA review #403 checkpoint commit cf1e3ec3082d8aed5c8224d6042b06be8925c0b4, path `.codex/reviews/by-commit/34657fb9a0bfb9eeeda5d4bb9ca078fdaa6d9cb7.md`; applies **ONLY** to predecessor SHA.
User authorized one deterministic **REVISE 20/20**, not a 21/21 or any merge/installer.

## Deterministic correction and interrupted workflow

Independent review #403 confirmed P2: `routeRecords()` in `src/lib/macos-trusted-recovery-evidence.mjs` formerly silently filtered malformed Chat route records via `.filter(record => safeId(record?.route))`; one valid active route plus a second malformed entry could still permit `VERIFIED` issuance or verification. Private disposable Mac HOME independent proof before the revision: extra active route `../foreign` before receipt resulted in issuer VERIFIED, and missing route field added after receipt resulted in verifier and idempotent issuer VERIFIED. Proof SHA256 e7f901208febaeffc1c6ddb305a8512e136e6ccfe1d1ef2cea1906bed649a47b.

User-approved #404 Codex executor ran **exactly once**, returned exit code **0**, timed_out=false, elapsed **37.38 seconds**, executor log SHA256 **d62a0120d3866da7bc4ed600e937645c456d68a762fc8fdeed56c05f5f5bf9fd**, and **did not commit/push**. The only modified files were:
- `src/lib/macos-trusted-recovery-evidence.mjs`: validates every raw array/object-map route entry; throws on missing, invalid or inconsistent route identifier/record instead of silently filtering, retains existing independent registration Issue and selected active Chat URL checks, receipt permission 0600, canonical GitHub Control/Sandbox provenance, native Helper executable mode 0700.
- `tests/macos-trusted-recovery-evidence.test.mjs`: valid route positive plus malformed route entry before receipt and after receipt negatives; all original positive/idempotent and fail-closed tests retained.

Execution was interrupted **AFTER** initial independent focused/full testing but **BEFORE** complete independent historical security probes due Mac Remote Desktop Commander timeout. Durable interruption-only checkpoint commit **d8fa6fd68acddcad47bca83831acbcd0e9321a7d** at `.codex/interruptions/issue-404-revise-20of20-remote-pending.md`, Control #404 comment ID 6284835872. The Chat subsequently received user instruction **"继续"**; Mac remote was reconnected and original dirty two-file worktree, route receipt, hashes and branch HEAD were verified. Crucially **Codex was NOT rerun**, no 21/21 issue created, no historical source branch replaced or reset. Initial test result hashes were verified against the interruption record.

## Completed independent wrapper — exact candidate

Everything ran in disposable canonical private Mac HOME with GH/GITHUB/OpenAI authorization variables removed, preserving real instance and production; no real installer/Runner or target action.
- Allowed file scope, git diff --check, syntax: **PASS**.
- Focused tests: **174 total / 174 PASS / 0 FAIL / 0 SKIP**, log SHA256 **dce29b8f017e73a7ded201eb50f874c4d1af9b8333d8cc4b9531b0b43b6292b5**.
- Default full suite: **506 total / 496 PASS / 0 FAIL / 10 SKIP**, log SHA256 **a6c2877dc774fbbb9bedfa0416eb31f0ba8ba982bbdb2c48afb91eea8605731b**.
- Serial full suite: **506 total / 496 PASS / 0 FAIL / 10 SKIP**, log SHA256 **e6e3c0ad529ec276323b1cc32b97e66f0423aee2e35fea9a38f3ee70144f33b6**.
- After remote reconnection, reconstituted clean local probe scripts from the previously verified parent, not copied tool-result wrapper text; independently validated syntax and executed **36/36 private disposable-HOME safety cases PASS on the SAME 20/20 uncommitted candidate**:
  - Wrong-instance setup/resume 2/2 refuse, no mutations or external commands.
  - Legacy/security 16/16 refuse.
  - Hidden directories, symlinks, duplicate route 10/10 refuse.
  - Actual selected Chat URL tamper before/after receipt 2/2 refuse.
  - Trusted v1 receipt status/timestamp/mode 0700 negatives 4/4 refuse, issued 0600 positive VERIFIED.
  - **NEW malformed extra route before issuance / after issuance 2/2 refuse**, retaining valid active route positive. Issuer throws for malformed route; receipt verifier returns CONFLICT `chat_route_registry_integrity`, idempotent issuer refuses. Extra route probe SHA256 **9488c5ef7b2e8be308ffc19de8253940ceff6985b0ca62927f7755823a733da8**.
- Consolidated independent security report SHA256 **1db20cee4b5231361fe7ef0ad983b8d9c36208060e5d97e7de831cd65529fb54**.
- **Independent wrapper final PASS JSON SHA256 5251a973167eab74d7035a665883572241749b44136384352f68cedb99501e7d**.
- **Validated immediate two-file source delta SHA256 e78c8410f3011e1cb8b5d38f72fab78884a39c4c2c029d9d8e5bb038a67e26bb**.

Only AFTER successful exact branch, route, protected refs, source diff, syntax, focused, both full suites and 36 private safety probes did the **independent wrapper**, not Codex, commit and fast-forward push this exact SHA to ONLY the isolated task branch. GitHub confirmed only the two named file changes; local HEAD/remote identical and worktree clean. Protected `main` and `dev/v0.1-sandbox-e2e` remain SHA `85361876d587d824b18bf28e7367ef86c32040cf`.

Mac private evidence: `/tmp/trusted-recovery-issue-404-private/` (accepted/running/terminal, executor, focused/default/serial logs, clean historical probes, explicit malformed route probe, independent-wrapper/security JSON, exact source patch and candidate-commit.json). This is ephemeral; the immutable GitHub evidence is this pinned report.

## Mandatory independent Code Review and boundaries

**Wrapper PASS is NOT final Chat PASS and NEVER merge authorization.** Must issue ONE independent strictly READ-ONLY **FULL CUMULATIVE exact-SHA** Code Review comparing base 7e03521158db16731801e55803dbb8c870f5288c through exact source 9850eb75642a872b3d21f5ed329ea10d5cdd927e (not only new 20/20 delta), pinned to same registered route chat-369 and this report's exact checkpoint_commit/path, then independently adjudicate all findings PASS/REVISE/NEEDS_HUMAN. Prior #403 review of different SHA cannot substitute.

The explicit user iteration limit 20/20 is exhausted. There is **NO automatic 21/21**, no merge approval, official installer, legacy instance migration/adoption, signer, Runner/LaunchAgent/browser/CDP, Sandbox merge/real target activation, protected main/dev changes, Windows, Priceup, Clean Energy or old Phase B operations.
