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

macOS official bootstrap:

`Install.command` (or `./install.sh`)

The macOS entrypoint performs a read-only prerequisite and migration preflight first. It does not install services, create repositories, activate a runner, copy credentials, or change an existing runner. macOS setup remains approval-gated and uses the same CLI state/resume path.

macOS recovery also uses the versioned Trusted Recovery Evidence Contract v1. It independently cross-checks the exact private Control and Sandbox repository identities and immutable GitHub repository IDs, the authored explicit Chat registration issue, and securely owned local instance/migration/receipt metadata. Missing or legacy proof is `NEEDS_HUMAN`; it is never inferred from installer state, a local checkout, a browser profile, or a default Chat route. First boot may remain `ABSENT` until the generated repositories and explicit route exist; the receipt is issued only after the existing approval, authorization, and route gates pass. Historical migration is a separate human-approved procedure and is not performed by recovery preflight.

On macOS, the preflight also reports the reviewed local libproc helper capability. The helper is built only after the existing macOS setup approval and exact installation/private-instance checks. Dry-run, doctor, status, and an unapproved setup do not compile or write it. A missing Apple Command Line Tools/SDK, source-digest mismatch, unsafe private path, failed PID proof, interrupted build, or receipt/binary tamper remains `NEEDS_USER_ACTION` or `ERROR`; it never enables native identity or silently claims the legacy mode is native.

The locally built helper is unsigned and is distinct from any separately gated signing, distribution, or release process. Runner installation and start require the additional first-boot approvals below. Manual receipt/lock recovery must preserve the receipt, establish that no writer remains, and use the reviewed deployment recovery procedure; an uncertain lock must not be deleted as if it belonged to another writer. The full isolated live Sandbox E2E remains separately gated.

## V2.1 M1/M2 macOS ARM64 first boot

The architecture remains GitHub Control -> one self-hosted macOS ARM64 Runner -> local authenticated Codex -> independent wrapper -> the exact registered Chat callback. There is no per-task dispatcher. An ad hoc bootstrap route such as `chat-408` is not installed Runner authority. Preserve historical #404–#406 and closed manual #409; do not rerun them or reopen #409. A new conversation registers separately.

Default recovery still inspects all instances and refuses unsafe or ambiguous historical evidence. It never repairs permissions, adopts, migrates, deletes, or writes an old instance. The explicit alternative is `dry-run --selected-fresh-instance <exact-instance-id> --json`, with already prepared installer state naming that same fresh instance. Only this selected path can regard historical roots as nonauthority. It still checks private ownership, every ancestor, symlinks, hardlinks, identity/name/ID collisions, exact generated roles, and independently queried authenticated GitHub owner and distinct immutable private Control/Sandbox IDs.

If that read-only inspection returns `macos_selected_fresh_instance_approval`, present the exact `approval_challenge`. Only a separate human answer authorizes `answer --action macos_selected_fresh_instance_approval --selected-fresh-instance <exact-instance-id> --value '<exact returned challenge>' --json`. The installer creates an exclusive durable receipt inside the selected instance and verifies it again. General setup approval, a route, an old receipt, or a boolean cannot substitute for this approval. A completely empty candidate or conflicting evidence remains blocked; this adapter cannot adopt it into authority.

Official setup/resume then advances in this order:

