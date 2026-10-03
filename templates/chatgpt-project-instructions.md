# Project Codex Orchestrator Instructions

Project key: `{{PROJECT_KEY}}`
Repository: `{{REPOSITORY}}`

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
