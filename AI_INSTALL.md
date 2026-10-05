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

- dry-run: `node src/cli.mjs dry-run --json --language <en|zh-CN>`
- setup: `node src/cli.mjs setup --json --language <en|zh-CN>`
- save a verified user answer: `node src/cli.mjs answer --action <action_id> --value <value> --json`
- resume: `node src/cli.mjs resume --json`
- refresh runtime: `node src/cli.mjs refresh-runtime --json`
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
- providing the current ChatGPT conversation URL for explicit callback registration;
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


## Dry-run before mutation

Before the first real setup mutation, run the official dry-run once.

The dry-run may inspect local command availability and existing installer state, but it must report `mutations_performed: false`. It must not create GitHub repositories, configure a runner, create checkpoint branches, or modify the user's project.

Use the dry-run output to explain only the next relevant user action. Do not turn the dry-run into a long list of technical instructions.


## Explicit Chat callback registration

Do not discover callback destinations by scanning Chat history or open browser tabs.

Each ChatGPT conversation must explicitly register its own callback destination before it creates its first CODEX-RUN, CODE-REVIEW or MERGE-APPROVE for a project.

For a new Chat:
1. ask once for the full URL of the current ChatGPT conversation;
2. create one `[CHAT-REGISTER]` issue in the private control repository with `project` and `chat_url`;
3. stop and wait;
4. continue only after the same Chat receives `[CHAT-ROUTE-REGISTERED ...]`;
5. use the exact returned `review_route` for subsequent issues from that Chat and project.

A different Chat must register separately.

There is no default reviewer and no fallback Chat. Missing, malformed, unknown or inactive `review_route` must stop the operation before Codex or merge execution.

The one-time private registration issue may contain the Chat URL because the user explicitly supplied it for routing. Normal coding/review/merge issues must contain only the route name.

If callback UI delivery fails after a route is resolved, retry only the exact pinned URL. Never search for another Chat.

Installer-created sandbox work must use the same explicit registration system. The installer may create the `[CHAT-REGISTER]` issue automatically because it already knows the current installation Chat URL, but it must wait until the route is registered before starting Sandbox CODEX-RUN.

## Generated private repository authorization

After the installer creates the private control and sandbox repositories, do not assume the existing ChatGPT GitHub authorization automatically includes them.

Before continuing to Codex trust:
1. read the `generated_repo_authorization` action;
2. ask the user to add the generated control and sandbox repositories to the ChatGPT GitHub connection if necessary;
3. verify from ChatGPT that both repositories are actually accessible;
4. only then save `generated_repo_authorization=true` and resume.

Local `gh` access is not sufficient proof of ChatGPT GitHub access.
