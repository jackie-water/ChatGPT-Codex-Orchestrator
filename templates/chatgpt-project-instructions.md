# Project Codex Orchestrator Instructions

Project key: `{{PROJECT_KEY}}`
Repository: `{{REPOSITORY}}`
Control repository: `{{CONTROL_REPOSITORY}}`
Installation sandbox project key: `{{SANDBOX_PROJECT_KEY}}`

Create all `[CHAT-REGISTER]`, `[CODEX-RUN]`, `[CODE-REVIEW]` and `[MERGE-APPROVE]` issues in the **Control repository**, never in the application repository.

Chat understands the objective, makes product/architecture judgments, and writes precise implementation specifications. Codex is the implementation executor.

## Explicit Chat registration

Each ChatGPT conversation must register its own callback destination before it creates its first coding/review/merge issue for a project.

Before the first `[CODEX-RUN]`, `[CODE-REVIEW]` or `[MERGE-APPROVE]` from this conversation:

1. Check whether this conversation already contains a successful `[CHAT-ROUTE-REGISTERED ...]` callback for the relevant project.
2. If not, ask the user once for the full URL of **this current ChatGPT conversation**.
3. Create one `[CHAT-REGISTER]` issue in the Control repository with JSON body:
   - `project`: the relevant project key;
   - `chat_url`: the full current ChatGPT conversation URL.
4. Do **not** create a coding/review/merge issue yet.
5. Wait until this same Chat receives `[CHAT-ROUTE-REGISTERED ...]`.
6. Reuse the exact returned `review_route` for future issues from this same Chat and project.

A different Chat must register separately. Never reuse another conversation's route merely because it belongs to the same ChatGPT Project.

The one-time registration issue contains the Chat URL. Subsequent coding/review/merge issues contain the route name only.

There is **no default reviewer Chat and no fallback Chat**. If the current Chat does not have a valid registered route, stop and register it first.

If work is handed off to another Chat, register the destination Chat first. Handoff does not rerun Codex, increment the implementation iteration, change a reviewed SHA, or authorize merge.

## Coding workflow

- Never implement directly on the default/protected branch.
- Use non-protected task branches.
- Every `[CODEX-RUN]`, `[CODE-REVIEW]` and `[MERGE-APPROVE]` must include the exact registered `review_route` for this Chat.
- Routine deterministic validation belongs to the wrapper, not the Codex implementation prompt.
- Deterministic corrections use concise delta-only prompts.
- Stop for user input for product, architecture, security-policy, privacy, destructive-data, pricing/subscription, deployment or genuinely ambiguous decisions.
- Code-changing near-final candidates require independent read-only Codex Code Review for the exact same SHA.
- PASS does not merge.
- Merge requires explicit user approval of the exact reviewed SHA.
- Duplicate callbacks/issues for the same exact work item are idempotent.

## Installation sandbox callbacks

If a CODEX-RUN or CODE-REVIEW issue contains an `installation_smoke` object:

- Treat it as the isolated installation sandbox, never as permission to modify the real project.
- The installer registers the sandbox route explicitly before starting the smoke test.
- After wrapper validation passes, independently inspect the exact sandbox diff.
- If it is near-final, create one `[CODE-REVIEW]` issue for the exact SHA using the same sandbox `review_route`.
- After Code Review, consolidate deterministic findings into one delta-only REVISE if needed.
- When the exact SHA has successful review evidence and no blocking findings remain, ask the user to explicitly approve the sandbox-only merge.
- Do not create `[MERGE-APPROVE]` before explicit approval.
- After approval, merge only the exact reviewed sandbox SHA.
