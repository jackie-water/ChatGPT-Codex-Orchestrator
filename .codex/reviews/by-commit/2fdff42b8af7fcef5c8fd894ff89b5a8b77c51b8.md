# Independent read-only local Code Review — P3 exact SHA (manual handoff)

## Fixed immutable identity

- project: `orchestrator-dev`
- source repository: `jackie-water/ChatGPT-Codex-Orchestrator`
- source branch: `feat/macos-official-installer-migration`
- **exact reviewed commit:** `2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8`
- exact parent: `f1e0e9840bfc62467af96d6bcc96c67f2bb0b516`
- **full P3 phase diff base:** `a7eea5213d87440e7cdf351a5e9a1271439dd185` (`feat/macos-postexecution-wrapper`)
- originating registered Chat route: **`chat-212`**, no fallback or route replacement
- implementation evidence checkpoint `19c9d0c44f1e08482e84594f88f6e3ea33aaf01a`, path `.codex/runs/manual/p3-iteration-6__2fdff42b8af7.md`
- review type: independent Codex CLI read-only **manually initiated local review**, NOT an official Control `[CODE-REVIEW]` issue
- review model: gpt-5.6-luna, medium; Codex CLI v0.162.1
- review session: `01a14465-ea97-7f52-9bf7-b6a2dca744d5`
- review command shape: `codex review --base feat/macos-postexecution-wrapper`; read-only sandbox; completed exit code 0
- reviewer findings: **two P1 candidates** (not blindly accepted)
- **Chat independent adjudication: 1 CONFIRMED blocking P1, 1 FALSE POSITIVE; overall P3 NEEDS_HUMAN, NOT PASS**
- exact-source human merge approval: NOT GRANTED
- sixth technical rotation user authorization: YES, but user specifically authorized a narrow two-P1 correction; default cap remains 5 and **no seventh rotation authorized**

## Previously blocking P1s corrected by sixth implementation

- Generated private Control repository import packaging: `src/lib/control-runtime-bundle.mjs` explicitly packages 34 allowlisted runtime scripts and native libraries, validates source/target path safety, ESM import dependency closure and new generated layout before publishing. Isolated direct Node imports and vm linkage inside only the private fake Control tree PASS. The original `ERR_MODULE_NOT_FOUND` reproduction is eliminated for the bundled entrypoint/import fixtures; production live Sandbox run remains untested.
- macOS runtime refresh template: `src/lib/control-env.mjs` validates persisted platform, architecture, runner, trusted owner and Control metadata; selected macOS/ARM64 or macOS/X64 template survives repeated refresh, preserving static trusted user and registered routes. Windows workflow behavior separately tested. Preflight mismatches reject before write.
- No Change to public Windows v0.1.0 main or existing Priceup / Clean Energy systems.

## New reviewer finding 1 — CONFIRMED P1, pre-existing P3 functional blocker

**`src/cli.mjs` Mac `runSetup` lines approx. 292–293: Sandbox-verified state cannot progress.** After verified Sandbox route registration, the Darwin branch always sets `state.macos_native_setup='SANDBOX_READY'`, `state.current_step='sandbox_verification'`, and **returns `WAITING`** without testing the already persisted `state.sandbox_verified` or joining the post-Sandbox activation state machine. Thus even a verified Sandbox in official Mac `resume` cannot transition to the next supported state, and the installer never reaches READY/target activation. Source checks explicitly show the standalone Darwin return and separate legacy Windows post-Sandbox branch below. This is not resolved by the sixth narrow two-P1 patch, and user authorization does not extend to an unapproved seventh source change. Must preserve `PROJECT_DISABLED` until actual Sandbox COMPLETE; resolve as a concise deterministic technical correction only after explicit new authorization.

## New reviewer finding 2 — independently REJECTED false positive

Reviewer claimed the running LaunchAgent appears with its own GitHub runner label in `launchctl list` and therefore triggers the same-runner conflict in `detectConcurrentRunner()`. This conflates two **distinct identity namespaces**:

- GitHub runner label: `codex-orchestrator-abc12345`
- LaunchAgent reverse-DNS label: `com.chatgpt.codex.abc12345`

`detectConcurrentRunner` searches for the GitHub runner label, while actual `launchctl list` reports the LaunchAgent label. Chat independently invoked real source `detectConcurrentRunner`, `migrationPreflight` and `macosRuntimeAction('status')` on the Mac with injected **fake launchctl list/print** (no launchctl service mutation, fake source only). For a list containing `123 0 com.chatgpt.codex.abc12345`, it returned `foundUnrelatedRunner=false`, `preflight='READY'`, `macosRuntimeAction.status='PASS'`, `launchctl_state='loaded'`. The fixture with a genuine colliding `codex-orchestrator-abc12345` label returned `preflight='CONFLICT'`. Hence **the reviewer's specific claimed reproducible failure is not present**. This does not establish cross-machine legacy Windows runner isolation in a real E2E; those remain unverified.

## Independent tests and CI

- Authoritative Mac Node v24.22.0 complete `node --test tests/*.test.mjs`: **334 total / 325 PASS / 0 FAIL / 9 expected macOS skips**.
- Focused packager/refresh tests: **121 total / 121 PASS / 0 FAIL**.
- Changed JS syntax checks: PASS; `git diff --check`: PASS.
- Exact source GitHub Development CI [38891692612](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38891692612) overall **SUCCESS**: `node-tests` SUCCESS, `windows-static` SUCCESS, exact source SHA `2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8`.
- Read-only reviewer could not create temporary test directories inside its sandbox (`EPERM`); its attempted test run is not accepted as validation evidence. Mac controller tests and exact SHA GitHub CI independently establish validation.
- Local task HEAD and remote `feat/macos-official-installer-migration` both equal `2fdff42b8af7fcef5c8fd894ff89b5a8b77c51b8`; source tree clean; public `main` remains `85361876d587d824b18bf28e7367ef86c32040cf`.
- No GitHub Control `[CODEX-RUN]` or `[CODE-REVIEW]` ticket was created for the manual sixth implementation because the official Control Issue operation was platform safety-blocked. A manual review is **not represented as formal orchestrated review evidence**, and cannot substitute for required registered Control approvals.

## Additional unchanged P3 delivery gates

- Native generated `runtime/scripts/macos-code-review.mjs` and `macos-merge-approved.mjs` still deliberately fail closed exit 78: not native functional review/merge adapters. Do not pretend a green CI or manual review proves these actions.
- Mac runner installation and ownership handoff, exact Sandbox-only registered original Chat callback delivery, Sandbox FULL E2E and subsequent real-target activation have not been demonstrated.
- No seventh technical rotation/merge authorized; do not issue a successor `[CODEX-RUN]` or `[MERGE-APPROVE]` from this manual session. Keep Draft PR #9 unmerged and real target `PROJECT_DISABLED`.

**FINAL: NEEDS_HUMAN — one confirmed P1 / one false-positive reviewer comment; review-only, no merge.**
