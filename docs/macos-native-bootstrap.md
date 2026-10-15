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
