#!/usr/bin/env node
import fs from "node:fs";
import { planMacosCodexRun } from "../../src/lib/macos-codex-run-contract.mjs";
import { finalizeMacosCodexRun } from "../../src/lib/macos-postexecution-wrapper.mjs";

function args() {
  const out = {};
  const required = ["--event-path", "--control-root", "--control-repository", "--trusted-github-username", "--repo-path"];
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i], value = process.argv[++i];
    if (![...required, "--timeout-ms"].includes(key) || !value || value.startsWith("--") || Object.hasOwn(out, key)) throw new Error("Invalid or duplicate argument");
    out[key] = value;
  }
  if (required.some(key => !out[key])) throw new Error("Required arguments are missing");
  return out;
}
try {
  const a = args(), trusted = a["--trusted-github-username"].split(",");
  const planned = planMacosCodexRun({ event: JSON.parse(fs.readFileSync(a["--event-path"], "utf8").replace(/^\uFEFF/, "")),
    controlRoot: a["--control-root"], controlRepository: a["--control-repository"], trustedGithubUsername: trusted });
  const result = await finalizeMacosCodexRun({ planned, repoPath: a["--repo-path"], controlRoot: a["--control-root"], trustedGithubUsername: trusted,
    timeoutMs: a["--timeout-ms"] === undefined ? undefined : Number(a["--timeout-ms"]) });
  console.log(JSON.stringify(result));
  if (result.state !== "READY_FOR_REVIEW") process.exitCode = 1;
} catch (error) {
  console.error(`MACOS_FINALIZE_FAILED: ${error.code || "FINALIZATION_REJECTED"}`);
  process.exitCode = 1;
}
