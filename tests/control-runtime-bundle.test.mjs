import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertSafeRuntimePath, prepareControlRuntimeFiles, writeControlRuntimeFiles } from "../src/lib/control-runtime-bundle.mjs";
import { renderWorkflow } from "../src/lib/control-render.mjs";

const sourceRoot = fs.realpathSync(fileURLToPath(new URL("../", import.meta.url)));
function temporary(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "orchestrator-runtime-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const controlRoot = path.join(root, "control");
  fs.mkdirSync(controlRoot);
  return { root, controlRoot };
}
function sourceFixture(root, controlRoot) {
  const fixture = path.join(root, "source");
  for (const file of prepareControlRuntimeFiles({ sourceRoot, controlRoot })) {
    const relative = file.path.startsWith("scripts/") ? `runtime/${file.path}` : file.path;
    const target = path.join(fixture, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, ...relative.split("/")), target);
  }
  return fixture;
}
function childEnvironment(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  return env;
}
function generate(t) {
  const fixture = temporary(t);
  fixture.files = prepareControlRuntimeFiles({ sourceRoot, controlRoot: fixture.controlRoot });
  writeControlRuntimeFiles({ controlRoot: fixture.controlRoot, files: fixture.files });
  fixture.home = path.join(fixture.root, "home");
  fs.mkdirSync(fixture.home, { mode: 0o700 });
  fs.chmodSync(fixture.home, 0o700);
  return fixture;
}

test("runtime payload contains only the explicit scripts and native dependency closure", t => {
  const { root, controlRoot } = temporary(t);
  const sourceBytes = new Map([
    ["runtime/scripts/macos-short-turn-controller.mjs", fs.readFileSync(path.join(sourceRoot, "runtime/scripts/macos-short-turn-controller.mjs"))],
    ["src/lib/macos-short-turn-autoloop.mjs", fs.readFileSync(path.join(sourceRoot, "src/lib/macos-short-turn-autoloop.mjs"))]
  ]);
  const fixtureSource = sourceFixture(root, controlRoot);
  for (const relative of ["config.ps1", "credentials.json", "sessions/private.json", "src/lib/unrelated.mjs", "runtime/scripts/private-token.json", "runtime/scripts/local-extra.mjs"]) {
    const target = path.join(fixtureSource, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "must not be packaged\n");
  }
  const files = prepareControlRuntimeFiles({ sourceRoot: fixtureSource, controlRoot });
  assert.equal(files.length, 37);
  assert.equal(files.filter(file => file.path.startsWith("src/lib/")).length, 7);
  assert.ok(files.every(file => Buffer.isBuffer(file.content) && !file.content.includes("must not be packaged")));
  assert.deepEqual(fs.readdirSync(controlRoot), []);
  writeControlRuntimeFiles({ controlRoot, files });
  assert.deepEqual(fs.readdirSync(controlRoot).sort(), ["scripts", "src"]);
  const dispatch = fs.readFileSync(path.join(controlRoot, "scripts", "macos-dispatch.mjs"), "utf8");
  assert.match(dispatch, /from "\.\.\/src\/lib\/macos-codex-run-contract\.mjs"/);
  assert.doesNotMatch(dispatch, /\.\.\/\.\.\/src\/lib\//);
  assert.match(fs.readFileSync(path.join(controlRoot, "scripts", "macos-short-turn-controller.mjs"), "utf8"), /from "\.\.\/src\/lib\/macos-short-turn-autoloop\.mjs"/);
  assert.match(fs.readFileSync(path.join(controlRoot, "src", "lib", "macos-postexecution-wrapper.mjs"), "utf8"), /from "\.\.\/\.\.\/scripts\/callback-delivery\.mjs"/);
  for (const [relative, bytes] of sourceBytes) assert.deepEqual(fs.readFileSync(path.join(sourceRoot, relative)), bytes);
  assert.equal(fs.existsSync(path.join(root, "src")), false);
});

test("staged short-turn controller registers only unsigned Chat tasks and rejects caller scope or invalid budgets", t => {
  const { controlRoot, home } = generate(t);
  const stateDir = path.join(home, "ledger");
  const instance = path.join(home, ".chatgpt-codex-orchestrator", "instances", "instance-a");
  const routeFile = path.join(instance, "chat-routes.json");
  fs.mkdirSync(instance, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(home, ".chatgpt-codex-orchestrator"), 0o700);
  fs.chmodSync(path.join(home, ".chatgpt-codex-orchestrator", "instances"), 0o700);
  fs.writeFileSync(routeFile, JSON.stringify({ routes: [{ projectKey: "orchestrator-dev", route: "chat-333", chat_url: "https://chatgpt.com/c/chat-333", status: "active" }] }), { mode: 0o600 });
  const controller = path.join(controlRoot, "scripts", "macos-short-turn-controller.mjs");
  const args = [controller, "register", "--state-dir", stateDir, "--instance-id", "instance-a", "--project", "orchestrator-dev", "--route", "chat-333", "--chat-url", "https://chatgpt.com/c/chat-333", "--task-id", "task-cli", "--iteration", "1"];
  const run = extra => spawnSync(process.execPath, [...args, ...extra], { cwd: home, env: childEnvironment(home), encoding: "utf8", timeout: 10000 });
  const accepted = run([]);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).acceptedScope, undefined);
  for (const extra of [["--trusted-scope", "{}"], ["--max-iterations", "0"], ["--max-iterations", "1.5"], ["--max-iterations", "NaN"], ["--max-iterations"]]) {
    const rejected = run(extra);
    assert.notEqual(rejected.status, 0, extra.join(" "));
    assert.match(rejected.stderr, extra[0] === "--trusted-scope" ? /UNTRUSTED_SCOPE_INPUT/ : /INVALID_BUDGET|MISSING_MAX_ITERATIONS/);
  }
  assert.equal(fs.existsSync(path.join(stateDir, "tasks", "task-cli", "state.json")), true);
  assert.equal(fs.existsSync(path.join(stateDir, "tasks", "task-cli", "journal.jsonl")), true);
});

