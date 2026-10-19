# Immutable Phase C2 implementation report — Control #363, iteration 1/5

Project: orchestrator-dev; exact registered review_route chat-333; source branch feat/macos-phase-c2-existing-instance-recovery-20261019.
Exact source commit: 8debce9000c6208fc716ca68fe87a1672d296a22
Original Phase C1 reviewed baseline: 7e03521158db16731801e55803dbb8c870f5288c.
Code execution: isolated MacBook-Air.local Codex CLI gpt-5.6-luna medium, exit 0.
Executor log SHA-256: f87327f6c4fb243fe70c49139c863c76688ea5a2e8a59626aa0500eb485da360.

## Source-only scope

Changed only src/cli.mjs and new src/lib/macos-existing-instance-recovery.mjs plus new tests/macos-existing-instance-recovery.test.mjs. No actual installer invocation or installed state changes, no runner, browser, signer, Control/Sandbox/target mutation or protected branch edits.
Added read-only HOME-scoped instance inventory with no-symlink/private-mode gates; a recovery-preflight CLI, dry-run report and early macOS setup/resume gate for unbound existing instances. No live adoption writer added.

## Independent validation: REVISE

JavaScript source and test syntax PASS.
Focused new macOS recovery tests: 7 total / 3 PASS / 4 FAIL / 0 SKIP (independent Mac run). Failure root: the new tests build HOME underneath os.tmpdir() on macOS, which may be /var (a symlink), while the inspector appropriately enforces no symlink ancestors. Correct tests by starting at fs.realpathSync(os.tmpdir()), chmod 0700 and dispose fixtures, not by weakening path protection.
Independent disposable HOME adversarial probes: 3 cases / 1 PASS / 2 FAIL, SHA256 48a90fd4337e659bb7af4ea8b7c9e6cc4f88bc8d916d8660dcabadfc998d7efb.
First deterministic defect: inspector treats control_repository and sandbox_repository as a single comparison set, falsely rejecting legal distinct repo names; compare each repo role across trusted documents independently, still fail closed on same-role conflict.
Second deterministic defect: a fully populated installer state referring to a DIFFERENT instance_id/installation prefix/instance_root bypasses the early existing-instance guard and falls through to ordinary macOS prerequisite checks; must return MACOS-EXISTING-INSTANCE-REVIEW before any prerequisite/repo operation and no install-state mutation.
Two generated files also had blank lines at EOF flagged by git diff --cached --check; fix within exact allowed surfaces.
Wrapper full default/serial NOT RUN because focused and adversarial validation were already deterministically blocked. No independent exact-SHA Code Review for this FAILED candidate.

## Decision

Chat adjudication: REVISE, delta-only follow-up allowed only for three verified corrections plus trailing EOF cleanup, same new task branch and pinned route chat-333. No user product/architecture judgment required; user authorized Phase C2 code-only adaptation and isolated testing.
Code/marker isolation remains strict. Existing Control remote main projects.json has real target enabled=true but old local migration snapshot reports false; no source of truth silently chosen. Actual instance 1832f0bb and official install-state left unchanged.
Final PASS requires independent wrapper full default and serial + separate read-only exact-SHA cumulative Code Review. PASS never means merge approval.