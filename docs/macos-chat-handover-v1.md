# G3-CHAT-HANDOVER-01 · Expired predecessor Chat and exact successor consent

Status: **source-only design/implementation and offline tests**. No deployment,
Mac installer journal update, GitHub push, route registration, Runner operation,
Control/Sandbox preparation, or target activation is authorized by this source
change. The frozen predecessor implementation is commit
`422e20b12e851fc373daeac3c0a602223b628011` / tree
`cc0a0e2a53912be928789124237687cd2735ee8d`.

## Trigger, evidence, and identity

The original reviewer Chat is message-limit exhausted, but its exact URL is still
pinned in the `SETUP-011` installation. The original source and migration intent
are preserved; an already-approved `macos_receipt_continuity_approval` is bound
to the **predecessor** source SHA, source tree and Chat URL. Its original validity
is not reclassified. A different successor Chat cannot inherit this approval,
`review_route`, any callback, or a Control/Sandbox or Runner identity.

The updated source recognizes handover only for the **same** interrupted Mac
installation, original target, original intent, complete original
source-bound continuity approval, canonical owner-only paths and safe Git worktrees.
It requires the original `422e20b...` official source to remain independently
verifiable and the new source to be a different, clean, complete committed
SHA/tree at `~/.chatgpt-codex-orchestrator/official-source/<new-sha>`.

The official reader must verify the old receipt using the **old** source bytes
and old Chat URL before considering any successor. New source inspection is
strictly read-only and refuses untracked/staged/dirty files, git extensions,
source aliases, symlinks, hardlinks, owner/path violations, or unstable intent.
The same local six-role, empty Control/Sandbox and complete authenticated
owner-repository inventory gates remain in force. An uncertain remote response
is not proof of absence. A current successor URL is user-supplied and is not
proof that an actual Chat callback has been delivered.

A successor URL must use canonical `https://chatgpt.com/c/<chat-id>` or
`https://chatgpt.com/g/<project-id>/c/<chat-id>`; query, fragment, credentials and
alternate hosts are rejected. The successor's **chat ID must differ**; the predecessor and successor must have the identical project
prefix (including both being unscoped). Project mismatch is **BLOCKED**, not automatically accepted. All full
Chat URLs remain private in the installer state, never in public CLI JSON.

## Two separate approvals, no implied source-to-install authorization

The official **read-only** `recovery-preflight --successor-chat-url '<URL>' --json`
or `dry-run` first yields `macos_chat_handover_approval` with an exact
`macos-chat-handover-v1:<sha256>` challenge after all source/identity/side-effect
checks pass. If the successor URL was not supplied, it reports
`macos_chat_successor_url` without fabricating a route or challenge.

A user must explicitly approve the **exact** challenge and new Chat URL.
`answer --action macos_chat_handover_approval --value '<challenge>'
--successor-chat-url '<URL>' --json` uses the official state revision/lock
journal to save a separate immutable receipt. This first step does **not**
rewrite `reviewer_chat_url`, old receipt, migration intent, or any route;
`setup/resume` must remain blocked by the second gate.

After first consent, the next read-only inspection returns a new, independently
approved `macos_chat_handover_resume_approval` action with a different
`macos-chat-handover-resume-v1:<sha256>` challenge. This **second** consent
binds the first receipt, new SHA/tree, original intent digest and original
continuity authority, and means only one private Control/Sandbox preparation
attempt. It does not authorize Runner install/start, workflow activation,
Chat registration, CodeX run, merge, or target activation. The source-only
approval for this feature authorizes neither of these two actions.

Both receipts must be valid and the installer must independently re-evaluate
all read-only gates just before the separately authorized `setup/resume`.
An interrupted, recorded or unknown one-shot attempt requires independent
partial-effects reconciliation and blocks all automatic retries.

## Atomic, versioned cutover at the one-shot preparation boundary

The original `reviewer_chat_url` is preserved unchanged until both explicit
consents pass and an independently authorized single `setup/resume` begins.
Immediately before any external Control/Sandbox or GitHub effect, a single
protected installer-state write persists:

* `macos_chat_handover_applied` with source SHA/tree, predecessor and successor
  URL hashes, exact handover challenge and binding SHA;
* `reviewer_chat_url` set to the separately approved successor URL;
* `macos_receipt_continuity_attempt=INTENT_RECORDED`, unique operation ID, and
  **original immutable** `migration-intent.json` path/phase.

If journal persistence is uncertain, no Control preparation runs. If
preparation fails after the attempt journal, record
`UNRECONCILED_AFTER_ATTEMPT`, preserve every original receipt/intent/error and
refuse retry. If successful, Control remains private, uses
`explicit-route-v1`, has the original E2E Target disabled and stops at
`generated_repo_authorization`. Any subsequent Chat registration must be a
new, real registration on the verified Mac Control for this successor Chat and
project. Receipt creation is not `[CHAT-ROUTE-REGISTERED]`; no review_route is
invented, inherited, or used before actual delivery.

## Compatibility, security and evidence

Windows and existing, non-handover macOS G3 continuity paths are preserved.
This change does not use legacy XPC/CDHash/4102 as gates or adopt historical
Windows `1832f0bb` Control/Sandbox. Existing 551 Mac receipt-continuity tests
remain historical evidence for their own exact SHA. Handover uses new,
independently scoped positive/negative source-only tests and must be verified
on a real Mac before any further installation authorization.

A full callback from the successor Chat is **UNKNOWN** until its own genuine
`[CHAT-ROUTE-REGISTERED]` is received. No synthetic or default routing.
