# ChatGPT Codex Orchestrator

[English](README.md) | [简体中文](README.zh-CN.md)

> **Development preview — not ready for production use yet.**

ChatGPT Codex Orchestrator helps turn a ChatGPT conversation into a safer coding workflow. You describe what you want. ChatGPT plans the change. Codex works on a separate branch. Automated checks verify the result. An independent review can look for technical problems. Your main branch is not changed unless you explicitly approve the exact reviewed version.

## Who this is for

This project is designed for people who can use ChatGPT but may **not be developers**. You should not need to edit JSON, PowerShell, Git branches, runner settings or configuration files by hand.

The preferred setup experience is:

1. Give this GitHub link to an AI that can work with your computer.
2. Say: **"Install this for me."**
3. The AI uses the official installer.
4. Anything that can be automated is automated.
5. When you must personally sign in or approve access, setup stops and gives you **one step only**.
6. You complete that step and reply.
7. The AI verifies it and continues.

Windows users will also be able to double-click **Install.cmd**.

## Before you start

You will eventually need:

- A Windows computer for v0.1.
- A GitHub account.
- A ChatGPT account with Codex access.
- A GitHub repository you want ChatGPT/Codex to work on.
- Permission to approve GitHub and Codex sign-in when setup asks.

You do **not** need to manually install Git, Node.js or Codex first. The installer is designed to check and install supported prerequisites.

## Install with AI

Give the AI this repository link and say:

> Install this for me. Use the repository's AI installation protocol. Ask me for only one manual action at a time.

The AI should read [AI_INSTALL.md](AI_INSTALL.md) and use the official installer rather than inventing its own installation commands.

## Install by yourself on Windows

Double-click **Install.cmd**.

The setup assistant will guide you. Advanced terminal knowledge should not be required.

## How you will use it after setup

Work normally in your ChatGPT Project. For example:

> Add a page that lets users export their report as CSV.

The orchestrator handles the technical workflow behind the scenes: implementation branch, validation, review, correction loops, callbacks and exact-version merge approval.

## Safe Mode

Safe Mode is on by default:

- Codex does not work directly on your main branch.
- Codex does not merge by itself.
- Force-push is not part of the normal workflow.
- Code Review is read-only.
- Routine validation uses structured commands rather than arbitrary shell strings.
- A final merge requires explicit human approval of the exact reviewed commit.

## Common problem: the message is visible in ChatGPT but was not sent

This can occasionally happen when ChatGPT is still finishing another response.

If the waiting message starts with something like:

`[CODEX-AUTO callback_id=...]`

you can safely press **Send** yourself. The callback ID lets the workflow recognise the same delivery and avoid intentionally starting duplicate work.

Do **not** rerun Codex just because the callback message is waiting in the input box.

If it happens repeatedly, use the repair flow. Repair should retry pending callbacks before asking you to rerun any coding task.

## Check whether everything is working

Doctor/Status is intended to show simple results such as:

```
Overall status: HEALTHY

Git                    ✓
Codex                  ✓
GitHub                 ✓
Automation runner      ✓
Chat callback          ✓
Pending messages       0
```

Technical details stay hidden unless you ask for them.

## Report a problem

If repair fails, the project can prepare a **sanitised diagnostic report**.

Nothing is uploaded automatically. You can review the report and decide whether to submit it.

Passwords, access tokens, API keys, cookies, ChatGPT sessions, `.env` values and project source code must not be included by default.

## Current development status

v0.1 is being built and tested in a separate development/sandbox environment. Existing production orchestrators are not used as the test environment.

See [AI_INSTALL.md](AI_INSTALL.md), [SECURITY.md](SECURITY.md), and [the v0.1 roadmap](docs/ROADMAP-v0.1.md).
