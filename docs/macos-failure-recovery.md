# Failure recovery core

`runtime/scripts/report-run-failure.mjs` records a terminal CODEX-RUN failure even when no source commit exists:

```sh
node runtime/scripts/report-run-failure.mjs --event-path event.json --control-root /path/to/control-clone \
  --trusted-github-username jackie --stage preflight --code GIT_UNAVAILABLE
```

The event must identify an enabled project, exact active `review_route`, trusted issue author, and valid iteration. The route URL is read only from the instance/project route registry. Failure evidence, callback intent, delivery state, and Chat decision state are separate durable records. `--recover` reconstructs interrupted outbox transactions without sending. `--deliver` is opt-in and delivery is successful only after the existing sender verifies a trusted user-role receipt; uncertain states reconcile and are never blindly resent.

Error codes are stable ASCII identifiers. Raw shell text, stderr, tokens, secrets, and source-less fake SHAs are never persisted or emitted.

This P1.1 core is cross-platform state/CLI logic only. The Mac wrapper and independent watcher integration are later phases and are not operational yet.
