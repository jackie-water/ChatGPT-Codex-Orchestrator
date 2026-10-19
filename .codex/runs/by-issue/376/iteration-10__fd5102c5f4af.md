# Immutable macOS Phase C2 implementation — Control #376, iteration 10/10

Project: orchestrator-dev
Exact registered originating Chat review_route: chat-369
Repository: jackie-water/ChatGPT-Codex-Orchestrator
Non-protected source branch: feat/macos-phase-c2-existing-instance-recovery-20261019
**Exact committed and remote-verified source SHA: fd5102c5f4af8043c89c24c1352af1246f5b1dee**
Immediate predecessor: d27089f931a852e04438a4820ef1cc298b2b24ba
Cumulative C2 independent Code Review base, prior C1 PASS_REVIEW_ONLY: 7e03521158db16731801e55803dbb8c870f5288c
Previous independent review checkpoint #375: f223cd6921f0f707e57bc850f66c553f626aafa7, path .codex/reviews/by-commit/d27089f931a852e04438a4820ef1cc298b2b24ba.md.
User explicitly authorized ONE 10/10 iteration for two independent P1 findings. Control implementation issue #376.

## Exact deterministic correction
Only src/lib/macos-existing-instance-recovery.mjs and tests/macos-existing-instance-recovery.test.mjs changed.
1. Distinguishes strict instance-ID names from bounded safe private tree descendants, allowing valid leading-dot entries such as .git and .orchestrator-sandbox. Still excludes "."/"..", separators, non-allowed/control characters; preserves recursive symlink no-follow, owner/mode/nlink, special node and bounded traversal.
2. Rejects duplicate identical route identifiers across active/inactive/all route records as CONFLICT. Preserves legitimate distinct route registrations and exact active selected-route identity binding.

**Deliberately deferred, NOT fixed/relaxed:** the reviewer-confirmed difference between official installer-generated metadata placement/schema and C2 required independent trusted instance evidence. Missing trusted migration/role proof remains fail-closed; no self-certified installer-state recovery or real adoption authorized.

## Independent wrapper
MacBook-Air.local Codex local gpt-5.6-luna medium; edits only; exited 0 and did not commit/push. Codex executor log SHA256: 69602268420d5d04af10b6b5d08e33e25a7e0009978495bffcfb1592d024622c.
Independent wrapper ran syntax and allowed diff checks plus focused, separate adversarial and full tests with private canonical disposable HOME, before it committed/pushed exact SHA. Source diff SHA256: f47a9667abc7b5e253cc6ccfd57e856de4e270c0ed1118ce8b8104507529d159.
- Focused C2/P3/dry-run: 28 tests, 28 PASS, 0 FAIL, 0 SKIP; log SHA256 8f3d9426fdfd30cc63e6d328005e95b14c3c9723869c9e1b5b4a8031b046b587.
- Full default: 473 total / 463 PASS / 0 FAIL / 10 SKIP; log SHA256 8158133d9520ce8cba6c3d6a9b3806bb9a93dddac25493514e701e75de66291a.
- Full serial: 473 total / 463 PASS / 0 FAIL / 10 SKIP; log SHA256 34ff7f19d4743f22bc23151af49a8549d2b8edf6af546efa0a5d1438167bfe9c.
- Independent disposable initial 8 scenarios x 2 CLI commands = 16 positive/negative proofs; all pass. SHA256 7f37db291d8ca7fccdf18b1b1e4839463a278fa329b765d4cfe4b490dc5804c5.
- Independent private hidden directory and duplicate route 5 scenarios x 2 = 10 proofs; all pass. SHA256 b74ac33b36cf93beb3d03320615e95c027403ab32d0984e0b6ed88fa194eca77.
- Independent wrapper JSON SHA256 d305ab1cdf1304eba02fc4bd38746a651d86c05aabe51604586fcca9f173cf78.

Private durable Mac artifacts: /Users/Jackie/.chatgpt-codex-orchestrator/instances/1832f0bb/short-turn-evidence/issue-376-macos-phase-c2-hidden-duplicate-10of10-v1/ (accepted.json, prompt.txt, terminal.json, executor.log, independent-wrapper.json, focused and default/serial logs, both adversarial probe reports, candidate-commit.json).

## Review and security gates
Implementation wrapper PASS only; new independent read-only **FULL CUMULATIVE** source review from 7e03521158db16731801e55803dbb8c870f5288c to this exact SHA remains mandatory, with independent Chat adjudication. Previous Code Review #375 for different SHA cannot be reused.
**NO merge, NO official installer setup/adoption, NO signer/Runner/LaunchAgent/browser-CDP, NO Sandbox merge or real target activation, NO protected main/dev change.** Previous Phase B #332/chat-303, Windows, Priceup and Clean Energy remain untouched. 10/10 cap exhausted: any additional code revision needs new explicit human authorization.
