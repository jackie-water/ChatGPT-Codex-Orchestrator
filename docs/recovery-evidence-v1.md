# Trusted Recovery Evidence Contract v1

This contract is the authority for recovering an existing macOS Orchestrator instance. It is versioned, fail-closed, and separate from installer state. A local installer state file, a local checkout, a browser profile, or a route file by itself is never proof of trust.

## Trust domains

Verification cross-checks two independently queried private GitHub repositories and one authored explicit Chat registration issue against local exact-instance evidence:

- Control and Sandbox are full `owner/repository` identities. Each must be `PRIVATE`, have the expected owner and name, and match its persisted immutable GitHub repository ID. Control is the authority for installer/runtime identity; Sandbox is the isolated project role.
- The registration issue must be queried independently from GitHub. Its author, JSON body `project`, normalized `chat_url`, and `installation_id` must match the installation. The selected route must be the exact active route for the Sandbox project and must bind to the unique registration issue.
- Local evidence must include the Control clone identity, the instance-root `migration-intent.json`, and the versioned private receipt. These records must agree on `installation_id`, canonical `instance_id`, Control repository, and Sandbox repository.
- The trusted Control clone path is the installer’s canonical `defaultLocalPaths({home, installationId, projectKey}).control` path (`home/ChatGPTCodexOrchestrator/control-<historicalInstallationShortId>`), outside the instance root. The route file is exactly `instanceRoot/chat-routes.json`; caller-supplied alternate or aliased paths are not trust inputs.

The receipt is `trusted-recovery-evidence-v1.json` in the canonical instance root. Its required fields are `schema_version: 1`, `status: VERIFIED`, `installation_id`, `instance_id`, `control_repository`, `sandbox_repository`, `control_repository_id`, `sandbox_repository_id`, `registration_issue_id`, `registration_issue_author`, `identity_sha256`, and an issuer timestamp. `identity_sha256` is a SHA-256 hash of the canonical identity inputs; secrets, credentials, tokens, issue bodies, and raw API diagnostics are never written to diagnostics.

The verifier returns:

- `ABSENT`: no instance proof exists and no existing installation identity requires adoption.
- `NEEDS_HUMAN_LEGACY`: historical/manual Mac artifacts exist without this contract. They are not adopted automatically.
- `VERIFIED`: all local and independently queried remote evidence agrees.
- `CONFLICT`: evidence is malformed, unsafe, duplicated, inactive, tampered, unavailable, or contradictory.

Offline GitHub, missing credentials, an unavailable API, or contradictory API results are denial conditions. The implementation does not claim signed GitHub guarantees and does not accept caller-supplied repository or issue responses as the sole source of truth.

## Issuance and bootstrap

The official installer must first complete its existing approval, GitHub CLI and ChatGPT GitHub authorization gates, create/access the exact private repositories, and obtain the actual explicit route registration. Only then may the local issuer query independent repository and issue provenance and write the receipt.

First boot may safely observe `ABSENT` before generated repositories and the route exist; it must not demand a receipt circularly. Once the exact route exists, subsequent setup/resume validates or issues the receipt before adopting Sandbox evidence. An interrupted partial state remains blocked or requires human review; it is never silently adopted.

The issuer uses owner checks, no-follow `lstat` checks, 0700 directories, a 0600 regular file with a single link, `fsync`, atomic rename, and directory `fsync`. An existing receipt is idempotent only when it exactly matches. A forged, tampered, or inconsistent receipt is never overwritten.

## Local trust-boundary classification

Identity manifests, the Control clone authority, migration/registration proof, and the native helper receipt/binary remain strict: private owner-controlled path chains, no symlinks, regular single-link files, approved modes, and exact hashes are required. Historical Git checkout objects, logs, Chromium/browser files, and other passive artifacts are not authority and need not all be 0600/0700. They are still bounded and checked for unsafe owners, traversal, nested symlink escape, malicious names, and executable boundary violations.

## Historical migration

Migration of a manually staged or historical Mac instance is a separate human-approved procedure. Read-only preflight may classify it as `NEEDS_HUMAN_LEGACY` and report sanitized missing gates. It must not chmod, rewrite, delete, migrate, overwrite, start a runner, compile a helper, create a GitHub repository/issue, or activate a target. A human-approved migration must independently establish the exact instance identity, private repository provenance, authored registration, route uniqueness, and receipt before adoption.

`Install.command` and `install.sh` remain the only macOS entrypoints. Dry-run and recovery-preflight are read-only; setup/resume issue evidence only after the existing gates and explicit route registration succeed. The target remains disabled until Sandbox verification and all prior explicit-route-v1 and native-helper PID proof gates pass.
