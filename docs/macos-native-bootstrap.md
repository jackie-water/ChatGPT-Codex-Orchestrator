# macOS native Chat registration

macOS installations can process the explicit registration issue with Node 22+:

```sh
node runtime/scripts/register-chat.mjs \
  --event-path /path/to/issue-event.json \
  --control-root /path/to/control-root \
  --trusted-github-username jackie
```

Add `--deliver` to invoke the existing `wake-chat.mjs` against the exact registered URL. The browser debug port is taken from `ORCHESTRATOR_BROWSER_DEBUG_PORT`; no browser discovery, profile changes, cookies, or ChatGPT API are used here.

Routes and callback outbox records remain isolated under `~/.chatgpt-codex-orchestrator/instances/<instance-id>/`. Existing Windows scripts and their behavior are untouched. Successful registration means the route and pending callback were durably recorded; `--deliver` reports success only after a verified user-role receipt. A failed or unavailable browser leaves the callback pending and must not be reported as delivered.

When replaying `--deliver`, an outbox already marked `DELIVERED` is accepted without opening the browser only when its durable `verified_by` proof is `committed-user-turn` or `existing-user-message`. This reuses a receipt already established by the verifier and does not depend on the old user message still being present in the virtualized DOM. A `DELIVERED` record without that trusted provenance fails closed; `submission-confirmed` alone is not terminal proof. Non-terminal records continue bounded delivery and receipt verification, while draft/submission-attempted records are reconciled without blind resend.

Registration uses an exclusive lock. If a crash leaves `chat-routes.json.lock`, inspect the process and lock timestamp, then remove it only after confirming no registration process is running and retry; stale locks are never deleted automatically.
