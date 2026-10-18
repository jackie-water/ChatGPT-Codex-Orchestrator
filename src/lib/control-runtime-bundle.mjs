import fs from "node:fs";
import path from "node:path";

// This is an installation payload, never a recursive copy of the development
// tree or of an existing user's runtime directory.
const SCRIPT_NAMES = Object.freeze([
  "callback-delivery.mjs",
  "callback-receipt.mjs",
  "chat-route-registry.ps1",
  "code-review-evidence.ps1",
  "install-runner.ps1",
  "macos-code-review.mjs",
  "macos-dispatch.mjs",
  "macos-execute-codex.mjs",
  "macos-finalize-codex.mjs",
  "macos-merge-approved.mjs",
  "macos-run-codex.mjs",
  "merge-approved.ps1",
  "navigate-reviewer-chat.mjs",
  "normalize-control-event.mjs",
  "preflight.ps1",
  "publish-checkpoint.ps1",
  "publish-code-review.ps1",
  "register-chat.mjs",
  "register-chat.ps1",
  "report-run-failure.mjs",
  "retry-pending-callbacks.ps1",
  "run-code-review.ps1",
  "run-codex.ps1",
  "runtime-context.ps1",
  "setup-project-clone.ps1",
  "start-orchestrator-session.ps1",
  "start-reviewer-browser.ps1",
  "wake-chat.mjs",
  "wake-chat.ps1"
]);
const LIBRARY_NAMES = Object.freeze([
  "control-event-normalizer.mjs",
  "macos-codex-execution.mjs",
  "macos-codex-run-contract.mjs",
  "macos-postexecution-wrapper.mjs",
  "macos-code-review-runtime.mjs",
  "run-failure-state.mjs"
]);
const MANIFEST = Object.freeze([
  ...SCRIPT_NAMES.map(name => Object.freeze({ source: `runtime/scripts/${name}`, path: `scripts/${name}` })),
  ...LIBRARY_NAMES.map(name => Object.freeze({ source: `src/lib/${name}`, path: `src/lib/${name}` }))
]);
const OWNED_PATHS = new Set(MANIFEST.map(file => file.path));

export function assertSafeRuntimePath(file, { allowMissing = false, type } = {}) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("Runtime path must be absolute");
  if (type !== undefined && !["file", "directory"].includes(type)) throw new Error("Invalid runtime path type");
  const absolute = path.resolve(file);
  if (file !== absolute) throw new Error("Runtime path must be canonical without dot segments or aliases");
  let current = path.parse(absolute).root;
  const parts = absolute.slice(current.length).split(path.sep).filter(Boolean);
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i]);
    let st;
    try { st = fs.lstatSync(current); }
    catch (error) {
      if (allowMissing && error.code === "ENOENT") return absolute;
      throw error;
    }
    if (st.isSymbolicLink()) throw new Error(`Symlinked runtime path is forbidden: ${current}`);
    const leaf = i === parts.length - 1;
    if (!leaf && !st.isDirectory()) throw new Error(`Runtime path ancestor is not a directory: ${current}`);
    if (st.isFile() && st.nlink !== 1) throw new Error(`Hard-linked runtime file is forbidden: ${current}`);
    if (leaf && ((type === "file" && !st.isFile()) || (type === "directory" && !st.isDirectory())
      || (!st.isFile() && !st.isDirectory()))) throw new Error(`Runtime path has the wrong type: ${current}`);
  }
  return absolute;
}

function targetPath(controlRoot, relative) {
  if (!OWNED_PATHS.has(relative)) throw new Error("Runtime payload contains an unowned or invalid path");
  return assertSafeRuntimePath(path.join(controlRoot, ...relative.split("/")), { allowMissing: true, type: "file" });
}

function preparedFiles(files) {
  if (!Array.isArray(files) || files.length !== MANIFEST.length) throw new Error("Runtime payload is incomplete");
  const seen = new Set();
  return files.map(file => {
    if (!file || !OWNED_PATHS.has(file.path) || seen.has(file.path)) throw new Error("Runtime payload contains an unowned, duplicate, or invalid path");
    if (typeof file.content !== "string" && !Buffer.isBuffer(file.content)) throw new Error("Runtime payload content must be text or a Buffer");
    seen.add(file.path);
    return { path: file.path, content: Buffer.from(file.content) };
  });
}

function validateImports(files) {
  for (const file of files.filter(file => file.path.endsWith(".mjs"))) {
    const text = file.content.toString("utf8");
    if (/\bimport\s*\(/.test(text) || /\brequire\s*\(/.test(text)) throw new Error(`Unsupported runtime dependency syntax: ${file.path}`);
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*)(["'])([^"']+)\1/g)) {
      const specifier = match[2];
      if (specifier.startsWith("node:")) continue;
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier));
      if (!specifier.startsWith(".") || !OWNED_PATHS.has(dependency)) throw new Error(`Unbundled runtime dependency in ${file.path}: ${specifier}`);
    }
  }
}

function readSource(file) {
  assertSafeRuntimePath(file, { type: "file" });
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw new Error("Runtime source must be a regular file without hard links");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function prepareControlRuntimeFiles({ sourceRoot, controlRoot }) {
  const source = assertSafeRuntimePath(sourceRoot, { type: "directory" });
  const control = assertSafeRuntimePath(controlRoot, { allowMissing: true, type: "directory" });
  const contains = (base, candidate) => {
    const relative = path.relative(base, candidate);
    return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
  };
  if (contains(source, control) || contains(control, source)) throw new Error("Runtime source and Control roots must not overlap");
  // Validate every source and destination before reading the payload. The
  // caller can finish all other validation before performing any writes.
  const plan = MANIFEST.map(file => ({ ...file,
    sourcePath: assertSafeRuntimePath(path.join(source, ...file.source.split("/")), { type: "file" }),
    targetPath: targetPath(control, file.path)
  }));
  const files = plan.map(file => {
    let content = readSource(file.sourcePath);
    if (file.path.startsWith("scripts/") && file.path.endsWith(".mjs")) {
      content = Buffer.from(content.toString("utf8").replace(/(["'])\.\.\/\.\.\/src\/lib\//g, "$1../src/lib/"));
    }
    if (file.path === "src/lib/macos-postexecution-wrapper.mjs") {
      content = Buffer.from(content.toString("utf8").replaceAll("../../runtime/scripts/callback-delivery.mjs", "../../scripts/callback-delivery.mjs"));
    }
    return { path: file.path, content };
  });
  validateImports(files);
  return files;
}

export function writeControlRuntimeFiles({ controlRoot, files }) {
  const control = assertSafeRuntimePath(controlRoot, { allowMissing: true, type: "directory" });
  const payload = preparedFiles(files);
  validateImports(payload);
  // Do the full second preflight before mkdir or opening any destination.
  const plan = payload.map(file => ({ ...file, targetPath: targetPath(control, file.path) }));
  for (const file of plan) {
    fs.mkdirSync(path.dirname(file.targetPath), { recursive: true });
    assertSafeRuntimePath(path.dirname(file.targetPath), { type: "directory" });
    assertSafeRuntimePath(file.targetPath, { allowMissing: true, type: "file" });
    const fd = fs.openSync(file.targetPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0), 0o644);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1) throw new Error("Runtime target must be a regular file without hard links");
      fs.ftruncateSync(fd, 0);
      fs.writeFileSync(fd, file.content);
    } finally { fs.closeSync(fd); }
  }
}
