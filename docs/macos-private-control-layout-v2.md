# macOS private Control clone layout v2 (fresh installations only)

This is an additive versioned layout, **not** an upgrade or path alias for the
trusted recovery v1 Control. Legacy v1 evidence remains immutable, and a
current legacy Control cannot be silently adopted or relocated.

For an explicitly approved macOS fresh-first-install with no existing Control
identity, the installer may select `macos_control_layout` =
`macos-instance-private-control-v2`. Its canonical paths are:

- Control checkout: `<HOME>/.chatgpt-codex-orchestrator/instances/<canonical-id>/control`
- Target checkout: `<HOME>/.chatgpt-codex-orchestrator/instances/<canonical-id>/automation/<project-key>`
- Sandbox checkout: `<HOME>/.chatgpt-codex-orchestrator/instances/<canonical-id>/automation/sandbox-<canonical-id>`
- Route file: `<instance-root>/chat-routes.json`

The Control path must be private 0700, owned by the current user, and never
a symlink. The directory's shared/v1 parent `~/ChatGPTCodexOrchestrator` is
not read, changed, or adopted. If the v1 Control path for the **same**
installation exists, the v2 preparation rejects it as a collision.

The selected layout must be persisted in both installer state and Control
`instance.json`. Recovery and runtime refresh require the exact same marker
and canonical path. An absent marker means **legacy v1** and does not migrate.
An unknown or inconsistent marker fails closed. The old `docs/recovery-evidence-v1.md`
contract is unchanged for legacy instances; the v2 layout does not establish
Control authority, Chat registration, runner readiness or any merge approval.

A complete, read-only path and existing-Control identity audit precedes
**new G3 migration intent and installer-state writes**, private directory
creation, local target checkout and remote Control/Sandbox repository effects.
The six roles are instance root, target automation parent, Control parent and
clone, browser profile, and pending-wake outbox, including their ancestors.
For a nonempty preexisting Control, the audit additionally reads only bounded
`instance.json` identity metadata and checks the local Git origin and clean
worktree. Its Git clean-tree check uses non-mutating tree/index/untracked plumbing
(with filesystem-monitor and untracked-cache extensions disabled) plus direct
Node Git-blob hashes of tracked working-tree bytes. It **never calls `git
status`/diff** or configured clean filters, executable fsmonitor hooks or
diff drivers. Staged, modified and untracked files are rejected; unsupported
index entries, unsafe path components and unreadable data fail closed rather
than attempting a filter-based comparison. This is a conservative *byte-clean*
check; a checkout requiring content transformations may need separate
read-only reconciliation, not automatic adoption. It reports role/reason without
private paths or general payload contents. Missing or ambiguous metadata,
a foreign origin or dirty checkout halts before remote preparation. No
directory is adopted, relocated or chmod'ed.

A verified **v1** Control checkout may retain owner-owned 0755 permissions
only under its private 0700 parent, when the exact installation, role, owner,
repository and local Git identity all match. The **v2** Control checkout still
requires 0700 without exception. An empty existing Control directory must be
0700 in either mode; a nonempty unbound directory is not an approved recovery.
An interrupted clone with missing metadata fails closed for manual recovery.

The saved G3 challenge/intent is **not** new-source authorization and must not
be reused after the source SHA or source location changes. Existing state
reads and prior approved intent are retained as historical evidence; a new
unsafe-path rejection does not overwrite either one.

## G3-RV-05 · Entire official preparation Git execution boundary

The RV-04 pure read-only Control audit is **not** sufficient authorization
for subsequent G3 Git operations. On macOS, `prepareControlEnvironment`
now performs an additional **three-checkout preflight** for the existing
Target, Sandbox and Control clone **before any private directory creation,
fetch, repository creation, sandbox seeding, configuration write or push**.
An existing checkout must have a user-owned, ordinary `.git` directory, a
bounded and readable config with exactly the expected GitHub HTTPS `origin`
(and any explicit push URL), and a provably clean HEAD/index/worktree.
Incomplete or unsupported repositories fail closed with an explicit G3 Git
extension error. This does not delete or repair historical files and never
consumes an existing `SETUP-011` claim.

For the approved macOS preparation path only, a direct HTTPS `git clone`
replaces the extra `gh repo clone` Git invocation layer. All Git children run
under a fixed no-system/no-global configuration,
without inherited `GIT_*` overrides or external Git templates. Built-in
fsmonitor, global attribute paths, signing, non-HTTPS transports, automatic
Git maintenance and Git hooks are disabled for those child processes. Only the explicitly configured
`gh auth git-credential` helper is permitted for normal authorized GitHub
HTTPS authentication; it is **not** a general-purpose extension allowance.
No repository-defined executable hooks, filters, diff/merge drivers, included
configs, external push destinations or executable attributes are admitted.
The same policy is checked again on newly cloned repositories, and
immediately before G3 staging and commit/push. An unborn **empty** checkout
is only eligible during new Sandbox/Control preparation, never as a replacement
for a nonempty or unidentified older installation. The existing macOS v1
`0755` verified-Control and v2 `0700` requirements remain unchanged.

This is a conservative safety gate. Repositories using Git LFS filters,
submodules, custom hooks, SSH transports, nonstandard includes or external
attribute transformations may be rejected pending **separate explicit**
review/authorization; the installer must not silently disable an extension
and pretend its transformed files are equivalent. Windows retains its
existing Git behavior. Runtime refresh, post-Sandbox merge and target
activation are **separate** lifecycle gates; this scoped G3 source-only
change does not grant authority to run them or claim that the Mac installer
has been executed. Exact source SHA review, official setup approval,
Runner startup, Chat registration and Sandbox-only merge still require their
respective independent gates.
