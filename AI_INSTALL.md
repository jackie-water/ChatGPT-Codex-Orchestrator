# AI Installation Protocol

This file is the execution contract for an AI assistant installing ChatGPT Codex Orchestrator.

## Goal

A non-technical user can provide this repository URL to an AI, say "install this", and complete setup with minimal manual work.

## Mandatory behaviour

1. Use the official installer entrypoint.
2. Automate every safe operation supported by available tools.
3. Never ask the user to manually edit JSON, YAML, PowerShell, Git refs or configuration files.
4. Present at most **one required human action at a time**.
5. After presenting that human action, STOP and wait.
6. Verify the action before advancing.
7. Never assume OAuth, login, repository authorization or Codex trust succeeded.
8. Persist installer state and resume from the last verified step.
9. Never use an existing production orchestrator, runner, browser profile or project repository as an installation test.
10. Never upload diagnostics without explicit user consent.

## Language continuity

Use the language of the user's installation request unless they explicitly switch languages.

- Chinese request -> `zh-CN`
- English request -> `en`

Persist the choice. User-facing AI guidance, installer messages, status, repair and reporting should continue in that language.

Do not change language because command-line output is English.

## Official entrypoints

Windows interactive bootstrap:

`Install.cmd`

AI / structured bootstrap:

`powershell -ExecutionPolicy Bypass -File .\install.ps1 -Json -Language <en|zh-CN>`

After Node bootstrap:

- setup: `node src/cli.mjs setup --json --language <en|zh-CN>`
- save a verified user answer: `node src/cli.mjs answer --action <action_id> --value <value> --json`
- resume: `node src/cli.mjs resume --json`
- doctor: `node src/cli.mjs doctor --json`
- status: `node src/cli.mjs status --json`
- repair: `node src/cli.mjs repair --json`
- prepare report: `node src/cli.mjs report-problem --json`

## Result contract

The installer returns one of:

### PASS
Current work succeeded.

### NEEDS_USER_ACTION
Explain only the returned current action, wait, verify, then resume.

### WAITING
The system is waiting for an asynchronous automation step such as Codex execution, callback delivery, Chat review or independent Code Review.

Do **not** invent a manual workaround and do not rerun Codex. If a callback arrives, process that callback according to the generated Project Instructions. Otherwise check status again after the relevant automation completes.

### ERROR
Attempt safe automatic repair first when recoverable. If repair fails, offer a sanitised diagnostic report. Obtain explicit consent before any upload.

## Human-only actions

Examples:
- GitHub sign-in / OAuth approval;
- ChatGPT / Codex sign-in;
- granting access to a private repository;
- confirming a reviewer Chat URL;
- adding generated ChatGPT Project Instructions when no supported settings API exists;
- explicit final merge approval.

Never combine several human actions into one instruction.

## Safety

Safe Mode is the default. Do not silently disable it.

Never:
- attach DEV tests to an unrelated existing self-hosted runner;
- overwrite an existing production config directory;
- modify a production repository during smoke testing;
- put Codex directly on a protected/default branch;
- enable automatic merge;
- enable automatic diagnostic upload.

## Development isolation

This DEV repository must use its own config root, runner label, browser profile/debug port and sandbox repository when end-to-end testing begins.

Existing Priceup and Clean Energy production infrastructure is outside the test scope.


## Installation sandbox

The installer creates a separate private sandbox repository automatically. The real application repository must not be used for the first end-to-end test.

When an installation-smoke CODEX callback arrives:

1. Read the exact implementation checkpoint/diff.
2. Confirm the sandbox task is limited to the expected ready-state fixture.
3. If deterministic implementation defects exist, use the normal delta-only REVISE flow.
4. If the implementation is a near-final candidate, create the exact-SHA CODE-REVIEW request.
5. Adjudicate the independent review.
6. If there are no blocking findings, ask the user for **one explicit approval** to merge the exact reviewed commit into the sandbox only.
7. Never infer approval from installation intent.
8. After approval, create MERGE-APPROVE for that exact sandbox SHA.
9. Resume installer verification after the sandbox merge callback completes.

The sandbox merge is the only merge performed during installation. The user's real project must remain unmodified.


## Real-project activation gate

The real application project is deliberately registered as disabled during installation.

Before the Sandbox reaches COMPLETE:
- do not create CODEX-RUN, CODE-REVIEW or MERGE-APPROVE requests for the real project;
- do not ask the user to work around PROJECT_DISABLED;
- do not create a checkpoint branch in the real repository;
- do not treat a local read-only clone as permission to modify the remote repository.

After the Sandbox has passed and the installer activates the target project, normal orchestration can begin.

If any command reports PROJECT_DISABLED, resume the official installer rather than bypassing the gate.
