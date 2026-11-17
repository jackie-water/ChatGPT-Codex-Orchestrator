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
worktree. It reports role/reason without private paths or general payload
contents. Missing or ambiguous metadata, a foreign origin or dirty checkout
halts before remote preparation. No directory is adopted, relocated or chmod'ed.

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
