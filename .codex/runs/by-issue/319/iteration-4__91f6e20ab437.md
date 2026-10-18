# macOS Code Review recovery issue 319 iteration 4/5 immutable report

- project: orchestrator-dev
- review_route: chat-303
- repository: jackie-water/ChatGPT-Codex-Orchestrator
- source_branch: feat/macos-post-sandbox-native-20261018
- exact_source_sha: 91f6e20ab4379c4df5fcae5b3d47c3e21ee1dfcb
- parent_sha: 091390573e66082bcbe68a8f9568716f58597a59
- cumulative_base: 282f88b3aceac7460d8d91cd1161486267a760e7
- decision: REVISE, no PASS / Code Review / Merge / installation / Runner

## Codex and independent wrapper
Codex #319 iteration 4/5 exited 0, changing only src/lib/macos-code-review-runtime.mjs and tests/macos-code-review-runtime.test.mjs. Authoritative private local executor terminal: short-turn-evidence/issue-319-macos-postpush-publishing-reconcile-codex-v1/terminal.json.
Independent wrapper: short-turn-evidence/issue-319-macos-postpush-publishing-wrapper-v1/terminal.json. Focused default: 153 total, 150 PASS, 3 FAIL. Syntax and diff checks PASS. Full suites not run after focused deterministic failure. Wrapper terminal SHA256: 7f8afe71b043f5852f5106e40cf8d5d745dd0413350aa338ed807eb018eedd3.

## Deterministic findings and next delta
New bare-Git fixture creates main when git init default already main, missing automation path return, static reviewed SHA instead of actual local commit, missing checkpoint_branch in evidence. Independent private fixture diagnostic then reached real shipped code: git cat-file -e COMMIT:missing/report returns exit 128 on this Mac; current objectExists only recognizes 1 as absence, reports GIT_OBJECT_PROBE_UNCERTAIN, blocking valid prepush PUBLISHING recovery. A revised test must use valid private bare repository, dynamically pinned SHA, exact report schema, and fail-closed negative cases. Correct object-probe existence semantics without accepting arbitrary Git failures or relaxing path/ref verification.
No other changes allowed. Continue with one delta-only REVISE 5/5 using same route and exact SHA. No merge, live Sandbox, Runner, installer, Windows, Priceup, Clean Energy, or protected branches.
