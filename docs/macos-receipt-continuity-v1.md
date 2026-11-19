# G3-RECEIPT-CONTINUITY-01 · macOS source-bound, one-attempt continuity

Scope: **source-only** candidate for the separately approved G3 interrupted
installation repair. This document does not itself approve setup/resume,
register or start a Runner, register a Chat, enable a workflow, or merge.
It does **not** replace the official `AI_INSTALL.md` workflow.

## Why this gate exists

An earlier official `macos_official_fresh_preparation` receipt was issued
under a prior checked-out installer source. After `SETUP-011`, the installer
state acquired an `installation_id` and a saved `migration-intent.json`.
The historic challenge was constructed from the *pre-installation* state,
source realpath, four source-file digests, and historical directory identities.
It is not reliably reconstructible from the later state, and its mere presence
does not prove issuance-time validity. **Do not label it PASS or STALE merely
by recalculating with the post-failure state.** Retain it as historical evidence.

A new source (different exact commit/tree or source path) must not consume the
historic receipt. This phase adds `macos_receipt_continuity_approval`, a new,
explicitly human-authorized scope:

`g3-failed-setup-retry-private-control-sandbox-only-v1`

That permission means **one** new attempt at preparing the same installation's
private Control/Sandbox after a verified `SETUP-011` failure. It does not permit
reinstalling services, using an alternate Chat route, merging, changing the
real target, switching the historical Windows workflows, or repeating an
uncertain previous attempt. A source-only implementation/test authorization
is **not** this separate installation approval.

## Read-only continuity preflight (official CLI)

On an independently reviewed, clean, *committed* and separately prepared
macOS source tree, `dry-run --json` and `recovery-preflight --json` evaluate
the new gate before any setup action. This path activates only when the
existing state records a preserved historic receipt, `SETUP-011`, and an
instance-scoped migration intent, with Control not marked ready.

All of these must be true before the CLI can emit a new `NEEDS_USER_ACTION`:

1. The saved state and original receipt have the exact expected schema and
   record the preexisting setup consent, original install ID, target-disabled
   condition, no registered route, and no Runner or previously consumed
   continuity attempt. Their original bytes are not changed by preflight.
2. The existing `migration-intent.json` is a single-link, owner-only `0600`
   file beneath the canonical `0700` instance root; its installation ID,
   `PREPARED` phase, generated names, target, original source realpath and
   original full Git HEAD are consistent. Duplicate JSON keys are rejected.
   The original official-source directory and complete tracked Git tree must
   still be clean and byte-identical to its original commit.
3. The replacement official-source directory is canonical and owned; its
   complete tracked tree/index and raw file bytes match one full committed
   HEAD, with no staged, modified or untracked content, path aliases,
   executable Git extensions or symlink/hardlink identity substitution.
   It must be a *different* full commit from the original source.
4. The historical `1832f0bb` root and its selected opaque evidence **roots**
   remain private/owner-bound. No descendants are interpreted as route or
   Runner authority, and no historic file is modified or deleted.
5. The normal G3 six-role and existing-checkout checks pass using the exact
   original installation/target and the eligible v2 private Control layout.
   No partially created Control/Sandbox checkout, browser profile or outbox
   may be adopted without a separate partial-effects reconciliation.
6. A complete, authenticated **read-only** GitHub owner inventory confirms
   the same immutable owner and absence of the specific generated Control
   and Sandbox names. Missing pages, inaccessible repos, colliding names,
   owner mismatch or uncertain results return BLOCKED; 404 alone is never
   interpreted as permission to create a repository.

The accepted challenge is a SHA-256 of the complete versioned binding, which
includes the new source commit and tree, all source bytes, canonical path,
old intent hash and original source identity, installation/target, original
receipt digest, pinned Chat URL, current historical root identities, and
GitHub owner ID. Only an explicit human reply to the *exact* action and
challenge can persist the **new** receipt. No default or fallback route is
constructed. The old approval remains untouched.

## Official answer, one attempt, and interruptions

After real Mac evidence is independently adjudicated, the user may separately
authorize exactly the `macos_receipt_continuity_approval` action/challenge
returned for that reviewed source. `answer` saves a new, separately scoped
receipt through the official private-state lock and revision mechanism. The
new receipt binds the source commit, tree and full context digest. Submitting
an old challenge, a boolean, a copied receipt, a stale source, or a second
answer fails without changing state.

The next explicitly authorized official setup/resume entry rechecks all
bindings, existing local/remote effects, and the original unchanged intent.
It **reuses** `migration-intent.json` unchanged; it never regenerates it to
point at the new source or silently switches the old installation ID.
Before Control/Sandbox preparation it durably saves a unique
`macos_receipt_continuity_attempt` with source SHA, tree, binding and phase
`INTENT_RECORDED` in the original installer journal. After successful private
Control preparation it records `CONTROL_PREPARED_AWAITING_CONNECTOR`, then the
ordinary exact-repository authorization gate remains in force. The real
target remains disabled.

If preparation fails or persistence is uncertain, the attempt and the
original `SETUP-011` evidence are preserved. `UNRECONCILED_AFTER_ATTEMPT`
or any unknown attempt state blocks another automatic setup/resume; only an
independently reviewed partial-effects procedure may reconcile it. Neither
transmission failure nor a stale UI response causes a second GitHub effect.
The new source-bound receipt can never authorize Runner install/start, first
Chat registration or Sandbox merge.

## Evidence and limitations

A source-only package can establish syntax, isolated Git/JSON/identity
fixtures, fully selected affected regressions, change scope and exact frozen
Git tree. It **cannot** prove that a new Mac source checkout is prepared, that
the real saved receipt was valid when issued, that a real owner inventory is
complete, or that any official setup/resume side effect has been executed.
The historic 414 / 152 / 418 / 476 Mac cases remain attached only to their
own historic commits and trees. Future real Mac evaluation must use the
single frozen validation package and return raw TAP + sanitized inventory;
unknown facts stay UNKNOWN, not PASS.
