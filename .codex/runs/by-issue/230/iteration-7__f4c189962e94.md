# P3 — Human-approved 7/7, native macOS verified-Sandbox resume checkpoint

## Immutable source and authorization

- Project: `orchestrator-dev`
- Control issue: **#230**, `[CODEX-RUN] P3 approved seventh Sandbox-verified setup resume correction`
- Registered current-chat review_route: **`chat-212`** (actual user-role registration, not fallback)
- Task: **P3 technical iteration 7/7**, one user-approved technical exception to original configured default maximum `5`. The default was NOT changed.
- Source repository: `jackie-water/ChatGPT-Codex-Orchestrator`
- Nondefault task branch: `feat/macos-official-installer-migration`
- **Exact final implementation source SHA:** `f4c189962e94661d1f4dde06c798c476e2aa149b`
- **Exact independently reviewed parent SHA:** `2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8`
- Full P3 stacked source base: `a7eea5213d87440e7cdf351a5e9a1271439dd185`
- Parent independent review checkpoint: `6a98b7d643fe4767d877f8803c9863a14edc4c97`; path `.codex/reviews/by-commit/2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8.md`
- Codex local Mac implementation session: `01a14470-5819-7311-9104-2b05288aa585`, Codex CLI `0.162.1`, model `gpt-5.6-luna`, low reasoning, workspace-write, final exit `0`. Same session reused to correct narrow deterministic focused test fixture issues. No new iteration or overlapping executor started.
- Windows-only Control workflow run `38892836545` was **canceled before execution** (`run-codex` CANCELLED), because only the offline Windows self-hosted runner was registered; Mac execution was user-authorized independently. **No `[CODEX-AUTO]` callback is claimed as delivered for this manual Mac implementation.**
- Codex did not commit, push or merge. The Chat/controller independently validated and then created/pushed this exact commit on the nondefault task branch. No force push, no protected main modification.
- User merge approval: **NOT GRANTED**; user did not authorize service installation, target activation or Sandbox merge.
- Independent exact-final-SHA Code Review: **PENDING**, must be separately invoked and adjudicated.

## Narrow seventh-iteration correction

Two P3-allowed changed files only, `src/cli.mjs` and newly added `tests/macos-p3-setup-resume.test.mjs`. Source diff versus exact parent is **104 insertions / 3 deletions**.

The previously confirmed P1 was that the Darwin `runSetup()` code unconditionally set `macos_native_setup=SANDBOX_READY` and returned `WAITING` for Sandbox verification even when the original Sandbox had completed. The correction:
1. Preserves the existing official prerequisites, immutable Control+Sandbox repository identities, exact originating registered Chat route, and private GitHub authorization gates. Accepts real historical registered route records that lack optional `installation_id`; validates the canonical project key bound to the installation, normalized original Chat URL, active route, and refuses changes to an already bound route.
2. Uses `sandboxSmokeStatus(state)` for independent `PASS`/`COMPLETE` confirmation of the same installation's expected smoke-test branch. A saved `sandbox_verified=true` boolean on its own is insufficient to advance.
3. If incomplete or unverifiable, remains `SANDBOX_READY` / `WAITING sandbox_verification`; unreadable evidence fails closed. If actual same-instance smoke COMPLETE, persists `sandbox_verified=true`, `macos_native_setup=SANDBOX_VERIFIED`, and progresses to the preexisting supported `codex_trust_project` human action exactly once.
4. When project trust is already recorded, it persists an idempotent distinct `POST_SANDBOX_HANDOFF` with explicit `MACOS-POST-SANDBOX-UNSUPPORTED` instead of requesting trust repeatedly or pretending the unfinished native review/merge/target activation is READY. **The real target registry remains DISABLED; no Code Review, Merge, LaunchAgent or runner is automatically activated.**
5. Leaves Windows installer/setup path and the previously reviewed P2.2b.1/P2.2b.2/P3 native runtime bundling and refresh code unchanged.

## Independent deterministic wrapper validation

- Mac Node `v24.22.0`, command `node --test tests/*.test.mjs`: **337 total, 328 PASS, 0 FAIL, 9 expected platform SKIP**.
- Focused new behavioral regression file `tests/macos-p3-setup-resume.test.mjs`: 3/3 PASS (two static scope tests plus real native production CLI subprocess with temp HOME).
- Independent temporary fake HOME/fake Git, GitHub CLI, Codex and launchctl experiment additionally checked five states: incomplete remote Sandbox, forged verified boolean, matching COMPLETE -> project trust, post-trust unsupported handoff, repeated post-trust handoff. All behaved deterministically. Fake command audit contained zero GitHub issue creates, push/commit, launchctl bootstrap/bootout or PowerShell actions. No live project repo, target or service was modified.
- `node --check` for both changed JS files: PASS; `git diff --check`: PASS.
- GitHub exact-source [Development CI run 38895432336](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38895432336): overall **SUCCESS** for `f4c189962e94661d1f4dde06c798c476e2aa149b`; `node-tests` SUCCESS and `windows-static` SUCCESS.
- Mac local task branch and remote branch both pinned to `f4c189962e94661d1f4dde06c798c476e2aa149b`, source worktree clean. Public `main` stays `85361876d587d824b18bf28e7367ef86c32040cf`.
- Draft PR #9: `https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/pull/9`; still draft/unmerged.

## Explicit scope limits and next gates

Implementation test success does **not** mark P3 as feature-complete. Native `macos-code-review.mjs` and `macos-merge-approved.mjs` remain intentionally fail-closed (exit 78); full official Mac installer/service + isolated Sandbox live E2E, Windows-to-Mac runner handoff and P4–P6 remain separate gated tasks. The seventh technical exception authorizes no eighth automatic revision and **does not authorize a merge**. A fresh independent read-only Code Review for exact `f4c189962e94661d1f4dde06c798c476e2aa149b` must be performed, published immutably and independently adjudicated before any overall P3 PASS statement.

No real Sandbox merge or target activation, no Windows `main` update, and no Priceup/Clean Energy production changes.
