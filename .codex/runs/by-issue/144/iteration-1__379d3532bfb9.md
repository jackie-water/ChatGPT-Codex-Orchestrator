<!-- CODEX_ORCHESTRATOR_CHECKPOINT_V2 -->
# Codex Latest Run

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- published_at_utc: 2026-10-07T05:48:14Z
- source_branch: fix/instance-pending-health
- source_commit: 379d3532bfb91318547c8065f0ffb7d4c7a7e4e9
- checkpoint_branch: codex/checkpoints
- history_file: .codex/history/20261007T054814Z__fix-instance-pending-health__379d3532bfb9.md
- run_file: .codex/runs/by-issue/144/iteration-1__379d3532bfb9.md
- orchestrator_issue: 144
- iteration: 1
- publisher: Codex-Orchestrator

---

## Objective

Make status/doctor report the real instance-scoped pending callback queue and fail doctor health when unresolved callbacks remain.

## Result

Status: READY_FOR_REVIEW

## Orchestration

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator-Dev
- orchestrator_issue: 144
- iteration: 1
- max_iterations: 5
- project_iteration_limit: 5
- source_branch: fix/instance-pending-health
- source_commit: 379d3532bfb91318547c8065f0ffb7d4c7a7e4e9
- default_branch: dev/v0.1-sandbox-e2e
- codex_model: gpt-5.6-luna
- codex_reasoning: low
- codex_exit_code: 0
- codex_tokens_used: 39034
- prompt_chars: 3128
- prompt_limit: 12000
- wrapper_validation_steps: 1
- review_route: chat-103

## Changed files

- src/cli.mjs
- tests/instance-isolation.test.mjs

## Wrapper validation

- wrapper git diff --check: PASS
- full test suite: PASS

  Output tail:
   every explicit push URL before mutation (84.6997ms)
  ✔ runtime refresh preserves mature control state and is idempotent (7249.2195ms)
  ✔ runtime refresh rolls back a committed refresh when push fails and retries (7965.4207ms)
  ✔ runtime refresh rejects every remote-main mismatch before mutation (9.6366ms)
  ✔ runtime refresh rejects pre-staged changes before copying (4476.8672ms)
  ✔ runtime refresh rejects missing or mismatched control identity before mutation (383.9575ms)
  ✔ dry-run reports the installation plan without enabling the real project (6097.8876ms)
  ✔ Windows guided installer handles every setup user action (19.447ms)
  ✔ AI JSON mode remains non-interactive (2.6128ms)
  ✔ Chinese request stays Chinese (28.5927ms)
  ✔ English is default for unknown languages (2.4427ms)
  ✔ runtime refresh messages and error catalog stay covered (0.9866ms)
  ✔ implementation callbacks point to immutable per-issue reports (15.4813ms)
  ✔ code review callbacks point to immutable by-commit evidence (7.2135ms)
  ✔ installer prepares only the sandbox before sandbox verification (12.7332ms)
  ✔ all remote execution entrypoints block disabled projects (8.4417ms)
  ✔ generated control registry disables the real project until activation (1.6053ms)
  ✔ setup requires ChatGPT access to generated private repos before Codex trust (1.3102ms)
  ✔ sandbox Chat registration happens before sandbox CODEX-RUN (1.3239ms)
  ✔ real project Chat registration happens only after sandbox activation and before READY (1.3778ms)
  ✔ runtime context derives config and queues from instance metadata (5.5237ms)
  ✔ runtime entrypoints do not read the old shared config path (33.0431ms)
  ✔ callback queues are scoped to the installation instance (6.198ms)
  ✔ control environment writes instance metadata and an instance-scoped config (1.2552ms)
  ✔ installer launches the callback browser with its exact port and profile (1.3575ms)
  ✔ runtime health counts only the current instance pending-wakes directory (2.0099ms)
  ✔ runtime health has no queue fallback before instance setup (1.5051ms)
  ✔ product keeps default 5 and supports opt-in 10, 11, and 20 (2.9217ms)
  ✔ requested and iteration limits remain bounded by the project (1.0364ms)
  ✔ generic runtime contains no production-specific hardcodes (29.1199ms)
  ✔ detects npm scripts without asking a user for commands (11.9615ms)
  ✔ detects Python tools conservatively (7.9982ms)
  ✔ does not invent commands for unknown projects (2.2467ms)
  ✔ generated instructions point orchestration issues to the control repository (31.9539ms)
  ✔ instructions renderer rejects unresolved configuration (0.9188ms)
  ✔ generated instructions require one-time explicit Chat registration (4.6314ms)
  ✔ submit-report refuses to upload without explicit consent (289.8608ms)
  ✔ already-running browser is probed before Edge and profile discovery (2.7768ms)
  ✔ already-up debug endpoint succeeds without Edge discovery (3500.9505ms)
  ✔ missing ProgramFiles(x86) does not cause a Join-Path parameter error (4445.4287ms)
  ✔ missing ProgramFiles does not cause a Join-Path parameter error (4481.9804ms)
  ✔ missing LOCALAPPDATA does not cause a Join-Path parameter error (3607.4659ms)
  ✔ missing LOCALAPPDATA makes the default profile path error explicit (3197.6679ms)
  ✔ legacy project routes are removed without changing other registry fields (17.9163ms)
  ✔ existing install upgrade retires origin discovery runtime (6.4211ms)
  ✔ new callback delivery has explicit state transitions (6.8189ms)
  ✔ redacts secret-key fields (3.6322ms)
  ✔ redacts token-shaped strings (0.8277ms)
  ✔ safe spawn never needs a shell for argument passing (315.9192ms)
  ✔ core Node runtime contains no shell-true child process invocation (3.3132ms)
  ✔ Windows shim runner transports arguments as Base64 JSON instead of shell text (1.4405ms)
  ✔ control workflow queues multiple pending orchestration runs (13.0176ms)
  ℹ tests 93
  ℹ suites 0
  ℹ pass 93
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 53829.2731

- validation workspace cleanliness: PASS

## Codex final summary

Implemented on the verified branch/SHA.

Changes:
- Runtime health now counts JSON callbacks only under `state.instance_root/pending-wakes`.
- No shared-path fallback exists before setup.
- Doctor reports `ERROR/DOCTOR-001` when pending callbacks > 0, while preserving exact counts and recoverability.
- Added instance-isolation regression assertions.

Validation:
- `node --check src/cli.mjs` passed.
- `git diff --check` passed.
- Tests were blocked by environment-wide `spawn EPERM` when Node attempted to launch test workers.


## Reviewer next action

The project reviewer Chat must independently inspect the recorded source commit/diff and validation evidence, then return PASS, REVISE, or NEEDS_HUMAN. PASS does not merge. Merge requires an explicit human MERGE-APPROVE for this exact source commit.

