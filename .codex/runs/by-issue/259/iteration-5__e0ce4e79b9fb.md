# Incident #10 — macOS Chat registration and callback-lock REVISE 5/5

## Immutable implementation identity

- Project: `orchestrator-dev` under `explicit-route-v1`; originating Chat's exact registered `review_route=chat-232`.
- Private Control implementation request: issue **#259**, existing human-authorized technical workflow iteration **5/5**, same Issue #10 chain (no duplicate/new CODEX-RUN).
- Source: `jackie-water/ChatGPT-Codex-Orchestrator`, nonprotected branch `fix/macos-chat-registration-offline-20261017`.
- **Exact resulting source implementation SHA: `e0ce4e79b9fb399028dd78a6f1516e54e71ec977`.**
- **Exact independently reviewed parent SHA: `c97e7367e36084e568987c07fe87405fed7b4951`.**
- **Full Incident #10 comparison base: `f4c189962e94661d1f4dde06c798c476e2aa149b`** (not only 5/5 delta).
- Prior independent review checkpoint: `d6bd6f40dc72b85b9c0ea05838aae2f7b8d7c82d`, report `.codex/reviews/by-commit/c97e7367e36084e568987c07fe87405fed7b4951.md`; technical REVISE required.
- One logical manual Mac native Codex CLI 0.162.1 implementation session **`01a147ec-7000-72a0-b04e-c595c84fd020`**, low reasoning, reused for deterministic controller-discovered corrections. Codex did not commit, push, merge or deploy.
- Configured default `max_iterations=5` unchanged; this was the last configured iteration. No 6/5 run or unapproved merge/installation.

## Exact 5/5 technical correction

Exactly two permitted paths changed, **144 insertions / 3 deletions**:
1. `runtime/scripts/callback-delivery.mjs`: if this invocation successfully created its own exclusive callback delivery lock but its initial owner write or `fsync` fails, verify its open fd and pathname refer to the same regular, owner-owned, private-mode single-link inode and any partial owner bytes match this invocation, then clean up ONLY the failed own lock. Recheck file identity before deletion. If the named inode changes, becomes a symlink/foreign/mismatched or remains uncertain, preserve it. EEXIST on another owner never unlinks that lock.
2. **Platform-aware descriptor order**: POSIX unlinks the verified own failed lock with the fd open, syncs parent directory, closes fd once. Simulated Win32 closes its fd once **after identity proof and before unlink**, revalidates pathname identity after close, and does not attempt directory `fsync`. Catch path coordinates close ownership to avoid double-close. This intentionally does **not** claim that pathname validation plus unlink forms an atomic defense against an arbitrary malicious same-user last-instruction swap.
3. `tests/callback-reliability.test.mjs`: private temporary HOME/fake fsModule test cases for failed own write/fsync cleanup and retry, partial owner write versus foreign bytes, existing lock preservation, symlink/replacement and exact post-read swap retention, simulated Win32 open-descriptor unlink denial/close-once/foreign post-close replacement, no Win32 directory sync, and no callback send before valid lock. Existing ambiguous `SUBMISSION_ATTEMPTED` and verified user-role receipt boundaries preserved. No real Chrome, ChatGPT, GitHub, Control, Sandbox, Target or Windows machine involved.

## Independent controller wrapper validation

- Exact two-file change allowlist, parent commit, task branch identity and clean worktree postcommit: VERIFIED.
- `git diff --check`, staged diff and `node --check` on both edited files: PASS.
- Focused `tests/callback-reliability.test.mjs` after final correction: **23/23 PASS, 0 FAIL**.
- Full Mac `node --test tests/*.test.mjs` after final correction: **351 tests, 342 PASS, 0 FAIL, 9 expected platform SKIP**; process exit 0. Evidence log retained on Mac at `/private/tmp/issue10-5-full-verified-20261017.log`.
- A preliminary independent READ-ONLY native Codex review first identified late pathname-swap and Win32-open-descriptor deletion hazards; controller reproduced the swap with a deterministic injected filesystem fault, then sent concise same-session REVISE deltas. Both boundary cases are covered by the final focused tests. This preliminary review was not a final exact-SHA whole-chain review.
- [Exact-SHA GitHub CI run #39001769092](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/39001769092): **COMPLETED SUCCESS**, hosted `node-tests` and `windows-static` both **SUCCESS**. Windows compatibility here is simulated/static; the retired Windows runner/computer was not used.
- GitHub Draft PR #11 remains OPEN/DRAFT/unmerged with exact source head `e0ce4e79b9fb399028dd78a6f1516e54e71ec977`, base `f4c189962e94661d1f4dde06c798c476e2aa149b`. Source public `main` remains at `85361876d587d824b18bf28e7367ef86c32040cf`.

## Preserved gates and next step

- The private Control Actions workflow ID 373801036 remains `disabled_manually`; registered self-hosted runners 0. No Windows or Mac runner/startup, private Sandbox CODEX-RUN, real user-role callback, installation, merge, deployment or real Target activation was performed. Issue #10 branch remains isolated from the already independently review-only PASS P3 source SHA `9203170f74b57dade7702fb0530e994ecf531c17`.
- **NEXT:** create a distinct `[CODE-REVIEW]` in the private Control repository with the **same `chat-232` route**, exact source branch and exact 40-SHA, then independently run **read-only full cumulative Issue #10 Code Review** from `f4c189962e94661d1f4dde06c798c476e2aa149b` to `e0ce4e79b9fb399028dd78a6f1516e54e71ec977`. Publish immutable `.codex/reviews/by-commit/<SHA>.md` and have Chat independently adjudicate PASS/REVISE/NEEDS_HUMAN. This implementation validation does NOT authorize merging. Any further technical CODEX-RUN beyond configured 5/5 requires separate authorization.
