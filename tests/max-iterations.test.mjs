import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runner = fs.readFileSync(new URL("../runtime/scripts/run-codex.ps1", import.meta.url), "utf8");
const schema = JSON.parse(fs.readFileSync(new URL("../schemas/project.schema.json", import.meta.url), "utf8"));

function effective(projectMax = 5, requested = 5, iteration = 1) {
  if (projectMax < 1 || projectMax > 20) throw new Error("project max");
  if (requested < 1 || requested > projectMax) throw new Error("requested max");
  const max = Math.min(requested, projectMax);
  if (iteration < 1 || iteration > max) throw new Error("iteration");
  return max;
}

test("product keeps default 5 and supports opt-in 10, 11, and 20", () => {
  assert.match(runner, /else \{ 5 \}/);
  assert.equal(schema.properties.max_iterations.default, 5);
  assert.equal(schema.properties.max_iterations.maximum, 20);
  for (const value of [10, 11, 20]) assert.equal(effective(value, value, value), value);
});

test("requested and iteration limits remain bounded by the project", () => {
  assert.throws(() => effective(20, 21, 1));
  assert.throws(() => effective(10, 11, 1));
  assert.throws(() => effective(20, 20, 21));
  assert.equal(effective(20, 11, 11), 11);
});
