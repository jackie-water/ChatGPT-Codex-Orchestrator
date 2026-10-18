# Immutable implementation evidence — Phase B Stage 1 Sandbox merge preflight, Control #331

- project: orchestrator-dev
- review_route: chat-303
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-sandbox-only-merge-20261018
- exact_source_sha: db64d148fb6fc8fa985dc70ac85c1bef44fab678
- parent_commit: 0b3b30fd0f0def9adac45af60ce668b5f3340c07
- cumulative_base: 7223744265267b8043b78433324fca0ce1f355b5
- iteration: 4/5
- implementation_issue: 331
- implementation_wrapper_verdict: PASS
- independent_exact_SHA_Code_Review: NOT_RUN
- merge_approval: NOT_GRANTED

## Specific deterministic correction

- Added a trusted project-source check rejecting request.source_branch equal to project.checkpoint_branch before local or remote Git operations (PROTECTED_SOURCE_BRANCH). Also excludes project.default_branch and existing configured protected branches.
- Added genuine disposable local bare-Git negative regression for checkpoint branch as merge source; no remote mutation and fail-closed PROTECTED_SOURCE_BRANCH.
- Changed only src/lib/macos-sandbox-merge-runtime.mjs and tests/macos-sandbox-merge-runtime.test.mjs since exact parent.

## Authoritative independent wrapper
- Mac Codex executor issue #331 exited 0, exact log SHA256 f0cec6d9c4880ffa25c6580b2b040a0af9ba013a926b97b9747ba303f733da8d.
- Independent focused wrapper: 58/58 PASS default and 58/58 PASS serial, syntax/diff checks PASS, pinned fingerprint verified.
- Independent full wrapper: default 439 total, 429 PASS, 0 FAIL, 10 SKIPPED; serial identical, both exit 0, pinned fingerprint_verified true.
- Focused terminal SHA256 52831964b993f419a2f55afc2989bfa9047420dd764956d99deea4c8d90b9680.
- Full terminal SHA256 b9503cbe7aa60aa88fae15d5f8949acdfdac4365da4996ce815a54faeda9e8b2.
- Full default log SHA256 f807b00f8a29e46f7386fa180021614b0af79131bdb8419d938627aa9b10d088.
- Full serial log SHA256 00570d90594b0051093ec731b920202775974db8479aea16f3261cd103ca3866.

## Security/integration boundaries
- This is a read-only Phase B Stage 1 preflight module. The shipped native macOS Merge adapter runtime/scripts/macos-merge-approved.mjs remains the unchanged exit78 fail-closed stub.
- No Runner, installer, live Sandbox merge or target activation; no fallback Chat, no GitHub merge job permission escalation, no remote pushes from runtime. main/dev and Mac spike protected.
- The implementation candidate requires fresh independent read-only exact-SHA Code Review of complete Stage 1 delta 7223744265267b8043b78433324fca0ce1f355b5..db64d148fb6fc8fa985dc70ac85c1bef44fab678 before Chat PASS/REVISE/NEEDS_HUMAN.
- Implementation wrapper PASS is NOT merge authorization; any later Phase B Stage2 live merge adapter needs separate approved security scope and final exact SHA review and explicit user approval.
