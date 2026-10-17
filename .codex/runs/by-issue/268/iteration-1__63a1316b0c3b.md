# Immutable implementation evidence — Issue #268, iteration 1/5

- Project: orchestrator-dev
- Original review_route: chat-267 (registration callback delivered and verified)
- Implementation request: Control Issue #268
- Source repository: jackie-water/ChatGPT-Codex-Orchestrator
- Source task branch: feat/macos-independent-runner-readiness-20261017
- Exact source base: 9203170f74b57dade7702fb0530e994ecf531c17
- Exact implementation commit: 63a1316b0c3ba8d73cdac72b32cc1d030e23716e
- Executor: macOS isolated Codex CLI; not a GitHub Actions runner
- Source changes: 5 allowlisted files; no work performed on protected branch or unrelated project
- Codex run: completed exit 0; same-session corrections for deterministic wrapper findings
- Validation: performed by independent local controller, not by Codex prompt
- Syntax: Node checks for changed modules and tests PASS
- Focused validation after final changes: 10 PASS / 0 FAIL / 0 SKIP
- Full suite on EXACT committed SHA: 351 total, 342 PASS / 0 FAIL / 9 SKIP
- Source integrity: current task branch remote HEAD equals exact SHA; working tree clean after validation
- Focused validation log SHA-256: d2901482c9a2a5d0f6518fe4b61b13921857fcac3d74823d732c848eac48343e
- Exact-SHA full validation log SHA-256: 0ccd365e1ed18ccaed767c91f75f6542c34c9055affa61521fd130b8917e61cb
- Initial Codex implementation log SHA-256: 1ce7f5710bc004e315dafcb07f1eeac333c740050869c7fb27b6245c3452b875
- Deterministic correction log SHA-256 (1): 5ab34efced034d86ce9cf2a2cacc48458edae6efdf5a3e710ef5ef08277f4a59
- Deterministic correction log SHA-256 (2): 37c4cfe4ebc2b95c5bd3dc544686cd2e6719e726c02ddd746cee386ce115c74a
- Deterministic whitespace correction log SHA-256: 2a140bf1b2df411aa2269191f6a8a3af73a0d764918768a1a306aa1a9ee64c30

## Scope and limitations
This phase adds conservative, read-only macOS Control runner readiness evidence. It does NOT install/register/start an Actions runner, enable the disabled Control workflow, resolve ChatGPT's HTTP 404 resume stream error, or activate the real target. The Windows runtime remains unchanged. Current Control still has zero registered runners.

## Review gate
Candidate awaits Chat source/diff assessment and independent read-only Code Review of this same exact SHA. This report is not permission to merge; merging requires explicit human approval of exact SHA.
