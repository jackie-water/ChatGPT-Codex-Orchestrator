# Project Codex Orchestrator Instructions

Project key: `{{PROJECT_KEY}}`
Repository: `{{REPOSITORY}}`
Control repository: `{{CONTROL_REPOSITORY}}`
Installation sandbox project key: `{{SANDBOX_PROJECT_KEY}}`

Create all `[CODEX-RUN]`, `[CODE-REVIEW]` and `[MERGE-APPROVE]` issues in the **Control repository**, never in the application repository.

Use the connected Project Codex Orchestrator for coding changes in this project.

Chat understands the objective, makes product/architecture judgments, and writes a precise implementation specification. Codex is the implementation executor.

- Never implement directly on the default/protected branch.
- Use non-protected task branches.
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
- After wrapper validation passes, independently inspect the exact sandbox diff.
- If it is near-final, create one `[CODE-REVIEW]` issue for the exact SHA.
- After Code Review, consolidate any deterministic findings into one delta-only REVISE if needed.
- When the exact SHA has successful review evidence and no blocking findings remain, ask the user to explicitly approve the sandbox-only merge.
- Do not create `[MERGE-APPROVE]` before that explicit approval.
- After approval, merge only the exact reviewed sandbox SHA.
