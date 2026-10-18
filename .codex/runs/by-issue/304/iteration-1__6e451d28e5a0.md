# Immutable implementation evidence — Control #304, iteration 1/5

- Project: orchestrator-dev; registered exact origin route: chat-303.
- Repository: jackie-water/ChatGPT-Codex-Orchestrator.
- Isolated macOS source branch: fix/macos-callback-send-receipt-20261018.
- Exact parent/source base: e1e502fa349a902bda7ba836d38eb5d7a4966b67.
- Exact implemented candidate commit: 6e451d28e5a01cbda51c54949d555e4064002f0e.
- macOS only, private local worktree; no Windows, production runner, installer, merge, main or dev.
- Execution: Codex CLI Luna model, wrapper task orchestrator-dev-304-1, exit 0; executor log SHA256 c0e26208c40070a17307ed775e7a1644873af099d4fb9bbe36a404b3b3313277. Initial prompt SHA256 aaaf70cede83eaac37d56017f708abf45b9bc886b407073b2d9b9c3098855161.
- Independent Mac wrapper terminal SHA256 12b7bce99568d66f75998256eb92afed954f643d37fe8827c9a3909bd005ee9d: 10/10 steps PASS; focused default/serial 25 of 25; full default and serial 394 total, 384 pass, zero fail, 10 skipped each.
- Files changed: runtime/scripts/callback-delivery.mjs, runtime/scripts/register-chat.mjs, runtime/scripts/wake-chat.mjs, tests/callback-reliability.test.mjs, tests/macos-register-chat.test.mjs.
- Chat review outcome: REVISE (deterministic non-security-relaxing corrections). Outer spawnSync timeout matched child wake deadline (both 130000ms) without cleanup cushion. Behavioral busy/idle/send-button fixture coverage insufficient. Both findings were sent as concise delta-only successor Control #305 for exact candidate SHA. 
- No independent Code Review or merge of this superseded candidate. Callback Control #303 was manually sent with appended prose and MUST NOT be automatically resent or inferred exact DELIVERED.