test("generated native libraries import using only the isolated Control tree", t => {
  const { controlRoot, home, files } = generate(t);
  const libraries = files.filter(file => file.path.startsWith("src/lib/")).map(file => file.path);
  const script = `
    import assert from "node:assert/strict";
    import path from "node:path";
    import {pathToFileURL} from "node:url";
    const control = process.argv[1];
    for (const name of JSON.parse(process.argv[2])) {
      const module = await import(pathToFileURL(path.join(control, name)).href);
      assert.ok(Object.keys(module).length > 0);
    }
    const contract = await import(pathToFileURL(path.join(control, "src/lib/macos-codex-run-contract.mjs")).href);
    assert.throws(() => contract.getValidatedMacosCodexPlan({}), /plan|authorized|validated|unknown/i);
    console.log("ISOLATED_NATIVE_IMPORTS_OK");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script, controlRoot, JSON.stringify(libraries)], {
    cwd: home, env: childEnvironment(home), encoding: "utf8", timeout: 10000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ISOLATED_NATIVE_IMPORTS_OK/);
});

test("all generated ESM dependency graphs link inside the Control tree without evaluating entrypoints", t => {
  const { controlRoot, home, files } = generate(t);
  const entries = files.filter(file => file.path.endsWith(".mjs")).map(file => file.path);
  // Linking catches missing imports and missing named exports. Do not evaluate:
  // dispatch and browser entrypoints have intentional top-level side effects.
  const script = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import path from "node:path";
    import vm from "node:vm";
    const root = fs.realpathSync(process.argv[1]);
    const allowed = new Set(JSON.parse(process.argv[2]).map(name => path.join(root, name)));
    for (const entry of allowed) {
      const modules = new Map();
      const load = file => {
        assert.ok(allowed.has(file), "Unbundled module: " + file);
        assert.equal(fs.realpathSync(file), file);
        if (!modules.has(file)) modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, "utf8"), {identifier:file}));
        return modules.get(file);
      };
      await load(entry).link(async (specifier, parent) => {
        if (specifier.startsWith("node:")) {
          const builtin = await import(specifier);
          return new vm.SyntheticModule(Object.keys(builtin), function () {
            for (const name of Object.keys(builtin)) this.setExport(name, builtin[name]);
          });
        }
        assert.ok(specifier.startsWith("."), "Unexpected package dependency");
        const target = path.resolve(path.dirname(parent.identifier), specifier);
        assert.ok(target.startsWith(root + path.sep), "Import escaped the generated Control root");
        return load(target);
      });
    }
    console.log("ISOLATED_RUNTIME_LINKS_OK");
  `;
  const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "--eval", script, controlRoot, JSON.stringify(entries)], {
    cwd: home, env: childEnvironment(home), encoding: "utf8", timeout: 10000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ISOLATED_RUNTIME_LINKS_OK/);
});

