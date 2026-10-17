# P3 macOS first-boot Sandbox smoke creation — human-approved implementation 10/10

## Immutable identity

- Project: `orchestrator-dev`, originating Chat route: `chat-232` under `explicit-route-v1`.
- Private Control implementation request: [#247](https://github.com/jackie-water/chatgpt-codex-orchestrator-control-1832f0bb/issues/247).
- **Explicit human authorization:** exactly one P3 technical iteration **10/10** to correct the independently demonstrated new-macOS-installation deadlock at initial Sandbox smoke; no approval for 11/11, code merge, service installation, runner startup, sandbox merge, deployment or target activation. Configured default `max_iterations=5` remains unchanged.
- Source repository: `jackie-water/ChatGPT-Codex-Orchestrator`.
- Non-protected task branch: `feat/macos-official-installer-migration`.
- **Exact committed implementation SHA: `866add528c7bc0907b746cc53a4058c21809c019`.**
- Exact reviewed source parent: `47c2c8be34cff75989c59f21704f4c9a94325f6c`.
- Full P3 comparison/review base: `a7eea5213d87440e7cdf351a5e9a1271439dd185`.
- Previous P3 review checkpoint: `4021e2c7af271fdc7de38046f6a8ac62490152dd`, path `.codex/reviews/by-commit/47c2c8be34cff75989c59f21704f4c9a94325f6c.md`, verdict NEEDS_HUMAN due a confirmed initial Sandbox start omission.
- Implementation machine: dedicated MacBook; native Codex CLI 0.162.1, model gpt-5.6-luna. Initial authorized implementation session `01a14797-56b2-7580-a0d8-0ee10301be04`; a **second local Codex session** `01a14798-9e3c-7d42-a1f2-a69047627b7c` added and deterministically corrected focused tests on the **same issue and same logical 10/10 iteration**, without a successor GitHub CODEX-RUN, changed branch or additional source commit. Codex made source/test workspace edits only; controller separately ran tests, committed and pushed.

## Narrow implementation delta

This source commit changed **exactly 3 permitted files**, 114 insertions and 15 deletions:
1. `src/cli.mjs`: after Darwin-only generated-repository authorization and active, same-installation registered Sandbox route/Chat URL checks, `sandboxSmokeStatus(state,{strict:true})` stage `NOT_STARTED` triggers the existing `startSandboxSmoke(state)`. Persist `sandbox_smoke_started` and `sandbox_smoke_issue`, then rescan strict status to return WAITING/CODEX_PENDING rather than a false COMPLETE. If issue verification/creation fails, save the failure and remain fail-closed with real target disabled. Does not auto-activate project/runner or merge.
2. `src/lib/sandbox-smoke.mjs`: keep existing official smoke prompt, Sandbox-only repository and branch. For create/reuse specifically, demand an unambiguous `gh issue list` result (never treat failures/malformed/truncated responses as empty); re-use only a single exact trusted non-bot issue matching installation marker/title, project, Sandbox repository, smoke branch, iteration 1/5, exact registered review_route and installation id. Reject conflicting/multiple issues rather than create a duplicate. Existing non-strict Windows status path remains distinct; public Windows main unchanged.
3. `tests/macos-p3-setup-resume.test.mjs`: Mac fake-HOME/fake-gh/git child-process smoke first boot verifies the one-time Issue URL, saved state, target disabled and repeated resume behavior; focused fake gh helper fixtures verify exact body, existing issue reuse, invalid/malformed listing and wrong issue identity are rejected without real GitHub. Legacy Mac status tests remain.

No price/production or unrelated source changes. The implementation **does not actually initiate a real private Sandbox CODEX-RUN** in this environment. The user authorized only code and **isolated fixture testing**.

## Independent wrapper validation and CI

- Exact branch/parent, allowlisted three-file diff, clean worktree postcommit, and matching GitHub remote branch head: verified.
- `git diff --check`, staged diff check, and Node syntax checks: **PASS**.
- New `tests/macos-p3-setup-resume.test.mjs` focused suite: **5 PASS, 0 FAIL**. Deterministic test-fixture corrections were made within the same logical issue.
- Whole Node suite on Mac: **339 tests / 330 PASS / 0 FAIL / 9 expected platform SKIP**.
- Uncommitted change independent preliminary READ-ONLY Codex review: no definite newly introduced issue found; it is **not** a complete exact-SHA full P3 code review.
- [GitHub CI run #38993793083](https://github.com/jackie-water/ChatGPT-Codex-Orchestrator/actions/runs/38993793083) for exact implementation SHA: **SUCCESS**. Jobs `node-tests` and `windows-static` both completed SUCCESS. Windows-static is GitHub-hosted static analysis, not execution on the retired Windows machine.
- GitHub Task Draft PR #9 remains OPEN/DRAFT/unmerged; public source main remains `85361876d587d824b18bf28e7367ef86c32040cf`.

## Safety and next gate

- This report establishes that source implementation and isolated wrapper tests completed, **not** P3 product PASS. Native Code Review and Merge executors still deliberately fail-closed (exit 78); no official Mac runner/LaunchAgent, complete live Sandbox-first E2E, real user-role callback delivery or original-target activation was performed.
- Control workflow ID 373801036 deliberately disabled; retired Windows runner deregistered; 0 Control registered runners. Private Control Mac-only Draft PR #242 and separate Issue #10 registration timeout work remain independent/unmerged.
- **Next:** independent native Mac READ-ONLY review for exact source SHA `866add528c7bc0907b746cc53a4058c21809c019`, across **the full cumulative P3 diff** from `a7eea5213d87440e7cdf351a5e9a1271439dd185`. Chat adjudicates every finding as PASS/REVISE/NEEDS_HUMAN; no authorized P3 iteration remains after 10/10. PASS does not imply merge. Exact reviewed SHA merge requires new explicit human approval, and no installation/runner/target activation is included.
