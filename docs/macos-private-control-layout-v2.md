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

A complete, read-only path audit must precede the first preparation mutation.
The audit checks the instance root, target automation parent, Control parent
and clone, browser profile and pending-wake outbox and their ancestors. It
returns role/reason only, without printing private paths or reading payloads.
An unsafe or ambiguous path halts before any GitHub repository creation,
`setup` retry, permission repair or token handling. The already-saved G3
challenge/intent is **not** a new-source authorization and must not be reused
after the source SHA or source location changes.
