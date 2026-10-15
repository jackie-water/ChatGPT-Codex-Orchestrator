# P2.2a user-authorized eighth implementation checkpoint

- project: orchestrator-dev
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- Control_issue: 198
- implementation_iteration: 8/8 (specifically human-approved for this P2.2a work package)
- configured_project_max_iterations: 5 (unchanged)
- review_route: chat-165
- source_branch: feat/macos-native-codex-executor
- exact_source_commit: b435f9620bd8235fb19ee2f424af10aa6ce34962
- exact_reviewed_parent: cd1ddd8a978ba54abcc850c54e4f48dc74992fe4
- stacked_base_commit: 5d469eaac5e687eb0f279800061aebd5ff31c838
- Codex_executor: isolated Mac CLI gpt-5.6-luna low reasoning
- Codex_exit_code: 0 (plus same-session delta addition of missing substitution regression test)
- Mac_wrapper_validation: PASS
- exact_SHA_Code_Review: PENDING
- merge_approved: NO

## Change surfaces
- src/lib/control-event-normalizer.mjs
- src/lib/macos-codex-run-contract.mjs
- tests/control-event-normalizer.test.mjs
- tests/macos-codex-run-contract.test.mjs

## Deterministic fixes
1. Require Control Issue body max_iterations to be an explicit JSON integer within 1..project configured max <=20 before returning executable plan; null, omission, 0 and fractional values fail closed. No defaulting to configuration when request is missing. No global cap change or additional project authorization.
2. Remove an unsafe duplicate projects.json read from macOS preflight. Control normalization reads registry once through the preexisting symlink/path guard; binds the authorized project configuration and instance ID to the returned normalized object through a module-private WeakMap with immutable deep clone. Preflight consumes only that authorized snapshot for repository, branch, iteration, validation profile and instance identity. No raw public serialized normalized event payload contains other project configurations.
3. Independent isolated Mac fault injection: an instrumented projects.json first read replaced the file with a symlink to an attacker-controlled registry immediately after the authorized read. New preflight read projects.json exactly ONCE; normalized authorized repo and planned repo both legitimate/source; attacker-supplied repo/validation commands were NOT adopted; no failure outbox created.
4. Added isolated regression test for project-registry substitution, unauthorized snapshot rejection and no outbox side effects, plus missing/bad max_iterations tests; existing P0/P1/P2 behavior retained.

## Independent wrapper evidence (MacBook ARM64, Node v24.22.0)
- Full node --test tests/*.test.mjs: 146 total, 137 PASS, 0 FAIL, 9 platform-skipped.
- Node syntax checks all four changed JS files: PASS.
- git diff --check: PASS.
- Source branch clean after commit and push; exact SHA preserved.
- Queued Windows-only Control Actions run 38818563411 explicitly canceled before Mac Codex execution to avoid duplicate executor.

## Outstanding gates at checkpoint creation
- GitHub exact-SHA Node+Windows CI must be checked.
- Independent read-only Codex Code Review for exact b435f9620bd8235fb19ee2f424af10aa6ce34962 is required; prior Code Review of parent cd1ddd8 does not apply.
- No native installed Mac executor, production reviewer/browser watchdog, official installer, isolated live Sandbox E2E or merge approval is claimed by this P2.2a-only checkpoint. Windows v0.1.0, main, Priceup and Clean Energy production runners remain untouched.
