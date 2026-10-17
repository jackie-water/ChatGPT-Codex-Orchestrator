# P3 macOS technical correction — 8/8 implementation report (immutable)

## Exact identities
- Project: `orchestrator-dev` — originating current Chat `review_route=chat-232`.
- Private Control implementation request: [Control Issue #243](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/243).
- **Explicit human authorization:** exactly ONE extraordinary P3 revision **iteration 8/8** for confirmed Git remote, success callback, Sandbox proof, LaunchAgent and runner-health gates. Configured project default `max_iterations=5` was not increased. Authorization does **not** include iteration 9, merge, live installation, runner start, sandbox/target activation or deployment.
- Source repository: `jackie-water/ChatGPT-Codex-Orchestrator`.
- Nonprotected task branch: `feat/macos-official-installer-migration`.
- **Exact committed source SHA:** `eeb3a65f27a6f6b23744ba6adf8503519357f5e5`.
- Exact source parent SHA: `f4c189962e94661d1f4dde06c798c476e2aa149b`.
- Independent previous-P3 full-review checkpoint: `ef095e34457be75f0b3256ab1d9464f6ffb142e0` at `.codex/reviews/by-commit/f4c189962e94661d1f4dde06c798c476e2aa149b.md`, verdict NEEDS_HUMAN.
- Full P3 review base remains `a7eea5213d87440e7cdf351a5e9a1271439dd185`, not the last small patch alone.
- Developer MacBook `MacBook-Air.local`. Manual native macOS Codex CLI `0.162.1`, model `gpt-5.6-luna`, implementation session `01a14771-cfef-7fa0-b3ef-17211bc56d9d`, initial low and same-session medium reasoning. All deterministic follow-up prompts were within the SAME approved 8/8 logical iteration; no new CODEX-RUN. Codex itself did NOT commit, push, merge or deploy.

## Exact implementation delta (6 changed files, 76 additions / 27 deletions)
1. `runtime/scripts/macos-dispatch.mjs`: absent optional `remote.origin.pushurl` (git exit 1, empty) falls back to the single checked fetch URL; invalid/conflicting push URLs remain subject to strict remote identity validation.
2. `src/cli.mjs`: Darwin Sandbox calls opt into strict verification and runner health relies on launchctl agent evidence, not mere filesystem existence; Windows setup routing unchanged.
3. `src/lib/sandbox-smoke.mjs`: legacy non-strict Windows ready-marker shortcut preserved. Mac strict path checks installation-specific branch, reviewed commit, implementation/report and matching Control review request, approval intent and merge ancestry; incomplete or unprovable human merge authorization is reported `NEEDS_HUMAN/MERGE_EVIDENCE_UNVERIFIED` rather than false COMPLETE.
4. `src/lib/macos-platform.mjs`: HOME, LaunchAgent parent/leaf identity/symlink checks and secure bounded paths; read-only runner status distinguishes an active named agent from a mutating collision. No real service started.
5. `src/lib/macos-postexecution-wrapper.mjs`: after immutable checkpoint publication, attempt exact Chat callback via registered Control `scripts/wake-chat.mjs`; preserve durable idempotency and only trust genuine user-role receipt to mark DELIVERED; ambiguous/outage retains pending/reconciliation state. No Codex rerun on delivery failure.
6. `tests/macos-p3-setup-resume.test.mjs`: fake only-ready test now correctly asserts wait/idempotent/target disabled rather than falsely treating ready as verified.

## Independent controller validation
- Source branch local and remote exact SHA matched after non-force push; worktree clean, task PR #9 remained OPEN/DRAFT and unmerged.
- `node --check` of changed JavaScript files: PASS; `git diff --check` and staged diff: PASS.
- Isolated Mac P3 focus tests: **12/12 PASS, 0 FAIL**.
- Full Mac node suite: **337 tests, 328 PASS, 0 FAIL, 9 expected platform SKIP**.
- Additional controller isolated temporary HOME/fake-launchctl boundary fixtures: **5/5 expected outcomes**. Private-normal HOME installation simulated successfully; HOME, Library, LaunchAgents and dangling plist symlinks refused. No real launchctl or instance installation in fixtures.
- Native Codex preliminary READ-ONLY diff review on uncommitted revision: no definite *newly introduced* issue; this was not a final exact-SHA whole-phase Code Review.
- [GitHub Development CI run #38991518059](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38991518059): exact source SHA `eeb3a65f27a6f6b23744ba6adf8503519357f5e5` **SUCCESS**; jobs `node-tests` and `windows-static` both SUCCESS. Windows job is static analysis, **not** actual Windows-machine regression.

## Explicit limitation, non-authorization, next gate
- Implementation/wrapper checks do **NOT** establish full P3 product PASS. Mac native Code Review and merge adapter scripts remain fail-closed (exit 78), actual macOS runner and LaunchAgent are not installed/started, and full private Sandbox-first live E2E, original Chat actual callback receipt, multi-Chat isolation, and Windows real regression have not completed.
- Strict Sandbox proof cannot infer human user-role authorization from arbitrary mutable booleans/issue text; missing independent approval/merge evidence remains a guarded human gate. No real Sandbox merge or target activation was attempted.
- The independent source Issue #10 registration timeout fix and private Control macOS workflow Draft PR #242 remain separate/unmerged; Control GitHub Actions workflow ID 373801036 is disabled, retired Windows runner deregistered, and registered Control runners count 0.
- `main` remains Windows published source `85361876d587d824b18bf28e7367ef86c32040cf` and was not touched. No Priceup or Clean Energy production actions.
- **NEXT:** independent native macOS Codex READ-ONLY Code Review of the FULL P3 cumulative diff from exact `a7eea5213d87440e7cdf351a5e9a1271439dd185` through `eeb3a65f27a6f6b23744ba6adf8503519357f5e5`; Chat independently adjudicates PASS/REVISE/NEEDS_HUMAN. PASS remains review-only, NEVER merge approval. P3 has exhausted authorized 8/8; any further CODEX-RUN requires new specific user consent.
