# M2 #411 exact-SHA delta-only implementation evidence

Project orchestrator-dev | originating chat-408 BOOTSTRAP_SCOPED_ONLY
Source: jackie-water/ChatGPT-Codex-Orchestrator
Nonprotected branch: feat/macos-first-runner-autoloop-m2-20261022
Base reviewed SHA: 9850eb75642a872b3d21f5ed329ea10d5cdd927e
Exact candidate SHA: b18933a5f1c32d2d8e9c9342d45d9a1c0f3aab6b
Original Codex log SHA256: 63c76661d329d7506669c3486a75acbf89826713d65992c9fd0dfe104bd8f3ed (preserved)
Original Codex prompt SHA256: bb5e55d2cc39e725dd90673e5a2a476d400e795a0d598f7cb81e5d0bff11ce6f (preserved)
Original independent wrapper default FAILED (5 test assertions), preserved original log.
Delta-only Codex prompt SHA256: ef27c5eef5f046437027a83ff8952a1f30aa4eca82ea3dd7027808f716017ec2
Delta-only Codex log SHA256: d89696182b5771280b5bde5d49287f593ab46013083b7fd63111c3d8956b1841
Only four additional test files were authorized. Original 22 files remained identical until commit.
Changed files (26): AI_INSTALL.md, runtime/scripts/register-chat.mjs, src/cli.mjs, src/lib/chat-registration.mjs, src/lib/control-env.mjs, src/lib/control-render.mjs, src/lib/macos-existing-instance-recovery.mjs, src/lib/macos-platform.mjs, src/lib/macos-runner-bootstrap.mjs, src/lib/macos-trusted-recovery-evidence.mjs, templates/control-repo/orchestrator.macos.yml.template, tests/answer.test.mjs, tests/cli-macos-firstboot.test.mjs, tests/control-macos-firstboot.test.mjs, tests/dry-run.test.mjs, tests/instance-isolation.test.mjs, tests/macos-existing-instance-recovery.test.mjs, tests/macos-p3-journal-launchctl.test.mjs, tests/macos-p3-setup-resume.test.mjs, tests/macos-platform.test.mjs, tests/macos-register-chat.test.mjs, tests/macos-revise-iteration-2.test.mjs, tests/macos-revise-iteration-3.test.mjs, tests/macos-runner-bootstrap.test.mjs, tests/macos-trusted-recovery-evidence.test.mjs, tests/reporting.test.mjs

Independent wrapper results:
- wrapper_focused: exit 0, SHA256 d419fae3d83ec01fbbf41673626e6ccca056b1d4c5bf2c42982acd450f54b7c8
- wrapper_default: exit 0, SHA256 9acc1c17107540affd47a1a64e4d60467874fd94ca09511faf336ab081fe500e
- wrapper_serial: exit 0, SHA256 62e59a7e906c795e9cfe962944f1f697d77c8d0b2dffd2c47fcfef80ce1dc15c

Legacy authority SHA256 unchanged: True
No installation, Runner, Service, browser/CDP, real Sandbox, merge or target activation.
