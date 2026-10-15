# P2.1 native Control event adapter — issue 182 iteration 1/5

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- control_issue: 182
- review_route: chat-165
- source_branch: feat/macos-native-control-dispatch
- source_commit: 4b9e9a3d269fefb0947d4544b03500bbc3876383
- parent_source_commit: deaf6c62a063caf636bb3aef83fb45994e7dc7df
- codex_model: gpt-5.6-luna
- codex_exit_code: 0
- status: VALIDATION_FAILED_INDEPENDENT_BOUNDARY_TESTS
- merge_approval: NOT_GRANTED

## Allowed files changed
- src/lib/control-event-normalizer.mjs
- runtime/scripts/normalize-control-event.mjs
- tests/control-event-normalizer.test.mjs
- docs/macos-control-event-contract.md

## Independent wrapper checks on Mac arm64 Node v24.22.0
- node --check on new JS files: PASS
- git diff --check: PASS
- node --test tests/*.test.mjs: 122 tests, 113 PASS, 0 FAIL, 9 expected Windows-only SKIP
- P1 prepareFailure accepted a fixture normalized Control issue event while retaining separate provenance: PASS
- Raw spoofed Control origin and untrusted author rejected: PASS

## Independently reproduced deterministic blocking findings
- F1: writeNormalizedOutput accepts an arbitrary existing target file, then silently overwrites it. Isolated test used an existing temp JSON file with a different identity and confirmed it was replaced. Require conflict-safe idempotent output; same exact content can be reused, different content must fail without mutation.
- F2: writeNormalizedOutput unconditionally chmods parent directory to 0700, including an existing user-chosen shared directory. Isolated temp-dir test started with mode 0755; after output it was changed to 0700. Do not alter permissions of pre-existing unrelated directories. Require a private output boundary or fail closed if parent is not private.
- F3: normalized event spreads raw Control repository metadata and only overwrites full_name to source repo, leaving original Control id/html_url possibly mixed into a synthetic source event. Construct a minimal explicit normalized execution event from verified fields only and retain authentic original Control provenance separately.
- F4: normalizeControlEvent trustedGithubUsername.includes(author) must require an explicit array of exact trusted logins; passing a string could authorize a substring. Fail closed for non-array trust configuration.
- Tests currently cover only two fixture cases; expand isolated output-path/overwrite/identity isolation tests.
- No end-to-end Mac runner/installer/real Sandbox tests. No merge, no production modifications.

## Reviewer disposition
REVISE: one concise bounded delta-only P2 task on exact source SHA above and same review_route chat-165. No duplicate overlapping tasks.
