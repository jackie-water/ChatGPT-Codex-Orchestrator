# Orchestrator macOS Phase A security correction #322, approved REVISE 6/6

- project: orchestrator-dev
- review_route: chat-303
- source_branch: feat/macos-post-sandbox-native-20261018
- exact_implementation_sha: 3e152025dca74f3f09bcc319a96ea46bb9f185b3
- reviewed_parent_sha: 9a91bc3e005f3c6a8c74fd7069d12c97d298f8ff
- implementation_iteration: 6/6, ONE-TIME HUMAN APPROVED
- Chat_adjudication: NEEDS_HUMAN (wrapper FAILED, no PASS)
- independent_Code_Review: NOT_RUN
- merge_approval: NOT_GRANTED

## Exact local authoritative evidence
- Mac Codex exit 0, EXECUTED_UNVALIDATED; terminal: short-turn-evidence/issue-322-macos-phase-a-security-gates-codex-v1/terminal.json. SHA256 1a2b44a8bd4ae215b6b3de54d58b6d51aeaa7a71c7240c1f6f891e5f6cb7d020
- Independent wrapper terminal: short-turn-evidence/issue-322-macos-phase-a-security-gates-wrapper-v1/terminal.json. SHA256 ba12846513d0d888931dc621ef58626db4f1d84d63e3ee207d619c9c95c229c6
- Syntax, diff check PASS.
- Focused tests: 162 total, 161 PASS, 1 FAIL. tests/control-runtime-bundle.test.mjs:160 ReferenceError: renderWorkflow is not defined. Codex added workflow permission regression without importing renderer. Full wrapper suites were NOT executed and no Code Review was launched.
- Code changes on allowed 7 surfaces: native Code Review job-only contents write/issues read, checkout credential persistence, trusted pinned executable in control metadata and runtime validator, associated tests.
- Independent read-only code observation: existing macOS Control runtime refresh now requires codex_executable in old metadata, before fully updating state; upgrade compatibility and safe pre-mutation behavior must be independently verified before any merge.
- After all 6 of 6 iterations, deterministic blocking correction requires new explicit human authorization; no automatic 7th CODEX-RUN.
- Protected main/dev/Mac spike unchanged. No real Control/Sandbox/Target mutation, install, Runner, Windows, Priceup, Clean Energy, merge, deploy or callback.
