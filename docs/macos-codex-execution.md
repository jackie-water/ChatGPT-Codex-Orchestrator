# macOS Codex execution lifecycle

This package implements the trusted, local macOS Codex subprocess and its crash-safe instance-scoped lifecycle. It accepts a raw GitHub Control event, authorizes it through the active registry and explicit-route-v1 Chat route, claims an O_EXCL 0600 ledger, verifies an isolated clone, and runs a configured local Codex executable without a shell. Failures are persisted to the existing P1 failure outbox before a terminal ledger state. Successful runs are recorded as `EXECUTED_UNVALIDATED`.

This initial implementation deliberately does not publish a wrapper, validate source commits, create immutable checkpoints, push or merge, send success callbacks, install a Mac runner, watch instances, or perform Sandbox E2E. There is no Chat fallback. The external wrapper owns routine tests, lint, and diff review.
