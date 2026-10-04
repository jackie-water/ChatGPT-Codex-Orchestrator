# v0.1 End-to-End Acceptance

This checklist defines when the Windows-first v0.1 is ready for beta testing.

The test environment must be isolated. Existing production orchestrators, runners, browser profiles, callback queues and project repositories are not test fixtures.

## A. Beginner installation

- [ ] A fresh Windows user can start with only the repository link.
- [ ] AI installation can begin with: "Install this for me."
- [ ] AI runs the official dry-run before the first mutation.
- [ ] AI keeps the user's language (English or Simplified Chinese).
- [ ] AI presents only one required human action at a time.
- [ ] Missing Git, Node.js, GitHub CLI and Codex CLI are detected and installed where supported.
- [ ] GitHub sign-in pauses for the user and is verified before continuing.
- [ ] ChatGPT GitHub Plugin authorization pauses for the user and is verified before continuing.
- [ ] The target repository and current installation Chat URL are collected without asking the user to edit configuration files.
- [ ] Closing and restarting setup resumes from persisted state instead of starting over.

## B. Installation isolation

- [ ] A private control repository is created for the installation.
- [ ] A separate private sandbox repository is created automatically.
- [ ] A separate local runner path and unique runner label are used.
- [ ] A separate browser profile/debug port is used.
- [ ] The real application project is registered with `enabled=false`.
- [ ] Before sandbox completion, the real project cannot run CODEX-RUN, CODE-REVIEW, MERGE-APPROVE, preflight or checkpoint setup.
- [ ] Before sandbox completion, the real repository has no new checkpoint branch or code change created by the installer.
- [ ] Sandbox orchestration is enabled independently.

## C. Sandbox implementation lifecycle

- [ ] The sandbox fixture begins in `not-ready`.
- [ ] Installer creates one sandbox `[CHAT-REGISTER]` request before the first sandbox CODEX-RUN.
- [ ] Sandbox CODEX-RUN cannot start until the same Chat receives `[CHAT-ROUTE-REGISTERED ...]`.
- [ ] Installer starts one sandbox CODEX-RUN using the registered sandbox `review_route`.
- [ ] Codex works only on the sandbox task branch.
- [ ] Prompt-policy validation rejection consumes no Codex execution and returns to Chat for deterministic repair.
- [ ] Wrapper validation runs outside Codex.
- [ ] The implementation callback returns to the exact registered Chat.
- [ ] A near-final sandbox commit receives one independent exact-SHA Codex Code Review.
- [ ] Re-requesting review for the same SHA reuses existing evidence.
- [ ] A changed SHA invalidates the previous review.
- [ ] User receives one explicit sandbox-only merge approval request.
- [ ] No sandbox merge occurs without explicit approval.
- [ ] Approved sandbox merge is exact-SHA and fast-forward only.
- [ ] Sandbox main reaches `ready`.

## D. Real-project activation

- [ ] Only after sandbox main reaches `ready` does the installer enable the real project.
- [ ] The real project checkpoint branch is created only after sandbox completion.
- [ ] The user is asked to trust the real project folder only after sandbox completion.
- [ ] The current installation Chat is explicitly registered for the real project after sandbox completion.
- [ ] Installation reaches READY only after real-project activation, Chat registration and trust.

## E. Callback reliability

- [ ] A new Chat without registration is rejected before Codex starts.
- [ ] Re-registering the same active Chat URL for the same project is idempotent.
- [ ] A different Chat receives a different registered route.
- [ ] CODEX-RUN, CODE-REVIEW and MERGE-APPROVE reject missing, malformed, unknown or inactive routes.
- [ ] Normal callback delivery succeeds only to the URL pinned by the registered route.
- [ ] There is no default reviewer Chat and no fallback Chat.
- [ ] If ChatGPT is busy generating, the sender waits instead of submitting the form.
- [ ] If a callback cannot be sent, it is queued with the exact pinned Chat URL without marking completed implementation work as failed.
- [ ] Pending callback state distinguishes at least PENDING, DRAFT_INSERTED and DELIVERED.
- [ ] A callback ID appearing only in a composer draft is not treated as delivered.
- [ ] Manual Send of a visible `callback_id` message is safe.
- [ ] A delivered callback is not intentionally sent a second time.
- [ ] Legacy origin/fallback pending callbacks are retired instead of replayed after migration.
- [ ] A missing exact target Chat tab is opened in a new tab; another Chat is never navigated away from its conversation.
- [ ] Two different Chats can submit separate orchestration issues without crossing callback destinations.
- [ ] Three rapid tasks can queue while one is running without the middle task being silently replaced.
- [ ] Implementation callbacks reference an immutable run report path and checkpoint commit, not `.codex/latest-run.md`.
- [ ] Code Review callbacks reference immutable by-commit review evidence.
- [ ] Sleep/wake does not require rerunning Codex.
- [ ] Session recovery checks runner, browser, exact-destination pending callbacks and preflight.


## F. Iteration and token controls

- [ ] Project maximum implementation iterations defaults to 5.
- [ ] Pre-Codex prompt-policy rejection does not consume a logical implementation iteration.
- [ ] Routine validation commands in the Codex prompt are rejected before Codex starts.
- [ ] Correction prompts use the configured smaller REVISE limit.
- [ ] Implementation and review token usage are recorded when available.
- [ ] Independent Code Review is not run on every iteration; it is a near-final gate.

## G. Safety and merge

- [ ] Codex cannot work directly on the default branch.
- [ ] Arbitrary shell strings are not accepted as validation commands.
- [ ] Validation executable allow-lists are project-specific.
- [ ] Code Review runs read-only.
- [ ] Code-changing merges require successful exact-SHA review evidence.
- [ ] Merge still requires explicit human approval after PASS.
- [ ] No force-push, automatic rebase, synthetic merge commit or deployment is performed.

## H. Beginner support tools

- [ ] `Check Status.cmd` presents understandable health information.
- [ ] `Repair Chat Connection.cmd` attempts safe automatic recovery.
- [ ] `Report a Problem.cmd` creates a local sanitised report.
- [ ] English installation request keeps English guidance.
- [ ] Chinese installation request keeps Chinese guidance.

## I. Privacy-safe feedback

- [ ] Diagnostic upload defaults to OFF.
- [ ] Passwords, access tokens, API keys, cookies, sessions, environment secrets and source code are excluded/redacted by default.
- [ ] Report can be previewed before upload.
- [ ] Submission requires explicit consent.
- [ ] Approved report creates a GitHub Issue in the configured feedback repository.
- [ ] Error IDs are stable enough to map a user symptom to troubleshooting guidance.

## J. Regression protection

- [ ] GitHub-hosted CI passes Node tests.
- [ ] Windows CI parses all runtime PowerShell.
- [ ] Browser callback JavaScript passes syntax checks.
- [ ] Tests prevent production-specific Priceup/Clean Energy hardcodes.
- [ ] Tests prevent real-project activation before sandbox verification.
- [ ] Tests prove old origin-discovery scripts are absent.
- [ ] Tests prove generated config contains no default/fallback Chat route.
- [ ] Tests prove workflow concurrency uses `queue: max` so multiple pending runs are not silently replaced.
- [ ] Upgrade tests retire old origin/fallback pending callbacks instead of delivering them.

v0.1 is not beta-ready until all required items above have either passed or have a documented, user-approved exception.