1. Verify exact installation/owner identity and setup approval; prepare only a new private Mac Control using `orchestrator.macos.yml.template` and its isolated Sandbox. The existing Windows Control and its workflow are preserved. The target registry entry stays disabled.
2. Obtain the separate ChatGPT GitHub connector authorization for the exact generated private pair and originating Chat URL. Independently requery immutable repository/owner IDs. Local `gh` login alone does not prove connector access.
3. Prepare and verify the reviewed native helper capability, including its existing native PID identity checks. Require Sandbox folder trust and login to the isolated ChatGPT browser profile. Retain the existing 500ms native identity contract; do not replace it with a fabricated process receipt.
4. Stop at `provision_macos_runner` unless a separately approved official `actions/runner` macOS ARM64 release has actually been acquired and registered for this generated Control. This implementation does **not** download, extract, configure, register, or start a Runner as part of provisioning. An independently reviewed provisioning procedure must supply the retained official archive and private candidate descriptor; do not ask a user to hand-edit JSON, invent IDs, or reuse a production Runner. Until that procedure and acquisition/registration approval exist, report **PARTIAL / BLOCKED at provisioning**, and leave services and registration untouched.
5. Inspect the candidate's exact release URL/version and immutable release/asset IDs against the official GitHub release digest, retained archive and complete binary manifest; a release without an authoritative digest remains blocked. Verify the native ARM64 executable, private `.runner`/credential files, config digest, real Runner ID, generated repository immutable IDs, one unique runner/label set, isolated loopback browser profile/port/outbox and authentic ChatGPT Codex login. The candidate pins `runtime_path` to `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`; trusted Node and GitHub CLI must resolve there, with Node matching the installer. The native listener remains the approved `instance/runner/bin/Runner.Listener`. Under the explicit personal-use policy below, launchd starts the archive-pinned `instance/runner/bin/runsvc.sh` in the runner working directory; its selected bundled Node runs `bin/RunnerService.js`, which supervises `Runner.Listener run --startuptype service`. No service script or runner is executed during inspection. A missing executable, wrong OS/architecture/label, extra runner, foreign owner, unsafe mode/link, or contradictory receipt fails closed.
6. Present `macos_runner_package_approval` with its exact candidate and returned digest challenge. After explicit human approval, `answer --action macos_runner_package_approval --value '<exact challenge>' --json` exclusively persists the checked approval; it does not acquire, register, install, or start anything.
7. First present `macos_personal_use_service_policy` with its exact installer challenge. This separate selection trusts the personal Mac account and same-UID processes, authorizes only owner-approved tasks from the exact private Control, and claims no resistance to an attacker already controlling that account. Unknown users, origins, tasks, process identities and path escapes remain untrusted. No unapproved installation gets a default import bypass. Then present `macos_runner_install` and `macos_runner_start` as two separate required human actions. Each uses `answer --action <returned action_id> --value '<exact approval_challenge>' --json`, bound to the current installation, repositories, Runner and package. Resume exclusively claims the one-time action, consumes that approval and durably records intent before each operation. Claims remain preserved; a concurrent resume cannot reclaim one. Installing writes an unloaded plist with `RunAtLoad=false`, without login execution consent. The separate start challenge also authorizes normal user-login restart. Only activation may replace that exact inactive rendering with its approved `RunAtLoad=true` rendering and import it into the normal user GUI launchd domain. It retains the official service environment/session semantics and adds no restart policy beyond upstream. Starting requires live native capability, exact pre/post plist bytes, owned paths, exact arguments/environment and one label. The accepted pathname-import limitation applies only to the selected personal-account policy. An interrupted or uncertain action preserves its journal and claim and requires independent manual recovery; it cannot automatically repeat bootstrap. A read-only action preflight rejects before claiming. A proven no-mutation rejection retains the original journal/claim and requires a new exact approval and distinct bounded attempt claim; it never deletes or reclaims a claim. Only the reviewed pre-import immutable-refusal error can be reconciled from a legacy journal; other legacy error flags alone are insufficient proof.
8. Requery the real GitHub Runner and exact loaded LaunchAgent. Loaded/idle, native listener running, and GitHub online are separate health facts. The imported job PID belongs to the shell supervisor, not the listener. Verify the owned shell -> bundled Node/RunnerService -> native listener lineage with repeated process-edge/command observations and native PID/start-time identities for every chain member using the unchanged 500ms libproc helper. A parent PID comparison or ps-only report is insufficient. Unknown, reused or foreign PIDs fail closed. Publish the first `[CHAT-REGISTER]` only after matching local native listener identity, a final unchanged local service observation, and the exact remote macOS ARM64 Runner online status. Registration itself needs no preexisting Chat route. The Mac workflow uses **only `register-chat.mjs --deliver`** as registration delivery owner, pins the supplied Chat URL, serializes `callback_id`, bounds its child process, and retains durable error evidence. After a send attempt or timeout, retries reconcile the same Chat for a real user-role receipt and cannot submit again. A queued draft or invented terminal receipt is not success. There is no fallback Chat or second outbox delivery owner.

