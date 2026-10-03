# Security

## Default safety model

- Task work happens on non-protected branches.
- Final merge requires human approval of an exact reviewed commit.
- Independent Code Review is read-only.
- Routine validation uses executable + argument arrays rather than arbitrary shell strings.
- A self-hosted runner is treated as privileged.
- Diagnostic upload is opt-in.
- Installation smoke tests use a sandbox, not a user's production project.

## Self-hosted runner warning

A self-hosted GitHub Actions runner can execute code on its host computer. Do not attach a privileged runner to an untrusted public control repository.

The intended public distribution model is:

```
public upstream project
        |
        | install
        v
user-owned private control environment
        |
        v
self-hosted runner
```

## Sensitive information

Diagnostics must redact or exclude by default:

- passwords;
- API keys;
- OAuth/access/refresh tokens;
- cookies and browser session data;
- ChatGPT session information;
- `.env` values;
- source-code contents;
- database contents;
- private absolute home paths where possible.

## Development isolation

This repository is a DEV environment. Production Priceup and Clean Energy repositories, runners, browser profiles, callback queues and configs must not be mutated by DEV testing.
