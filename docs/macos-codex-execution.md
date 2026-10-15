# macOS Codex execution lifecycle

This package implements the trusted, local macOS Codex subprocess and its crash-safe instance-scoped lifecycle. It accepts a raw GitHub Control event, authorizes it through the active registry and explicit-route-v1 Chat route, claims an O_EXCL 0600 ledger, verifies a non-symlink clone beneath the instance-private `automation` root, and runs a regular trusted local Codex executable without a shell. Failures are persisted to the existing P1 failure outbox before a terminal ledger state. Successful runs are recorded as `EXECUTED_UNVALIDATED`.

The remote default is verified as a commit with `git rev-parse --verify refs/remotes/origin/<default>^{commit}`; no `origin/HEAD` alias is trusted. The executor accepts only the exact immutable plan object returned by `planMacosCodexRun`, bounds the timeout, redacts bearer-style secrets from logs, and never pushes, publishes, or marks a run PASS.

This initial implementation deliberately does not publish a wrapper, validate source commits, create immutable checkpoints, push or merge, send success callbacks, install a Mac runner, watch instances, or perform Sandbox E2E. There is no Chat fallback. The external wrapper owns routine tests, lint, and diff review.
