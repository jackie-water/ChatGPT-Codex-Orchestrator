#!/usr/bin/env node
import fs from "node:fs";
import { planMacosCodexRun } from "../../src/lib/macos-codex-run-contract.mjs";
import { executeMacosCodexRun } from "../../src/lib/macos-codex-execution.mjs";
const args = {}; for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]; if (!["--event-path","--control-root","--control-repository","--trusted-github-username","--repo-path","--codex-path","--timeout-ms"].includes(k)) throw new Error(`Unsupported argument: ${k}`); args[k.slice(2).replaceAll("-", "_")] = process.argv[++i]; }
for (const key of ["event_path","control_root","control_repository","trusted_github_username","repo_path","codex_path"]) if (!args[key]) throw new Error(`Missing --${key.replaceAll("_", "-")}`);
const trusted = args.trusted_github_username.split(",");
const event = JSON.parse(fs.readFileSync(args.event_path, "utf8"));
const planned = planMacosCodexRun({ event, controlRoot: args.control_root, controlRepository: args.control_repository, trustedGithubUsername: trusted });
const result = await executeMacosCodexRun({ planned, repoPath: args.repo_path, codexExecutable: args.codex_path, timeoutMs: args.timeout_ms ? Number(args.timeout_ms) : undefined, controlRoot: args.control_root, trustedGithubUsername: trusted });
console.log(JSON.stringify(result));
