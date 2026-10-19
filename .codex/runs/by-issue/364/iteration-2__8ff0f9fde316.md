# Immutable Phase C2 implementation evidence — Control #364, REVISE 2/5

Project: orchestrator-dev; exact registered review_route chat-333.
Task branch: feat/macos-phase-c2-existing-instance-recovery-20261019.
Exact source SHA: 8ff0f9fde316bd4bcafdd054144ac930eb9893fd
Immediate predecessor: 8debce9000c6208fc716ca68fe87a1672d296a22.
Initial Phase C2 baseline: 7e03521158db16731801e55803dbb8c870f5288c.
MacBook-Air.local Codex CLI gpt-5.6-luna medium exit 0, executor SHA256 e1e8347c9eea607bc5bdc504b06df8422b70967ade82b89955b0d76e7e183f95.

## Deterministic corrections

- src/lib/macos-existing-instance-recovery.mjs now compares control_repository versus sandbox_repository identities by independent roles, allowing legitimate distinct repo names but denying contradictory values for a single role.
- src/cli.mjs only treats an existing installation state as bound when installation_id canonical prefix, instance_id and full instance_root match the exact identified existing instance, and rejects a fully populated different installation before prerequisites.
- tests/macos-existing-instance-recovery.test.mjs now uses canonical fs.realpathSync(os.tmpdir()) and 0700 private fixture HOME with automatic cleanup; scoped positive/negative identity tests added. Real instance, installer state, native helper, Control/Sandbox/target and protected repos untouched.

## Independent wrapper: REVISE

JavaScript syntax checks PASS.
Focused new recovery tests: 9/9 PASS (log SHA256 a9d921f64705f24ec5e5d3d0038e6b98bb0b17a0632b16ea3cbd64bf3196f9da).
Existing macOS native Sandbox resume regression: 6 total / 5 PASS / 1 FAIL (log SHA256 6941e268a4ec1f13560501886d21e225c5d586b8b2194faca780d0475701fbe9).
The single failure is tests/macos-p3-setup-resume.test.mjs first resume fixture. Its fake HOME created with mkdtempSync(path.join(os.tmpdir(),...)) inherits the /var symlink alias on macOS, causing new inspector to return MACOS-EXISTING-INSTANCE-REVIEW with safe_home CONFLICT before original Sandbox test logic. Independent read-only temp proof established legacy HOME alias status CONFLICT / canonical fs.realpathSync alias status ABSENT for the SAME physical directory. No real installation touched.
Default and serial full suites NOT RUN on this candidate because a deterministic focused blocker remains. No independent Code Review for failed-wrapper candidate.
Independent local adjudication SHA256 6e739f91877778c36ce8549e954cee9b4fd92a442e3ff5ea839c0ec2c5bbfd8f.

## Review decision

Chat adjudication REVISE, follow-up iteration 3/5 delta-only scope tests/macos-p3-setup-resume.test.mjs: use fs.realpathSync(os.tmpdir()) in the disposable P3 fixture root, maintain the 0700 permissions and exact native PID/receipt/security tests. Do NOT weaken inspector or mutate native helper implementation.
Only new C2 feature branch changed, no code merged to main/dev, no real installer commands, no signer provisioned, no Runner/browser/LaunchAgent, no Sandbox E2E target changes. Original Phase B #332 remains on chat-303 unstarted.