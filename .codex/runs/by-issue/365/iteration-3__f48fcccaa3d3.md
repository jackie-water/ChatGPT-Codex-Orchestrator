# Immutable Phase C2 implementation evidence — Control #365 (iteration 3/5)

Project: orchestrator-dev; exact registered Chat route: chat-333
Phase: C2, safe existing-macOS-instance recovery code-only adaptation
Source repo: jackie-water/ChatGPT-Codex-Orchestrator
Task branch: feat/macos-phase-c2-existing-instance-recovery-20261019
Exact implementation source SHA: f48fcccaa3d3fdcb96ee83461b5cedbfc3687f52
Exact predecessor: 8ff0f9fde316bd4bcafdd054144ac930eb9893fd
Prior implementation #364 checkpoint: 7a0b979e074f92124cac562b23fa1e2f5f2a6d13
Prior report: .codex/runs/by-issue/364/iteration-2__8ff0f9fde316.md
Original C1 approved code SHA: 7e03521158db16731801e55803dbb8c870f5288c
Local Mac Codex model gpt-5.6-luna medium, exit0. Executor log SHA256 cfecdca3250d5aafcac6b8ffa151874c71c2ee7f32fd42629f04146035c0975f.

## Exact modification
Only tests/macos-p3-setup-resume.test.mjs changed, 1 inserted and 1 deleted line: Darwin native fixture root now uses fs.realpathSync(os.tmpdir()) to avoid macOS system /var symlink aliases rejected by safety inspector. No source product changes, no Mac PID 500ms relaxation, no Windows change.
Implementation exact SHA pushed to isolated task branch, GitHub remote verified and Mac worktree clean.

## Independent wrapper: FAIL — do NOT Code Review this candidate
JS syntax PASS.
Focused tests/macos-p3-setup-resume.test.mjs 6 tests: 5 PASS, 1 FAIL, 0 SKIP. Log SHA256 5197a564d6e8d166fbdad18eaaf661088ccfb7cd357e77db7caa1d34801b2ca6.
Failing case 'Darwin resume uses isolated child-process evidence and remains idempotent': sandbox-verified resume unexpectedly returns NEEDS_USER_ACTION / MACOS-EXISTING-INSTANCE-REVIEW, rather than sandbox_verification. The recovery inspector is CORRECTLY fail-closed.
Full default/serial intentionally not run because known focused blocking failure.

## Independently diagnosed deterministic fixture root cause
Temporary Mac diagnostic copies only, without changes to tracked tests or production source:
First `resume` generates isolated native instance `fixture2` and instance_root, but old test's installer state lacks instance_id. Created native instance also has no private chat-routes.json nor migration snapshot identity proof, so the next resume detects a NEEDS_VERIFICATION existing instance but fails exact identity binding.
Even when private trusted route/migration evidence and matching instance_id/root are added after the first resume, the legacy test later resets state from the original unbound base, dropping instance_id and instance_root again; so completion resume fails the same gate.
In disposable test-only diagnostic, adding canonical private instance identity, route JSON and migration metadata after first resume and persisting it through the later `boundBase` reset allowed sandbox-verified, completion and idempotent resume checks to pass; 1/1 diagnostic test PASS.
Independent diagnostic log SHA256 8be82e4deda864400172e96479016b4a324405b6156365876450ef7a78b07708.
Independent local adjudication JSON SHA256 fe35e4d203183d7199d3e97262d216e488925ab65487b4584d9f429f79ee1505.

## Decision and precise successor
Chat adjudication: REVISE. Needed delta: only tests/macos-p3-setup-resume.test.mjs, in its disposable Darwin child-process fixture, create private same-installation route/migration identity proof and preserve instance_id + canonical instance_root across all resumed installer state snapshots. Preserve original P3 security/rollback and idempotence assertions. Do NOT bypass MACOS-EXISTING-INSTANCE-REVIEW in src/cli.mjs or the instance inspector. This is a fixture repair, not real-existing-instance adoption.
Next successor: Phase C2 REVISE 4/5, same branch and chat-333, immediate predecessor f48fcccaa3d3fdcb96ee83461b5cedbfc3687f52. Do not duplicate completed Codex #365.
No Code Review for failing-wrapper SHA, no merge, installer/setup, signer/Runner/browser controller, real Control/Sandbox/target, Priceup/Clean Energy, main/dev or Windows modification. Old #332 belongs to separate chat-303 and remains untouched.