# Immutable macOS libproc spike implementation evidence — Control #280, iteration 1/5

- Project: orchestrator-dev; explicit registered Chat review_route: chat-267
- User authorized new isolated architectural feasibility spike, NOT extension of #279 5/5.
- Source repository: jackie-water/ChatGPT-Codex-Orchestrator
- Source branch: spike/macos-libproc-process-identity-20261017
- Source parent SHA: ec6da16bac12df60d900a9608b248ab7b6409c3e
- Exact committed source SHA: 9b9c0824f95d28f9796bad0e9b9d6a5a0ff2b7c5
- Changed file count: 5; exact allowed paths: docs/macos-libproc-spike.md, runtime/native/macos/process_identity.c, src/lib/macos-durable-intake.mjs, src/lib/macos-native-process-identity.mjs, tests/macos-native-process-identity.test.mjs
- Aggregate deterministic file SHA-256 (validated precommit == committed tree): 3f693eff12dc9078e0e7646abe74b37144ffbe00ac1ea0527ef9a156ac6088d9
- Untracked/compiled binary: NEVER COMMITTED; compiled binary exists only under private validation job.
- Codex implementation terminal: EXECUTED_UNVALIDATED, exit 0; original task not repeated.
- Independent wrapper validation terminal: PASS; syntax/diff/native build/focused/full tests all 0 exit; private files fingerprints equal committed tree.
- Native helper C compiled via Apple xcrun clang -std=c11 -Wall -Wextra -Werror, using SDK PROC_PIDTBSDINFO and struct proc_bsdinfo pbi_start_tvsec/pbi_start_tvusec.
- Actual native probe: repeated same process identity PASS; observed sec=1792232044, microseconds=13333; nonexistent PID=MISSING; invalid PID=INVALID_PID.
- Focused Node tests: 20 passed, 0 failed, 0 skipped.
- Full npm tests: 365 total, 356 passed, 0 failed, 9 skipped.
- Focused validation log SHA-256: 7d7b9301aa2f6cc1ef795b73135e2609508927c078f1d8ec166cad9bae48969d
- Full validation log SHA-256: 1ad9df12e46d47c5563391cf449f3265bf83e147a972186d6ca2f3cb8e261b08
- Wrapper validation terminal SHA-256: ea50eaee3ba2f6e61558100b23ba109d59e667b5424522e646959e6552db21ef

## Committed file evidence
- docs/macos-libproc-spike.md: 56fa6172a0ddd86170670bae30f76c50b450da22ec817c11d87ca130eec0fc06
- runtime/native/macos/process_identity.c: 59bbe3a8f5a0a456bc78b1067487ad72d067ad2d262abb66ea9004d28b205b3f
- src/lib/macos-durable-intake.mjs: f3d187e184bd1afab1e538a3bf6f599aefe4ae5408392ec15cef18ab8cab86a8
- src/lib/macos-native-process-identity.mjs: f8ebcf6746313f64f9bf202ccaacc4dff5f6b7de505bb13ff907a56756364e05
- tests/macos-native-process-identity.test.mjs: a56989795d2fc265d483a4f56b4da0ad4b1d679304262f6c6a69ea02367629ec

## Important limitations / hard gates
- Source only: signed/private helper packaging, installer prerequisite verification, runtime activation and deployment NOT performed.
- Opt-in Darwin integration is a SPIKE and not production-ready or independently reviewed.
- Original #279 failed implementation remains uncommitted in its separate worktree; iteration 5/5 unchanged.
- Previous Windows support, other Chat worktrees, disabled Control workflow/Runner, Sandbox PROJECT_DISABLED and real target remain untouched.
- This immutable implementation report is NOT independent Code Review PASS. New exact-SHA read-only independent review required; merge needs explicit human authorization for same SHA.