test("generated native entrypoints reach argument rejection and review/merge remain closed", t => {
  const { controlRoot, home } = generate(t);
  for (const [name, message] of [
    ["macos-dispatch.mjs", /Missing --event-path/],
    ["macos-run-codex.mjs", /Required arguments are missing/],
    ["macos-execute-codex.mjs", /Missing --event-path/],
    ["macos-finalize-codex.mjs", /MACOS_FINALIZE_FAILED: FINALIZATION_REJECTED/],
    ["normalize-control-event.mjs", /Required arguments are missing/],
    ["report-run-failure.mjs", /Required arguments are missing/],
    ["register-chat.mjs", /event-path/]
  ]) {
    const result = spawnSync(process.execPath, [path.join(controlRoot, "scripts", name)], {
      cwd: home, env: childEnvironment(home), encoding: "utf8", timeout: 10000
    });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, message, name);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/, name);
  }
  for (const [name, message] of [["macos-code-review.mjs", /requires a validated event path/], ["macos-merge-approved.mjs", /refusing merge/]]) {
    const result = spawnSync(process.execPath, [path.join(controlRoot, "scripts", name)], {
      cwd: home, env: childEnvironment(home), encoding: "utf8", timeout: 10000
    });
    assert.equal(result.status, 78, name);
    assert.match(result.stderr, message);
  }
  assert.deepEqual(fs.readdirSync(home), []);
});

test("macOS workflow scopes write permission only to Code Review and persists checkout credentials", () => {
  const template = fs.readFileSync(path.join(sourceRoot, "templates", "control-repo", "orchestrator.macos.yml.template"), "utf8");
  const workflow = renderWorkflow(template, { runnerLabel: "fixture", platform: "darwin", arch: "arm64", trustedGithubUsername: "trusted" });
  assert.match(workflow, /permissions:\n  contents: read\n  issues: read/);
  assert.match(workflow, /code-review:[\s\S]*?permissions:\n      contents: write\n      issues: read[\s\S]*?persist-credentials: true/);
  const job = name => workflow.match(new RegExp(`\\n  ${name}:[\\s\\S]*?(?=\\n  [^ \\n][^:]*:|$)`))?.[0] || "";
  for (const name of ["register-chat", "run-codex", "merge-approved"]) assert.doesNotMatch(job(name), /contents: write|persist-credentials: true/);
});

test("missing or unbundled source dependencies reject before any Control writes", t => {
  const { root, controlRoot } = temporary(t);
  const fixtureSource = sourceFixture(root, controlRoot);
  const missing = path.join(fixtureSource, "src", "lib", "run-failure-state.mjs");
  const original = fs.readFileSync(missing);
  fs.unlinkSync(missing);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot: fixtureSource, controlRoot }), /ENOENT/);
  assert.deepEqual(fs.readdirSync(controlRoot), []);
  fs.writeFileSync(missing, original);
  fs.appendFileSync(path.join(fixtureSource, "runtime", "scripts", "macos-dispatch.mjs"), '\nimport "./private-unbundled.mjs";\n');
  fs.writeFileSync(path.join(fixtureSource, "runtime", "scripts", "private-unbundled.mjs"), "export {};\n");
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot: fixtureSource, controlRoot }), /Unbundled runtime dependency/);
  assert.deepEqual(fs.readdirSync(controlRoot), []);
});

test("runtime bundling rejects relative roots and source/Control overlap", t => {
  const { root, controlRoot } = temporary(t);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot: "relative", controlRoot }), /absolute/);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot, controlRoot: "relative" }), /absolute/);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot, controlRoot: sourceRoot }), /overlap/);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot, controlRoot: path.join(sourceRoot, "generated-control") }), /overlap/);
  const nestedSource = path.join(root, "nested-source");
  fs.mkdirSync(nestedSource);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot: nestedSource, controlRoot: root }), /overlap/);
  assert.deepEqual(fs.readdirSync(controlRoot), []);
});

test("dot segments cannot conceal symlink ancestors in source or Control roots", t => {
  const { root, controlRoot } = temporary(t);
  const linked = path.join(root, "linked");
  fs.symlinkSync(controlRoot, linked, "dir");
  const aliasedControl = `${linked}${path.sep}..${path.sep}control`;
  const aliasedSource = `${sourceRoot}${path.sep}..${path.sep}${path.basename(sourceRoot)}`;
  assert.throws(() => assertSafeRuntimePath(aliasedControl, { type: "directory" }), /canonical/);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot, controlRoot: aliasedControl }), /canonical/);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot: aliasedSource, controlRoot }), /canonical/);
  const files = prepareControlRuntimeFiles({ sourceRoot, controlRoot });
  assert.throws(() => writeControlRuntimeFiles({ controlRoot: aliasedControl, files }), /canonical/);
  assert.deepEqual(fs.readdirSync(controlRoot), []);
});

