# Immutable Phase C2 implementation — Control #374, iteration 9/9

Project: orchestrator-dev. Exact Chat route: chat-369.
Source branch: feat/macos-phase-c2-existing-instance-recovery-20261019
**Exact implementation source SHA: d27089f931a852e04438a4820ef1cc298b2b24ba**
Immediate predecessor: 1021999efdd5cc2782ab24a576445c3ed9ab162c
Full cumulative C2 review base (C1 PASS_REVIEW_ONLY): 7e03521158db16731801e55803dbb8c870f5288c
Previous immutable Code Review #373 checkpoint: deb2ed84d13a9aead1ebe18a8fe18ebed55f1077.
User specifically authorized one additional 9/9 correction for Chromium profile spaces and inactive route admission. Codex edited code only on MacBook-Air.local, exit 0, did NOT commit/push. Executor log SHA256: 299238b7615825ba206a89defb84f7167edeb4180905116c26e73b758960a0c9.

Independent wrapper committed and pushed source SHA after all PASS. Exact source diff from previous commit SHA256: 5f89a3045e22b4cdfb10cd82af18cff3b6ca1bc805fd03314de5647c97727fac. Only src/cli.mjs, src/lib/macos-existing-instance-recovery.mjs, tests/macos-existing-instance-recovery.test.mjs changed.

## Independent validation
All tests run with private canonical disposable HOME, without accessing real installation or protected projects:
- Allowlist, git diff --check, syntax: PASS.
- Focused C2/P3/dry-run: 25 PASS, 0 FAIL, 0 SKIP. Log SHA256 9ff9bcc1ddf24a739df697de84a997c669cc9830348fd0b7dfd165a62a096c09.
- Full default: 470 total / 460 PASS / 0 FAIL / 10 SKIP. Log SHA256 701b631095c1d9fb9b907a4e33d9437af408d46858dd4541d1c1680a544ac8ff.
- Full serial: 470 total / 460 PASS / 0 FAIL / 10 SKIP. Log SHA256 477536c4bb5b6f2c6f6211abb8283c833e3cd2bac90209e5d00e6c4b4b0067c3.
- Independent 8 scenarios x recovery-preflight/dry-run = 16 probes: matching and safe Chromium space-name positives PASS; negative nested symlink, installer repo roles, route repo roles, missing independent metadata, selected inactive route, wrong route project all fail closed with explicit MACOS-EXISTING-INSTANCE-REVIEW and mutations:false, empty plan, no external sentinel. Probe SHA256 0cdf7558f8f9525fe250b7608ef52385111ef105fe0d8fdca30d6445b8b89650.
- Wrapper JSON SHA256: 3e7ad70930c81e6886952fe960f7915530cd0e06360080abfeeb8e13463c501a.

Local private evidence path: /Users/Jackie/.chatgpt-codex-orchestrator/instances/1832f0bb/short-turn-evidence/issue-374-macos-phase-c2-active-route-9of9-v1/

**Implementation wrapper PASS only, not final Chat PASS.** One independent read-only Code Review of entire cumulative diff from C1 base to this exact SHA is required; do not substitute review of predecessor. Merge is NOT authorized. No real setup, signer, Runner, LaunchAgent, browser/CDP, Sandbox merge, target activation, protected main/dev changes, or changes to Windows/Priceup/Clean Energy. Old #332/chat-303 remains unstarted.
