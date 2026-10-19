# Phase C2 immutable implementation report — Control #372

Project: orchestrator-dev
Review route: chat-369
Source: jackie-water/ChatGPT-Codex-Orchestrator
Branch: feat/macos-phase-c2-existing-instance-recovery-20261019
Exact source commit: 1021999efdd5cc2782ab24a576445c3ed9ab162c
Reviewed baseline: 7e03521158db16731801e55803dbb8c870f5288c
Previous commit: 9da397bec114949259b826097928083c988a4375
Iteration: 8/8 (explicit one-time user approval)

Codex edited the permitted source and tests and exited 0. It did not commit. Independent wrapper committed and pushed the exact source SHA only after validation.

Independent validation:
- Scoped source modifications, syntax, clean diff: PASS.
- Focused 22 tests: 22 PASS, 0 FAIL.
- Full default 467 tests: 457 PASS, 0 FAIL, 10 SKIP.
- Full serial 467 tests: 457 PASS, 0 FAIL, 10 SKIP.
- Ten isolated safety injections: PASS, with no real setup or external state mutation.
- Source diff SHA256: 098ca4172c1847c39b36cd93392d301e163d5bfb9a0c029ea2c9e1497f69c2fb
- Wrapper report SHA256: e1e46c02c17e1e639895647dbdf071570f5ee61925fdb7551f77872b81e4aab9
- Probe report SHA256: 3ba7faf4f7ddb503951c64bb5817c6429ca99c0039b90586d3ea3a0be9170d9a
- Focused log SHA256: e5fb7285364f28245c1bcf3e4fb21bc5ccd163b106a859839d5f2f3550add02c
- Default log SHA256: acaed7ee4b7fdb36548e1daac0d8450ab8e5bfe9c1e91212d9590fda757ed8e2
- Serial log SHA256: ce65e41bce028ac2045b53a7e7c0a15e893f5dea061f58e50949ce6a1c9b3bee

C2 fix preserves root instance-ID validation, bounds recursive safe tree traversal, permits owned private native dotfile, and requires independent instance, route, migration and repository identity evidence before recovery. Full cumulative source diff must be independently code-reviewed for exactly the above SHA.

Implementation wrapper PASS is not Chat review PASS. Exact-SHA independent Code Review not yet completed. No merge, installer, Runner, Sandbox activation, or protected branch changes are authorized.