The production archive parser has one 12,288-leaf limit, counting regular files and symlinks together, with the existing 256MiB compressed/single-file, 512MiB inflated/total, and 20,000 raw-header/tree bounds. `inspectMacosRunnerArchive(archiveBytes)` exports that same parser for read-only wrapper inspection; it performs no network, extraction or installation. The wrapper reference for official v2.338.0 is SHA256 `df4cebda25c86a886ed204e49fee63f5c2e7cec5f447b5c98440a826bbdf9df2`, 128562863 compressed bytes, 446363648 inflated bytes, 9390 regular files plus 6 symlinks (9396 leaves), and 2152 directory headers. These reference figures are not a fabricated verification result.

`runsvc.sh` is bound to official `bin/runsvc.sh` bytes through the complete retained archive manifest. An optional root `runsvc.sh` copy is allowed only as an exact owned, private, singly linked executable copy of those bytes. `.path` must be absent or contain exactly the trusted runtime PATH (optionally one final newline); `.env` retains its exact private locale-only approval safeguards. The service model follows the pinned upstream [runsvc script](https://github.com/actions/runner/blob/v2.338.0/src/Misc/layoutbin/runsvc.sh), [supervisor](https://github.com/actions/runner/blob/v2.338.0/src/Misc/layoutbin/RunnerService.js), and [user LaunchAgent template](https://github.com/actions/runner/blob/v2.338.0/src/Misc/layoutbin/actions.runner.plist.template). It needs no Developer ID, paid membership, signing/notarization, sudo or root service.

Upstream automatic updates remain enabled; the installer never silently adds `--disableupdate` or changes the supervisor's update/retry handling. Changed installed package bytes invalidate execution evidence and trigger bounded, read-only official update-provenance re-verification. This needs a separately retained new candidate/archive, exact immutable official release/asset identity and authoritative digest, native ARM64 payload, complete installed manifest, unchanged owner/private Control and unchanged runner configuration. Missing update evidence remains blocked. **Unresolved limitation:** automated retention of an upstream update archive, approval-receipt rollover, acceptance of upstream leftover update directories, and reactivation after a changed package are not implemented. Even verified update provenance cannot fabricate approval, replace the original archive/receipt, or authorize startup. A separately reviewed official installer update procedure is required. Existing inactive direct-listener plists are also preserved and fail exact service rendering; this delta does not silently migrate or overwrite them. A proven old start refusal can be reconciled without retrying that plist.

This iteration is a one-time local implementation bridge for owner-approved private Control work, not formal route authority. `chat-408` remains bootstrap-only. Windows behavior, old `1832f0bb` bytes, the 929 historical anomalies, Priceup/Clean Energy, `explicit-route-v1`, disabled real target, immutable evidence and exact-SHA merge gates remain outside this delta.

Runner package approval files and native capability receipts are different evidence with different authority. Never manufacture either to satisfy a gate. The adapter supplies no approval to execute any of these steps during development. The independent wrapper must perform validation separately; an implementation task that forbids validation must not run tests, build, lint, install dependencies, invoke setup/resume, open a browser/CDP session, deliver callbacks, or install/start services.

The existing macOS post-Sandbox Code Review/merge and target-activation refusal remains in place for M6. Verified Sandbox completion does not authorize main/dev merges, production deployment, or target activation in M1/M2.

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
