# macOS native PID 500ms acceptance evidence — isolated Mac proof

- Project: orchestrator-dev
- Source repository: jackie-water/ChatGPT-Codex-Orchestrator
- exact reviewed and macOS spike-merged source SHA: 7223744265267b8043b78433324fca0ce1f355b5
- branch: spike/macos-libproc-process-identity-20261017
- review_route: chat-303
- independent Code Review PASS: Control #324, checkpoint f61a9c451c1b3e5c99a19636909d0c1bf082dee8
- decision scope: ISOLATED_VALIDATION_PASS_ONLY, NOT real installed macOS Sandbox E2E
- native process identity timeout: 500 ms one-shot. No retry or PID identity bypass.
- live production instance installation: NOT AUTHORIZED and NOT RUN.

## Historical error reproduction

- Real native libproc diagnostics on the same Mac previously observed 6/64 RUNNER_TIMEOUT at 250ms with newly compiled cold/randomized binaries; with 500ms, 0/64 timeouts and worst around 355ms.
- Prior diagnostic: private short-turn-evidence/native-timeout-stage-20261018T020250Z/terminal.json, collected 2026-10-18 UTC; this was prior to the 500ms source commit.

## Current exact-SHA positive verification

- 24 separate new cold binaries: 24/24 four-reading PID proofs PASS; 96 native libproc identity reads OK.
- 60 reused warm binary proofs: 60/60 PASS; 240 reads OK.
- 16 concurrently compiled cold binary proofs: 16/16 PASS; 64 reads OK.
- Total: 100/100 complete four-reading proofs PASS; 400/400 raw libproc reads OK. Worst actual per-read 333.55ms, below the 500ms hard deadline.
- The isolated official native Helper lifecycle completed PASS: built native Helper in a separately named temporary installation HOME, persisted private Helper, proof receipt and journal, 20/20 subsequent verified same-instance capability checks PASS, idempotent repeat PASS, no real Runner.
- No source patch was required because the original native error was not reproduced under current exact source and verified cold/warm test conditions.

## Required fail-closed negative verification

- Injected RUNNER_TIMEOUT to the trusted native identity reader for an isolated instance containing a real validated Helper and durable receipt. The native verifier returned MACOS-NATIVE-PID-PROOF-FAILED.
- The actual macosRuntimeAction("start") path, given the injected failing capability verifier, returned the same blocking error and made zero launchctl bootstrap/start calls.
- The Helper and capability receipt retained exactly the same SHA256 before/after the negative verification. No real Control/Sandbox/target/runner was touched.
- Private evidence: short-turn-evidence/native-pid500-real-libproc-proof-20261018-v1/negative-gate-terminal.json.
- Private positive proof: short-turn-evidence/native-pid500-real-libproc-proof-20261018-v1/terminal.json.
- Private lifecycle proof: short-turn-evidence/native-pid500-real-libproc-proof-20261018-v1/isolated-helper-lifecycle.log.
- Negative proof receipt SHA256: b3b3076d4d3b0cf1d623350dc045d2f188daa27e6f43fe016a8f770bd68cb215

## Existing official installer enforcement verified read-only

- src/cli.mjs runSetup() demands macosNativeHelperPreflight PASS, explicit macos_setup_approval, then prepareMacosNativeHelper PASS before sandbox task registration and Sandbox smoke creation.
- prepareMacosNativeHelper invokes four strict native PID start-identity observations before persisting VERIFIED capability receipt.
- src/lib/macos-platform.mjs macosRuntimeAction("install"/"start") calls verifyMacosNativeCapability and rejects invalid proof before LaunchAgent mutation/launchctl bootstrap. The runner start gate additionally checks same instance and exact canonical plist rendering.
- This proof does not authorize official installer, runner start, or browser/CDP callback delivery. The real per-instance Helper is not installed; it must undergo separately human-authorized actual Sandbox verification.

## Outstanding release/E2E criteria

- Complete Phase B native Sandbox-only merge adapter and Phase C post-Sandbox activation under explicit prior security and merge approvals, without target activation before Sandbox COMPLETE.
- During a separately authorized native macOS Sandbox E2E, verify Helper in the real instance and the four PID reads, then record actual runner bootstrap/stop and an actual user-role callback delivered into its exact registered Chat (composer text alone is not delivery).
- If RUNNER_TIMEOUT or MACOS-NATIVE-PID-PROOF-FAILED recurs, stop fail-closed and preserve the exact private proof, stdout/stderr, errno, child exit/signal and source SHA. Do not increase the production timeout or bypass PID validation without human security approval.
- Windows, Priceup, Clean Energy, main, dev and user Runner environments remain unchanged.
