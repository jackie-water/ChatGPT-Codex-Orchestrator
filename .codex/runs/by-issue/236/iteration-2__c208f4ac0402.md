# Mac offline registration repair — revision iteration 2/5 immutable report

## Exact immutable identity
- Project: `orchestrator-dev`; original Chat callback `review_route=chat-232`.
- Source tracking: public issue `jackie-water/ChatGPT-Codex-Orchestrator#10`.
- Control implementation request: private `#236` `[CODEX-RUN]` REVISE 2/5.
- Original independent reviewed implementation commit (parent): `2f08f227dcb68d7d16b45edf6aba293f1aecfc22`.
- **New source implementation SHA:** `c208f4ac04026a984e7228f2dbe77a3a9b2f2527`.
- Task branch: `fix/macos-chat-registration-offline-20261017`, source GitHub `jackie-water/ChatGPT-Codex-Orchestrator`.
- P3 base remains `f4c189962e94661d1f4dde06c798c476e2aa149b`; public Windows main remains `85361876d587d824b18bf28e7367ef86c32040cf`.
- Previous same-SHA independent review evidence: checkpoint commit `f86b20be872d8d9ca334ac01217bbecd31a77160`, path `.codex/reviews/by-commit/2f08f227dcb68d7d16b45edf6aba293f1aecfc22.md`, verdict REVISE with 4 independent high-severity findings.
- GitHub Control run `38983457947` canceled while queued on the Windows-only offline runner. **Mac manual Codex implementation executed**, not a successful `CODEX-AUTO` workflow; Codex session `01a14720-0c49-73c2-9d49-73b255293a4b`, CLI 0.162.1, model gpt-5.6-luna. Controller repeatedly resumed this SAME logical 2/5 session for deterministic wrapper test fixes; no new iteration was started.

## Delta-only remediation applied
1. Legacy GitHub Actions Issue event run metadata cannot prove exact Issue-to-run binding and cancellation has an unsafe check-then-cancel race. Native `runtime/scripts/register-chat-mac.mjs` **no longer performs ANY mutating GitHub API cancellation**. It validates exact trusted GitHub private repository/Issue/project, creates or reuses only this original Chat's local registration/outbox promptly, queries paginated runner and run status, and reports `CONTROL_QUEUE_UNRESOLVED` with candidate run IDs and human-safe instruction when old Windows jobs remain queued. Unknown/online/conflicting work refuses continuation. No false assertion of cancelled Actions and no runner start.
2. Native callback now has per-callback single-owner exclusive lock held around receipt, draft, durable pre-send state and actual Send. Unsafe foreign/symlink or occupied lock fails closed and requires deterministic recovery.
3. Callback `createCallbackStateStore` now persists state atomically using private exclusive no-follow temp file, explicit `fsync` on file and parent directory before browser click. If persistence errors, the click is not attempted; ambiguous post-attempt states are only reconciled on real user-role receipt. Known PRE_SEND_NOT_READY with **provably no click** can durably revert to PENDING for safe later retry.
4. Retained previous outer timeout correction, exact original-Chat URL and callback ID, native register issue/read-only GH validation, trusted user-role delivered evidence, Windows compatibility, and English/Chinese project instructions. No source mutation beyond 8 targeted runtime/test/docs paths, 220 additions/111 deletions.
5. Corrected test-only macOS os.tmpdir symlink fixture via `fs.realpathSync(os.tmpdir())`, keeping production path security strict; mutex fixture bounded to prevent infinite spin; poisoned local DELIVERED proofs fail closed.

## Independently run controller validation
- JS syntax checks: PASS.
- `git diff --check`, staged diff check, allowed surface review: PASS.
- Focused macOS callback and registration tests: **28/28 PASS, 0 FAIL**.
- Focused no-SHA failure tests: **14/14 PASS**.
- Final full local Mac Node suite: **343 tests, 334 PASS, 0 FAIL, 9 expected SKIP**.
- Task branch exact parent, clean worktree after controller commit, remote task HEAD equals new full 40-SHA. Original P3 source worktree still clean and pinned.
- Independent GitHub CI result for this exact SHA is evaluated separately on Draft PR #11; the previous SHA CI does not count for this candidate.

## Safeguards / next gate
**This is implementation and wrapper evidence, not Code Review PASS.** Independent read-only Codex Code Review must inspect full cumulative incident fix from `f4c189962e94661d1f4dde06c798c476e2aa149b` to `c208f4ac04026a984e7228f2dbe77a3a9b2f2527`, then Chat must adjudicate. No merge, installation, Control workflow replacement, target activation or runner start approved. Safe intake still reports unresolved **legacy** Windows workflow jobs; it does not silently repair/cancel live Control history. Permanent elimination of old queue requires separate authorized workflow/installer migration.

P3 separate independent review remains NEEDS_HUMAN at immutable checkpoint `1398411d1c10c2d0808284997f780717f750cb1d`; P3 7/7 exhausted, never create P3 iteration 8 without user approval.
