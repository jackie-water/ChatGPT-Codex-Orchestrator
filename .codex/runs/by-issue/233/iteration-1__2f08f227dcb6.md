# macOS Chat registration offline incident — iteration 1/5 immutable implementation report

- **Execution type:** Controller-verified Mac native Codex implementation; NOT a completed Windows `[CODEX-AUTO]` workflow.
- **Project:** `orchestrator-dev`
- **Incident / source tracking:** public issue `jackie-water/ChatGPT-Codex-Orchestrator#10`.
- **Control request:** private Issue #233 `[CODEX-RUN]`, registered originating Chat `review_route=chat-232`.
- **Control Windows-only Action:** run `38981357142` CANCELLED, `run-codex` job cancelled before execution because legacy self-hosted Windows runner is offline. Manual Mac Codex is the implementation executor. Never count this as `CODEX-AUTO`.
- **Task branch:** `fix/macos-chat-registration-offline-20261017` (nondefault, nonprotected).
- **Exact parent source commit:** `f4c189962e94661d1f4dde06c798c476e2aa149b`.
- **Exact implemented source commit:** `2f08f227dcb68d7d16b45edf6aba293f1aecfc22`.
- **Logical iteration:** 1 of configured 5; any delta refinements before commit were performed by `codex exec resume` in the same initial Codex session `01a14709-bad6-7412-ab2c-9bb4bea23f16`, `Codex CLI 0.162.1`, model `gpt-5.6-luna`. No second implementation task or iteration.
- **Source tree:** 9 files changed: 293 insertions, 12 deletions. Includes new `runtime/scripts/register-chat-mac.mjs`, callback delivery/register/wake/failed-run timeout correction, project instructions English and Chinese, and focused tests.
- **Codex:** edited only isolated task worktree `/Users/Jackie/Developer/ChatGPT-Codex-Orchestrator-ChatReg-Fix-20261017`. It did NOT commit/push/merge/install/activate. Controller independently checked/staged, committed and pushed the exact source SHA to the above task branch.
- **Original P3 worktree:** `feat/macos-official-installer-migration` remains at `f4c189962e94661d1f4dde06c798c476e2aa149b` and clean; Windows published `main` remains `85361876d587d824b18bf28e7367ef86c32040cf`.

## Incident root cause and implementation
1. Legacy private Control `.github/workflows/orchestrator.yml` schedules `[CHAT-REGISTER]` on offline self-hosted Windows runner `codex-orchestrator-JACKIE`. GitHub job queuing outlasts `timeout-minutes:10`. Previous new Chat #212 and new #232 both encountered the same dead queue. No automatic route registration is possible on this legacy workflow with its runner offline.
2. Mac native `register-chat.mjs` outer callback subprocess timer 30 seconds was shorter than `wake-chat.mjs` pre-send wait up to 60 seconds. It could terminate while a Chat was busy; old callback state advanced to `SUBMISSION_ATTEMPTED` even before an actual Send click.
3. Added native Mac Issue-intake entrypoint that uses authenticated `gh` to validate exact trusted private Control/instance/Issue/project/user, enumerate and reconcile ALL paginated Issue Actions runs, fail closed on unknown, active, online, conflicting or truncated evidence, cancel/verify **only** the matching queued `register-chat` workflow. No runner is started. The native path creates/reuses persisted route/outbox and optionally delivers, without changing the Windows published workflow.
4. Repaired two-phase delivery: `PENDING` while Send is not ready; durable `SUBMISSION_ATTEMPTED` immediately **before** a real click; ambiguous subsequent results reconcile-only; `DELIVERED` requires actual user-role receipt. Outer timeout 150 sec preserves inner bounded pre-send/receipt check. True original user draft/destination and callback id are preserved.
5. Mac-specific fake GH/runner fixtures cover legacy `instance.json`, empty-body cancel, pagination >100, conflicting/unknown/online tasks, trusted repo metadata, untrusted delivered record, callback pre-click journal and retry, and idempotence. No live Control / Sandbox / target interactions during test.

## Independent controller wrapper validation
- JavaScript syntax checks for all edited JS files: PASS.
- `git diff --check` and staged diff: PASS.
- Focused Mac native register and callback tests: **27 tests / 27 PASS / 0 FAIL**.
- Full Mac Node suite: **342 tests / 333 PASS / 0 FAIL / 9 expected platform SKIP**.
- Exact source parent and remote task branch SHA verified; source worktree clean after controller commit.
- Legacy Control private Actions queue canceled and offline Windows runner was not started.
- **No valid independent code review has yet been applied to this exact source SHA at time of report creation.** CI on PR to be checked separately.

## Hard gates
This is **implementation evidence only**, not independent Code Review, overall PASS, installation approval, or merge approval. Source is NOT merged. P3 independent review of `f4c189962e94661d1f4dde06c798c476e2aa149b` separately adjudicated `NEEDS_HUMAN` with checkpoint `1398411d1c10c2d0808284997f780717f750cb1d`; that exhausted 7/7 P3 iteration is unchanged. Real target, Sandbox-only merge, Windows main, Priceup, Clean Energy, launchd/runner services, and credentials remain untouched.
