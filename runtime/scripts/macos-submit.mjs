#!/usr/bin/env node
import fs from "node:fs";
import { submitMacosDurableIntent } from "../../src/lib/macos-durable-intake.mjs";

function parseArgs() {
  const out = {}; const allowed = new Set(["event-path", "control-root", "control-repository", "trusted-github-username", "timeout-ms"]);
  for (let i = 2; i < process.argv.length; i++) { const k = process.argv[i]?.replace(/^--/, ""); if (!allowed.has(k) || out[k]) throw new Error("Invalid or duplicate argument"); const v = process.argv[++i]; if (!v || v.startsWith("--")) throw new Error("Missing argument value"); out[k] = v; }
  for (const k of ["event-path", "control-root", "control-repository", "trusted-github-username"]) if (!out[k]) throw new Error(`Missing --${k}`);
  return out;
}
try {
  const a = parseArgs(); const result = submitMacosDurableIntent({ event: JSON.parse(fs.readFileSync(a["event-path"], "utf8").replace(/^\uFEFF/, "")),
    controlRoot: a["control-root"], controlRepository: a["control-repository"], trustedGithubUsername: a["trusted-github-username"].split(","),
    timeoutMs: a["timeout-ms"] === undefined ? undefined : Number(a["timeout-ms"]) });
  console.log(JSON.stringify(result));
} catch (error) { console.error(`MACOS_DURABLE_SUBMIT_FAILED: ${error.code || "REJECTED"}`); process.exitCode = 1; }
