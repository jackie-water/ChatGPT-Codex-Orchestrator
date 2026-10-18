# Immutable macOS Phase B Sandbox-only merge read-only preflight issue #326, iteration 1/5

- project: orchestrator-dev
- review_route: chat-303
- source_repo: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-sandbox-only-merge-20261018
- exact_source_sha: 12b9098082dedf391006e4d74c6009e79a88844d
- source_parent_sha: 7223744265267b8043b78433324fca0ce1f355b5
- phase: B stage 1 only, read-only merge approval preflight, no live merge capability
- Chat_decision: REVISE
- independent_Code_Review: NOT_RUN
- merge_authorization: NOT_GRANTED

## Source and implementation evidence
- Codex #326 exited 0; log SHA256: 43c2cea19189b896aed19ff6bff2ac5483eb40bfd47c4fe468ea519ae433e6cf
- Only two files added: src/lib/macos-sandbox-merge-runtime.mjs and tests/macos-sandbox-merge-runtime.test.mjs.
- The native macOS merge entrypoint runtime/scripts/macos-merge-approved.mjs remains unchanged and exits 78.
- The macOS merge-approved Actions job retains global read-only permissions, and the user has not approved live Sandbox merge/Runner/install.

## Independent wrapper result
- Authoritative local wrapper: short-turn-evidence/issue-326-macos-sandbox-merge-preflight-wrapper-v1/terminal.json, SHA256 f9a92bd49f331e910841d39dd88fd4cbd0b0823689895f33d204b2d3fbdf2b05.
- The focused default suite ran 54 tests: 51 PASS, 3 FAIL, 0 skipped. Syntax and Git diff check PASS; full default/serial suites NOT RUN after focused failure.
- Finding A: tests/macos-sandbox-merge-runtime.test.mjs:38 positive fixture expects git ls-remote result with literal backslash-t separator instead of parsing the exact SHA, although the candidate read-only plan returns the correct 40 SHA.
- Finding B: tampering test attempts to edit the immutable review report under the automation clone checkout (default branch) where that file does not exist, rather than creating a legitimate isolated alternate checkpoint report and checking rejection with ref snapshot pinned after explicit test setup.
- Finding C: non-fast-forward source test snapshots remote refs BEFORE the test itself pushes the intentionally divergent branch, then incorrectly claims preflight mutated the bare remote. Snapshot after explicit fixture setup, before invoking the preflight, and assert preflight has zero remote mutations.
- All are deterministic test-fixture corrections. No code-runtime bug proven by these three failures. Do not rubber stamp PASS until independent suites pass.

## Allowed successor delta-only REVISE 2/5
- Exact predecessor SHA: 12b9098082dedf391006e4d74c6009e79a88844d. Same route chat-303, branch feat/macos-sandbox-only-merge-20261018.
- Modify ONLY tests/macos-sandbox-merge-runtime.test.mjs to correct three behaviors; preserve src/lib/macos-sandbox-merge-runtime.mjs and every other source file.
- Require real bare Git tests verify no remote side effects from preflight, positive valid approved SHA, negative report tampering at exact checkpoint ref, stale SHA, protected branch, route, origin and ff gates.
- No routine validation commands inside Codex prompt; independent wrapper handles default+serial suites, code review and any merge gate.
- No merge, Runner/launchctl, install, real generated Control/Sandbox/Target mutation, browser, Windows, Priceup or Clean Energy.
