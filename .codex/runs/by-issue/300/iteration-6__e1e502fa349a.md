# Immutable implementation checkpoint — human-authorized REVISE 6/6, Control #300

- Project orchestrator-dev, exact registered originating review_route chat-267.
- Repository jackie-water/ChatGPT-Codex-Orchestrator
- Isolated source branch feat/macos-official-libproc-installer-20261018
- Reviewed original exact parent source SHA f35d0db64e3831542974002766e93a3b0eaea965
- Exact new implemented source SHA e1e502fa349a902bda7ba836d38eb5d7a4966b67
- Human authorization: user explicitly raised this ONE task iteration maximum from 5 to 6 for three accepted P2 technical blockers ONLY; no merge, installation or deployment approval.
- Prior immutable independent Code Review #299 checkpoint 8d24f54217d5371d96cfb36ac4019faf20ab0e90; report .codex/reviews/by-commit/f35d0db64e3831542974002766e93a3b0eaea965.md.
- Wrapper independent validation orchestrator-dev-300-6-validation-v2 terminal PASS; aggregate committed source SHA256 ca7e165a2016ac8ad429598f3228d42c4cc3c1417d7406e8ad78e464d8072679
- src/lib/macos-native-helper-install.mjs blob sha256 0aa81b845b8e626a69ef8888478b7279c0b8a7848ca27fa482355833334a690b
- tests/macos-native-helper-install.test.mjs blob sha256 85f61eda49827a3c27d28d1e426460026ed49cf8b9d6a583655bd0eb8e8a313b

## Source changes and deliberate safety tradeoffs
- Logic writer identity: writerClaim same-process reentry requires both in-memory and persisted owner_id to equal the CURRENT requested writerId, plus existing nonce, PID, device/inode, installation and trust checks. Different logical writer in same process fails closed; focused isolated regression included.
- Lock retirement: standard Node FS has no atomic identity-conditional pathname unlink; releaseWriterClaim no longer deletes an existing lock after a disjoint lstat/read. It conservatively preserves claim/evidence and requires manual recovery with cleanup_status UNKNOWN when safe ownership-conditional deletion cannot be proven. This is a safety-first tradeoff; it does NOT promise automatic retry of every deterministic pre-journal failure.
- Mutation reporting: preJournalFailure never claims mutations_performed false when claim cannot safely be retired and compiled temporary binary or instance evidence may remain. It returns UNKNOWN, recovery_status MANUAL_RECOVERY_REQUIRED and preserved lock metadata. Isolated competing-helper/foreign claim injection regression included.
- Single same-iteration test-only correction changed one preflight mock so native writer-B attempt reaches writerClaim without bypassing toolchain preflight. Production scope remained src/lib/macos-native-helper-install.mjs; native C, PID parser and runtime timeout unmodified.

## Wrapper PASS evidence
- 11 wrapper steps all exit zero: diff integrity, Node syntax checks, Apple clang real source compile, kernel libproc birth sec/usec self PID double-read and invalid/missing PID probes, focused suite and complete suite.
- Focused serial: node --test --test-concurrency=1, 54 tests, 53 pass, 0 fail, 1 skip.
- Complete serial: npm test -- --test-concurrency=1, 391 tests, 381 pass, 0 fail, 10 skip.
- Focused log sha256 727c6965421e2527405d651e46bbc13d946e65a087bd774ffa1d90c536bdfba7
- Full log sha256 75c3b41e65f5e56ec887be18bbd83b001080e784ff8ef6fcc928298dac50f6e5
- Wrapper terminal sha256 227b0b559569b042a11b8001101b805c25d5df48c1f9f71cbae4a07c53ce34ef
- KNOWN QA GAP: predecessor and an initial focused attempt under loaded Mac sometimes failed MACOS-NATIVE-PID-PROOF-FAILED because one native helper invocation timed out within fixed 250ms. No timeout increased or proof bypassed. This serial PASS does not establish default-parallel stability or full isolated live Sandbox E2E.

## Mandatory review and deployment gates
- NEW independent read-only exact-SHA Code Review is required for e1e502fa349a902bda7ba836d38eb5d7a4966b67. This was final human-authorized 6/6; any further blocking technical changes require NEEDS_HUMAN and a separate explicit user decision rather than creating a 7/7 job.
- Unknown legacy helper/receipt and unverified claimant remain fail closed/manual recovery. No automatic legacy migration or destructive cleanup.
- No official installer executed on real Mac, no globally installed/signed native helper, no actual launchctl or Runner/Control workflow activated, no Sandbox/real target enabled, no PROJECT_DISABLED bypass, no Windows, original dirty #279 or other project change, no deployment or merge.
- Independent Chat PASS would be review-only and not authorization to merge; exact new SHA needs explicit separate user approval.
