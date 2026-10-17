# macOS short-turn durable submit

`runtime/scripts/macos-submit.mjs` is an opt-in intake for a registered Control `CODEX-RUN` event. It validates the event with the existing macOS run planner, then durably records an instance-scoped immutable intent and `ACCEPTED` receipt before starting one detached worker.

```sh
node runtime/scripts/macos-submit.mjs \
  --event-path ./event.json \
  --control-root /path/to/control-runtime \
  --control-repository jackie-water/control-private \
  --trusted-github-username jackie
```

The command returns a stable `task_id` and private `receipt_path` immediately. Read that receipt once when status is needed; it can be `ACCEPTED`, `RUNNING`, `SUCCEEDED`, `FAILED`, or `UNKNOWN`. Re-submitting the identical authorized event returns the existing receipt and never starts another worker. Missing, partial, malformed, conflicting, symlinked, or foreign state fails closed.

The worker calls the existing `macos-dispatch.mjs`, execution ledger, post-execution finalization, checkpoint, and callback-outbox paths. `SUCCEEDED` means that dispatch/finalization returned successfully; it is not Code Review PASS and does not merge. Callback delivery remains idempotent and a callback outage cannot rerun Codex. Logs are private, bounded, and redacted.

This is intentionally not a polling service: there is no runner installation, Control workflow activation, token management, browser retry, production scheduling, or Windows integration. A worker crash or unverifiable termination is preserved as `UNKNOWN` for human/recovery handling rather than being blindly retried.
