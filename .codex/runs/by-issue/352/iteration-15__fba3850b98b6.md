# Immutable implementation and independent wrapper evidence — Control #352

Project: orchestrator-dev
Registered callback review route: chat-333
Approved logical iteration: 15/15 (one-time explicit human approval)
Source repository: jackie-water/ChatGPT-Codex-Orchestrator
Task branch: feat/macos-short-turn-autoloop-20261018
Exact implementation source SHA: fba3850b98b6b42227e1a8f8586d42970afb01ce
Immediate predecessor SHA: 8fc87d30ddad622372c986501ba574a8e5b8d6b2
Full cumulative Code Review base: 7223744265267b8043b78433324fca0ce1f355b5
Executor: local MacBook-Air.local Codex CLI, gpt-5.6-luna medium, exit 0
Executor log SHA-256: cf5aaff1415fa9da26de129ee71048e7926ddd8cabf3217669863753b7618c50

## Exact change scope

Only src/lib/macos-short-turn-autoloop.mjs changed from the predecessor: 2 lines replaced, 2 lines inserted. In privateLayout, path identity rejection by the reused privateDir/privateFile helpers (UNTRUSTED_SCOPE_AUTHORITY, ENOENT, ENOTDIR, EACCES, EPERM) is converted to the appropriate supplied route-registry or pending-wake receipt trust error code. This does NOT suppress or loosen the underlying owner/mode/symlink checks; no tests or other production modules changed.

The new exact source commit was created on the isolated task branch only; Mac worktree remained clean and source SHA matched GitHub remote. No merge occurred.

## Independent wrapper — PASS

| Validation | Total | Passed | Failed | Skipped | Log SHA-256 |
|---|---:|---:|---:|---:|---|
| Source/test JavaScript syntax | N/A | PASS | 0 | N/A | Empty output |
| Focused short-turn test suite | 22 | 22 | 0 | 0 | 654782ccb3edf91c21cf79d4e4dd0182588c0a31e9eb9f7f9815096ac71d125b |
| Full default node --test | 447 | 437 | 0 | 10 | ea6341027770dd2618ab128d9421362f2f1a7b68ec71230bc8795ccdfed37fa7 |
| Full serial node --test --test-concurrency=1 | 447 | 437 | 0 | 10 | 13fc902c30d2e74c80c2416d7e344a3408552f69f92db363f31567a0298d9807 |

The independent wrapper validated exact source branch/HEAD, authorized file scope, only 2 inserted+2 deleted lines, original test source unchanged, existing registered chat-333 route, original #332 unstarted and code/source fingerprints. Source SHA-256: check local adjudication record.

## Independent security fault injection

All probes ran in disposable macOS temporary HOME and ledger directories, never the user's actual Chat:
- Fake symlinked instance registry rejected as UNTRUSTED_ROUTE_REGISTRY.
- Symlinked pending-wakes root with fake DELIVERED receipt rejected as WAITING_SERVICE; persisted chat remains UNCLAIMED.
- Genuine private registry and verified matching DELIVERED/committed-user-turn receipt succeeded to CLAIMED.
- No real Chat message sent and no CODEX_RUN executed.

Probe SHA-256: 3d9eac98b2a1b6cee34c19f49d93dbfa84a44cfe597d93beb01f6a2037382b1f.
Independent wrapper adjudication SHA-256: 54ce95993e6ced8b671e8645c2a562dc36b9bc00bcabc674d09441d82895b283.

## Human and deployment gates

Isolated implementation wrapper: PASS.
Mandatory independent read-only full-cumulative Code Review on this exact source SHA: PENDING.
This ledger/controller remains disabled local intent-only prototype; trusted issuer keys are not provisioned. Real browser delivery, persistent Runner, official installer and runtime bundling are NOT enabled. PASS is review-only and does not authorize merge. No Windows, Priceup, Clean Energy, main, dev, target or old Control #332/chat-303 changes.
