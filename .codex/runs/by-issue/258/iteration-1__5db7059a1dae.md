# Native macOS exact-SHA independent Code Review adapter — initial implementation 1/5

## Exact immutable identity and authorization

- Project `orchestrator-dev`, originating current Chat's registered `review_route=chat-232` (`explicit-route-v1`).
- Implementation authorization: private Control **#258**, initial Codex rotation **1/5** within the configured default limit 5. User agreed to advance the next isolated native Code Review stage. Codex did NOT commit, push, merge, install or deploy.
- Repository: `jackie-water/ChatGPT-Codex-Orchestrator`; nonprotected branch `feat/macos-native-code-review-adapter-20261017`.
- **Exact resulting source commit SHA: `5db7059a1daedc30bfec3cddfcabeef52751ade5`.**
- **Exact pinned parent SHA: `9203170f74b57dade7702fb0530e994ecf531c17`**, the separately independently reviewed P3 source candidate. The independent Code Review must compare this exact parent to this exact new head; Source main is NOT the baseline for this staged integration change.
- One logical native Mac Codex CLI 0.162.1 session `01a147e6-8607-7e11-9c85-de1389fa7348`, model `gpt-5.6-luna` with low/medium reasoning; continued same session for deterministic controller-detected corrections. No duplicate CODEX-RUN/second iteration.
- The initial implementation remains **DRAFT / NOT MERGED**. The matching source [Draft PR #12](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/pull/12) has head exactly this SHA and base `feat/macos-official-installer-migration` at `9203170f74b57dade7702fb0530e994ecf531c17`, isolating it from Windows/main.

## Source implementation and isolation

Exactly seven code/test paths modified or added, 343 insertions / 8 deletions:
1. `runtime/scripts/macos-code-review.mjs`: replaces fail-closed 78 placeholder for native **Code Review only** with a CLI workflow requiring exact authenticated issue-event path, Control checkout/repo, trusted GitHub identity. Validates private Sandbox project, active exact originating Chat route, reviewed commit, task branch, local isolated clone and remote identities before any review. Runs Codex read-only and prepares immutable exact-reviewed-SHA report.
2. `src/lib/macos-code-review-runtime.mjs`: new explicit native review implementation; verifies original event, installation/runner identity, Safari/Chrome-independent trust boundaries, Sandbox-only enabled/real Target disabled, safe local automation clone and GitHub remote, no protected branch, exact reviewed source SHA and ancestry, project Code Review policy. Handles SHA-specific prior immutable review evidence and callback identity.
3. `templates/control-repo/orchestrator.macos.yml.template`: binds **only** macOS Code Review job to GitHub event-path, checkout control-root/repository and trusted GitHub identity; preserves other native job definitions and **native Merge executor exit-78 fail-closed**.
4. `src/lib/control-runtime-bundle.mjs`: explicitly adds the native review helper to the vetted private Control runtime dependency closure rather than untrusted recursive copying.
5. `tests/macos-code-review-runtime.test.mjs`, `tests/control-runtime-bundle.test.mjs`, `tests/control-runtime-refresh.test.mjs`: isolated Mac fixtures and runtime dependency tests covering trusted Control/Sandbox/Chat route, official `codex/checkpoints`, malformed/protected checkpoint refs, foreign authors, disabled-target gate, immutable review marker/status parsing, callback PENDING/ambiguous preservation, publication intent directory not mixed into pending callbacks, explicit ESM bundle/import closure, and runtime refresh fixture recognizing the new helper.

Same-session controller-directed corrections:
- Test fixture originally began at a symlinked macOS `/var` temp path; fixed to use the canonical temp root rather than weakening production `privateTree` symlink checks.
- New checkpoint validation initially rejected its own official `codex/checkpoints` branch; corrected to strict safe slash-ref handling with malicious-ref negative tests.
- Review publication journal initially polluted `pending-wakes/*.json`; moved to a separate private `review-publication-intents/<SHA>.json` with callback-only pending directory.
- Published `CODE_REVIEW_FAILED` status initially produced a successful Actions exit code; now returns nonzero while preserving immutable failure evidence/outbox.
- Expanded original `tests/control-runtime-refresh.test.mjs` runtime bundle fixture to include the new required helper; existing Windows and Mac runtime refresh tests preserved.
- Preliminary independent uncommitted review suggested automatic retry of a previously published immutable `CODE_REVIEW_FAILED` report for identical SHA. The overarching project rule explicitly forbids rerunning Code Review for an unchanged SHA when valid by-commit evidence already exists, so implementation retains fail-closed immutable conflict pending a separate explicit policy/versioning decision, not a silent overwrite or automatic rerun.

## Independent controller wrapper validation and CI

- Exact 7-file allowlist and parent/branch identity: PASS. Source and remote task-branch SHA matched exactly after non-force push. Clean worktree and Source/main unaffected.
- `git diff --check`, staged diff check, and Node syntax checks on edited native files: PASS.
- Focused unit/bundling/runtime-refresh suites: **128/128 PASS, 0 FAIL**.
- Full native Mac Node suite: **351 tests / 342 PASS / 0 FAIL / 9 expected platform SKIP**, command exit 0; private Mac wrapper evidence at `/private/tmp/mac-review-adapter-full-v2-20261017.log`.
- [Exact-SHA GitHub CI run #39002198676](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/39002198676): **COMPLETED SUCCESS**, hosted `node-tests` and `windows-static` jobs SUCCESS. Windows-static is static compatibility only, NOT a retired Windows runner.
- Security-sensitive external actions **NOT** tested live: no actual private Sandbox Code Review Issue was executed, no real GitHub code review or browser/Chat callback delivery occurred, no Mac runner/LaunchAgent started. Unit tests and CI do not establish a complete live E2E.

## Preserved controls and next mandatory gate

- Actual private Control Actions workflow ID 373801036 remains `disabled_manually`, registered runners 0; no queued/in-progress jobs, Source/main at `85361876d587d824b18bf28e7367ef86c32040cf` untouched.
- Separate Issue #10 exact SHA `e0ce4e79b9fb399028dd78a6f1516e54e71ec977` on Draft PR #11 was independently reviewed PASS-only; both are unmerged, as is P3 core Draft PR #9. Native Mac Merge executor remains deliberate exit-78 refusal, and Control Mac-only Draft PR #242 remains unmerged. No Priceup/Clean Energy/retired Windows/Target action.
- **NEXT**: create `[CODE-REVIEW]` via the exact registered Chat route `chat-232`, pinned source branch and exact 40-character SHA above; independently run read-only Codex Code Review on the full incremental adapter delta from parent `9203170f74b57dade7702fb0530e994ecf531c17` to `5db7059a1daedc30bfec3cddfcabeef52751ade5`; save immutable `.codex/reviews/by-commit/<SHA>.md`, then Chat adjudicates PASS/REVISE/NEEDS_HUMAN. PASS remains review-only; merge requires explicit user approval of the exact SHA and safe dependency sequencing.
