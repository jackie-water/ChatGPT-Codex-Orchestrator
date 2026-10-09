import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("release metadata is prepared for v0.1.0", async () => {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const productJson = JSON.parse(await readFile(resolve(root, "product.json"), "utf8"));

  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.private, true);
  assert.equal(productJson.version, "0.1.0");
  assert.equal(productJson.release_channel, "stable");
  assert.equal(productJson.feedback_repository, "jackie-water/ChatGPT-Codex-Orchestrator");
});

test("license text and README license links exist", async () => {
  const license = await readFile(resolve(root, "LICENSE"), "utf8");
  assert.match(license, /Copyright \(c\) 2026 JZH/);
  for (const readme of ["README.md", "README.zh-CN.md"]) {
    const text = await readFile(resolve(root, readme), "utf8");
    assert.match(text, /\]\(LICENSE\)/);
  }
});
