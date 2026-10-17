# macOS Control runner readiness

This Phase 1 layer reports evidence; it does not install, register, start, stop, or repair a runner. `status` and `doctor` remain read-only on macOS and do not enable workflows, change routes, retry callbacks, or contact GitHub with credentials. Windows status/doctor behavior is unchanged.

The diagnosis is instance-scoped. It requires matching Control repository and instance identity, a current trusted workflow observation, a private runner directory containing a valid `.runner` configuration, a current trusted Actions runner inventory, an exact registered runner and label set, an owned and loaded LaunchAgent, an active exact route, and a readable callback outbox. A directory, PID, or non-empty `runner_path` is not proof of readiness. Missing, stale, timed-out, permission-denied, or conflicting evidence is never reported as `READY`.

Callback receipt evidence is fail-closed. A local record proves delivery only when `delivery_state` is `DELIVERED` and `verified_by` is exactly `committed-user-turn` or `existing-user-message`. `PENDING`, `DRAFT_INSERTED`, and `SUBMISSION_ATTEMPTED` remain pending; malformed, unknown, foreign-owned, unsafe, or symlinked records produce unknown evidence. A persisted `pending=false` observation cannot override a current local pending or unknown outbox. Callback messages are never printed or exposed by this layer.

Status meanings:

- `READY`: all required observations match this instance and the runner is online.
- `WORKFLOW_DISABLED`: Control's workflow is explicitly disabled; this is a Control configuration fact, not evidence that Codex failed.
- `RUNNER_NOT_CONFIGURED`: the private runner path or validated `.runner` configuration is absent or unsafe.
- `RUNNER_UNREGISTERED`: a current trusted Actions inventory explicitly proves it is empty.
- `RUNNER_OFFLINE`: the exact registered runner is known but not online.
- `CALLBACK_PENDING`: execution evidence is ready, but the instance callback outbox still has undelivered work or a durable non-final delivery state.
- `UNKNOWN`: required evidence could not be read, is unreachable/stale, or was not supplied. Missing API evidence is not treated as an empty inventory.
- `CONFLICT`: immutable identity or ownership evidence disagrees.

Recovery sequencing is deliberately evidence-first: read the persisted diagnosis and its evidence, correct the underlying human-controlled condition, then re-read current trusted read-only evidence. Persisted workflow or Actions state without an explicit current-freshness marker cannot establish `READY`. Once an implementation exists, do not rerun Codex merely to rediscover whether the runner or workflow exists. In particular, the absence of a registered/online runner prevents independent execution; repeated Desktop Commander calls are not an independent runner.

The existing Control workflow being disabled and having zero registered runners are preserved live facts in this task. This repository change does not activate either one. A reported Chat 404/SSE failure is a separate delivery/UI symptom; repository code does not claim that this status layer fixes it. Callback idempotency, Sandbox-only gates, exact-route semantics, and human merge approval remain in force.
