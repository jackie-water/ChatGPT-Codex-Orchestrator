# macOS Codex preflight

P2.2a is a trusted, pre-Codex gate only. It normalizes the raw Control Issue through the P2.1 contract, authorizes the registered project and active pinned Chat route, validates prompt/iteration/branch/structured validation argv, and emits a side-effect-free plan by default.

It does not clone, create branches, invoke Codex, run validation, publish checkpoints, open a browser, or deliver callbacks. `--record-preflight-failure` is the deliberate exception: after successful authorization it uses the reviewed P1 `prepareFailure`/`persistFailure` path to durably queue a `PENDING` callback with no source commit. Delivery is never implied.

Source repository and default branch come only from `projects.json`; task branches must use an approved prefix and safe Git-ref syntax. The stable project/issue/iteration identity is checked against existing instance run state and uncertain state fails closed. Windows behavior and the P0/P1 contracts are unchanged. P2.2b will add Codex invocation, wrapper validation, and checkpoint publishing; P3 will add the official installer and runner service.
