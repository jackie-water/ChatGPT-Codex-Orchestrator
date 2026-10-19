# Immutable Phase C2 implementation and independent wrapper — Control #367

Project: orchestrator-dev. Exact registered Chat route chat-333.
Phase: C2 existing macOS instance read-only recovery safeguards; final configured iteration 5/5.
Task branch: feat/macos-phase-c2-existing-instance-recovery-20261019
Exact source commit: 9da397bec114949259b826097928083c988a4375
Immediate predecessor: 1cf246e5a800ccc65744f6665c3b779329817d41
Phase C2 original source baseline: 7e03521158db16731801e55803dbb8c870f5288c
First Phase C2 implementation #363 source SHA 8debce9000c6208fc716ca68fe87a1672d296a22; intermediate iterations #364, #365 and #366 fixed identity verification and disposable test fixtures.
Codex executor: MacBook-Air.local local CLI gpt-5.6-luna medium, exit0, log SHA256 d8839518fdc7c6b4c0437db6d264194208b3065cc3a1ce501ec208e1b021941d.

## Exact final 5/5 delta
Only tests/dry-run.test.mjs changed. On macOS, canonicalizes os.tmpdir() through realpath to avoid /var alias and isolates the child HOME in the same ephemeral home as the mock installer-state directory. Original dry-run assert real_project_activation.gated_by=sandbox_complete remains intact. No macOS product CLI/inspector, Native Helper PID500 or Windows implementation code changed in this 5/5 delta.
Git commit above remotely verified against new isolated task branch; working tree clean. No merge.

## Phase C2 cumulative source scope
Across iterations 1 through 5: src/cli.mjs, src/lib/macos-existing-instance-recovery.mjs, tests/macos-existing-instance-recovery.test.mjs, tests/macos-p3-setup-resume.test.mjs, and tests/dry-run.test.mjs.
Introduces read-only existing instance inspector and recovery-preflight command, and early fail-closed setup/resume gate for unbound existing macOS instances. Does not implement installer-state adoption or create signer keys. Full cumulative diff is NOT yet independently Code Reviewed.

## Independent Mac wrapper PASS (exact same SHA)
| Test | Total | Pass | Fail | Skip | SHA256 |
|---|---:|---:|---:|---:|---|
| Syntax tests/dry-run | NA | PASS | 0 | NA | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| Focused dry-run | 1 | 1 | 0 | 0 | c2642367b5073246d37ba5856ff52927db9594df5d66edc232a3e7af4cad460e |
| Focused P3 native resume | 6 | 6 | 0 | 0 | b5f1cc577161bc3b1712bbd7e8b84df54c80582408152f589c6a9dd8d08c7a9e |
| Focused existing-instance inspector | 9 | 9 | 0 | 0 | 7fc5fb874f371bdbaaac4363f9f9aa2b7bc398af03ca284bd388b5a50ec145ff |
| Full default | 461 | 451 | 0 | 10 | e16e8579d2844a9a29ec3848277b437ef0c72b9b7d3a150a1857226c73f2658f |
| Full serial | 461 | 451 | 0 | 10 | dca0e8febf96a9416a84474912ea9b4bf8bc79bed8e32aa4f9f47b2fc7c46fc8 |
Independent wrapper adjudication SHA256 58bf326b39b93c5897d0eac51f57c8964e11e412fe0b29bdf12cd015440d1d1a.

## Additional independent read-only boundary probes (require independent Code Review adjudication)
All probes ran in ephemeral private macOS HOME and installer state roots; NO installed instance, real GitHub, Runner, browser or Codex run. The first probe inadvertently created a symlink-unsafe parent 0700 mismatch, which was correctly refused as CONFLICT (non-actionable). The corrected secure directory layout probe returned:
- Matching installation identifier and instance root, registered repository identity consistent: recovery-preflight PASS with inspector NEEDS_VERIFICATION.
- Mismatched installation identifier: NEEDS_USER_ACTION with MACOS-EXISTING-INSTANCE-REVIEW (correct rejection).
- Matching installation identifier and instance root but installer state Control/Sandbox repository roles different from private instance metadata: recovery-preflight PASS with inspector NEEDS_VERIFICATION (potential insufficient binding).
- Matching installation identifier and root, but both route and migration metadata removed: recovery-preflight PASS with missing_verification_gates [chat_routes_metadata,migration_snapshot_metadata] (potential insufficient proof).
No mutation in any case. Corrected diagnostic probe SHA256 01bbc4c045c80bce023e0013f6122d4bea6aba75558acdd83c6890c247632bbd.

## Security and human gates
Implementation wrapper PASS only. Mandatory independent read-only full cumulative Code Review on exact source SHA 9da397bec114949259b826097928083c988a4375 pending. No automatic successor 6/6 beyond configured cap, even if review reveals blocking findings; require separate explicit human approval.
No merge into main/dev, no real installer adoption, official setup, signer provisioning, Sandbox/target activation, Runner or browser/CDP. The original Phase B #332 belongs to distinct Chat chat-303 and remains unstarted, active route for this project is chat-333.