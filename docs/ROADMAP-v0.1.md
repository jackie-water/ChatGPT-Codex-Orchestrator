# v0.1 Roadmap

## Product goal

A non-technical Windows user can give the public repository URL to an AI and say "install this". The AI uses the official installer, automates safe configuration, pauses for one human action at a time, verifies it, and resumes.

## Phase 1 — Foundation

- bilingual beginner README;
- AI installation protocol;
- persistent installer state;
- language continuity;
- stable error IDs;
- local sanitised diagnostics;
- Project Instructions generation;
- Doctor / Status / Repair command surface;
- Safe Mode schemas;
- isolated GitHub-hosted CI.

## Phase 2 — Generic orchestration core

Port proven capabilities into generic adapters without touching production Priceup or Clean Energy:
- generic project registry;
- local clone adapter;
- CODEX-RUN;
- wrapper validation;
- prompt-policy guards;
- callback queue and idempotency;
- exact-SHA independent code review;
- human-approved exact-SHA merge gate.

## Phase 3 — Windows automation UX

- one-click setup;
- prerequisite detection/install;
- GitHub authorization guidance;
- repository/validation auto-detection;
- generated Project Instructions;
- Status and Repair shortcuts;
- dedicated browser profile/debug port.

## Phase 4 — Feedback

- structured diagnostic bundle;
- sanitiser;
- explicit-consent GitHub Issue adapter;
- bilingual troubleshooting;
- extended diagnostics.

## Phase 5 — Sandbox validation

Use a dedicated sandbox repository and separate runner/browser/config namespace. Test install/resume, sleep/wake, stuck callbacks, manual-send recovery, duplicate suppression, validation failure, prompt auto-repair, five iterations, independent review, stale SHA protection and explicit merge approval.

No production workflow is a sandbox.