test("source symlinks, linked ancestors, and hard-linked source files are rejected", t => {
  const { root, controlRoot } = temporary(t);
  const fixtureSource = sourceFixture(root, controlRoot);
  const sourceFile = path.join(fixtureSource, "src", "lib", "run-failure-state.mjs");
  const parkedFile = path.join(root, "parked.mjs");
  fs.renameSync(sourceFile, parkedFile);
  fs.symlinkSync(parkedFile, sourceFile);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot: fixtureSource, controlRoot }), /Symlinked/);
  fs.unlinkSync(sourceFile);
  fs.linkSync(parkedFile, sourceFile);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot: fixtureSource, controlRoot }), /Hard-linked/);
  fs.unlinkSync(sourceFile);
  fs.copyFileSync(parkedFile, sourceFile);
  const linkedSource = path.join(root, "linked-source");
  fs.symlinkSync(fixtureSource, linkedSource, "dir");
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot: linkedSource, controlRoot }), /Symlinked/);
  assert.deepEqual(fs.readdirSync(controlRoot), []);
});

test("all destinations are checked before any write, including symlinks and wrong types", t => {
  const { root, controlRoot } = temporary(t);
  const files = prepareControlRuntimeFiles({ sourceRoot, controlRoot });
  const target = path.join(controlRoot, "src", "lib", "run-failure-state.mjs");
  fs.mkdirSync(target, { recursive: true });
  assert.throws(() => writeControlRuntimeFiles({ controlRoot, files }), /wrong type/);
  assert.equal(fs.existsSync(path.join(controlRoot, "scripts")), false);
  fs.rmdirSync(target);
  const outside = path.join(root, "outside.mjs");
  fs.writeFileSync(outside, "preserve\n");
  fs.symlinkSync(outside, target);
  assert.throws(() => prepareControlRuntimeFiles({ sourceRoot, controlRoot }), /Symlinked/);
  assert.throws(() => writeControlRuntimeFiles({ controlRoot, files }), /Symlinked/);
  assert.equal(fs.existsSync(path.join(controlRoot, "scripts")), false);
  assert.equal(fs.readFileSync(outside, "utf8"), "preserve\n");
  fs.unlinkSync(target);
  fs.linkSync(outside, target);
  assert.throws(() => writeControlRuntimeFiles({ controlRoot, files }), /Hard-linked/);
  assert.equal(fs.existsSync(path.join(controlRoot, "scripts")), false);
  fs.unlinkSync(target);
  fs.rmdirSync(path.join(controlRoot, "src", "lib"));
  fs.rmdirSync(path.join(controlRoot, "src"));
  fs.symlinkSync(root, path.join(controlRoot, "src"), "dir");
  assert.throws(() => writeControlRuntimeFiles({ controlRoot, files }), /Symlinked/);
  assert.equal(fs.existsSync(path.join(controlRoot, "scripts")), false);
});

test("invalid or incomplete payloads and non-directory ancestors are rejected without writes", t => {
  const { root, controlRoot } = temporary(t);
  const files = prepareControlRuntimeFiles({ sourceRoot, controlRoot });
  for (const invalid of [files.slice(1), [...files.slice(1), files[1]], files.map((file, i) => i ? file : { ...file, path: "../escape.mjs" })]) {
    assert.throws(() => writeControlRuntimeFiles({ controlRoot, files: invalid }), /payload/);
    assert.deepEqual(fs.readdirSync(controlRoot), []);
  }
  fs.writeFileSync(path.join(controlRoot, "src"), "not a directory\n");
  assert.throws(() => writeControlRuntimeFiles({ controlRoot, files }), /not a directory/);
  assert.equal(fs.existsSync(path.join(controlRoot, "scripts")), false);
  const linkedControl = path.join(root, "linked-control");
  fs.symlinkSync(controlRoot, linkedControl, "dir");
  assert.throws(() => writeControlRuntimeFiles({ controlRoot: linkedControl, files }), /Symlinked/);
  assert.throws(() => assertSafeRuntimePath(path.join(controlRoot, "src"), { type: "directory" }), /wrong type/);
});
