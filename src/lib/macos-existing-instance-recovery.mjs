import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { canonicalInstallationId, defaultLocalPaths } from "./control-render.mjs";
import { verifyMacosGeneratedRepositoryIdentity, verifyTrustedRecoveryEvidence } from "./macos-trusted-recovery-evidence.mjs";
import { inspectMacosRunnerPackageLeaves } from "./macos-runner-bootstrap.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PRIVATE_MODES = new Set([0o600, 0o700]);
const INSTANCE_ROOT_NAME = ".chatgpt-codex-orchestrator";
const MAX_TREE_ENTRIES = 4096;
const MAX_TREE_DEPTH = 64;
const MAX_TREE_BASENAME_LENGTH = 255;
const RUNTIME_BROWSER_PROFILE_SINGLETONS = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie"]);

function uidAllowed(stat) {
  return typeof process.getuid !== "function" || stat.uid === process.getuid() || stat.uid === 0;
}

function privateMode(stat, directory) {
  const mode = stat.mode & 0o777;
  return directory ? mode === 0o700 : PRIVATE_MODES.has(mode);
}

function ancestorModeAllowed(stat) {
  return (stat.mode & 0o022) === 0 || (stat.uid === 0 && (stat.mode & 0o1000) !== 0);
}

function safeName(value) {
  return typeof value === "string" && ID.test(value) && value !== "." && value !== "..";
}

function safeTreeBasename(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_TREE_BASENAME_LENGTH
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && /^[A-Za-z0-9._ -]+$/.test(value);
}

function lstat(fsImpl, file) {
  try { return { ok: true, stat: fsImpl.lstatSync(file) }; }
  catch (error) { return { ok: false, missing: error?.code === "ENOENT", error }; }
}

function safeDirectory(fsImpl, file, { privateDirectory = true } = {}) {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const result = lstat(fsImpl, current);
    if (!result.ok) return result.missing ? { ok: false, missing: true, path: current } : { ok: false, reason: "unreadable", path: current };
    const stat = result.stat;
    if (stat.isSymbolicLink()) return { ok: false, reason: "symlink", path: current };
    if (!stat.isDirectory() || !uidAllowed(stat)) return { ok: false, reason: "unsafe-ancestor", path: current };
    if (current !== absolute && !ancestorModeAllowed(stat)) return { ok: false, reason: "writable-ancestor", path: current };
    if (current === absolute && privateDirectory && !privateMode(stat, true)) return { ok: false, reason: "odd-directory-mode", path: current };
    if (current === absolute && !privateDirectory && !ancestorModeAllowed(stat)) return { ok: false, reason: "writable-directory", path: current };
  }
  return { ok: true, path: absolute };
}

function safeFile(fsImpl, file) {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let parent = root;
  for (const part of path.dirname(absolute).slice(root.length).split(path.sep).filter(Boolean)) {
    parent = path.join(parent, part);
    const ancestor = lstat(fsImpl, parent);
    if (!ancestor.ok || ancestor.stat.isSymbolicLink() || !ancestor.stat.isDirectory() || !uidAllowed(ancestor.stat) || !ancestorModeAllowed(ancestor.stat)) return { ok: false, reason: "unsafe-ancestor" };
  }
  const result = lstat(fsImpl, file);
  if (!result.ok) return result.missing ? { ok: false, missing: true } : { ok: false, reason: "unreadable" };
  const stat = result.stat;
  if (stat.isSymbolicLink()) return { ok: false, reason: "symlink" };
  if (!stat.isFile() || stat.nlink !== 1 || !uidAllowed(stat) || !privateMode(stat, false)) return { ok: false, reason: "unsafe-file" };
  return { ok: true };
}

function isOpaqueRuntimeBrowserProfileSingleton(relative, stat) {
  // Chromium owns these three links at the profile root while it is live. They
  // are inert tree leaves here: never read, resolve, stat, or enumerate a target,
  // and never use their contents as browser identity, PID, or listener evidence.
  return path.dirname(relative) === "browser-profile"
    && RUNTIME_BROWSER_PROFILE_SINGLETONS.has(path.basename(relative))
    && stat.nlink === 1
    && (typeof process.getuid !== "function" || stat.uid === process.getuid());
}

function samePackageLeaf(stat, identity) {
  return identity && ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"].every(key => stat[key] === identity[key]);
}

function verifiedRunnerPackageLeaf(relative, stat, packageLeaves) {
  if (!relative.startsWith(`runner${path.sep}`)) return false;
  const name = relative.slice("runner".length + 1).split(path.sep).join("/");
  const leaf = packageLeaves?.leaves.get(name);
  if (!leaf || !samePackageLeaf(stat, leaf.identity) || stat.nlink !== 1 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) return false;
  // The package inspector binds links to exact archive entries. They remain
  // opaque leaves here; never read, resolve, enumerate, or trust their targets.
  if (leaf.kind === "link") return stat.isSymbolicLink();
  return leaf.kind === "generated" && name === "svc.sh" && stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o7777) === 0o755;
}

function safeInstanceTree(fsImpl, root, { strictOwner = false, selectedRunnerWork = false, selectedRuntimeBrowserProfileSingletons = false, selectedRunnerPackage = null, selectedRunnerEnvironment = false } = {}) {
  const pending = [{ file: path.resolve(root), depth: 0 }];
  // The separately bounded archive inventory may exceed the unrelated instance
  // data budget; only its already verified names acquire this selected allowance.
  let visited = 0, packageVisited = 0;
  while (pending.length) {
    const { file, depth } = pending.pop();
    const relative = path.relative(path.resolve(root), file);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { ok: false, reason: "traversal" };
    const result = lstat(fsImpl, file);
    if (!result.ok) return { ok: false, reason: result.missing ? "traversal" : "unreadable" };
    const stat = result.stat;
    const packageLeaf = verifiedRunnerPackageLeaf(relative, stat, selectedRunnerPackage);
    if (stat.isSymbolicLink()) {
      if (packageLeaf) continue;
      if (selectedRuntimeBrowserProfileSingletons && isOpaqueRuntimeBrowserProfileSingleton(relative, stat)) continue;
      return { ok: false, reason: "symlink" };
    }
    if (!uidAllowed(stat) || (strictOwner && typeof process.getuid === "function" && stat.uid !== process.getuid())) return { ok: false, reason: "unsafe-owner" };
    const runnerWork = path.join("runner", "_work");
    const passive = relative === "" || relative === ".git" || relative.startsWith(`.git${path.sep}`) || relative === "browser-profile" || relative.startsWith(`browser-profile${path.sep}`) || relative === "automation" || relative.startsWith(`automation${path.sep}`) || relative === "logs" || relative.startsWith(`logs${path.sep}`) || (selectedRunnerWork && (relative === runnerWork || relative.startsWith(`${runnerWork}${path.sep}`)));
    if (stat.isDirectory()) {
      if (!passive && !privateMode(stat, true)) return { ok: false, reason: "odd-directory-mode" };
      if (passive && !ancestorModeAllowed(stat)) return { ok: false, reason: "unsafe-passive-directory" };
      if (depth >= MAX_TREE_DEPTH) return { ok: false, reason: "tree-bound" };
      let entries;
      try { entries = fsImpl.readdirSync(file, { withFileTypes: true }); }
      catch { return { ok: false, reason: "traversal" }; }
      for (const entry of entries) {
        const child = path.join(file, entry.name);
        const childRelative = path.relative(path.resolve(root), child);
        const packageName = childRelative.startsWith(`runner${path.sep}`) && selectedRunnerPackage?.names.has(childRelative.slice("runner".length + 1).split(path.sep).join("/"));
        if (packageName) packageVisited++; else visited++;
        if (visited > MAX_TREE_ENTRIES || packageVisited > (selectedRunnerPackage?.names.size || 0)) return { ok: false, reason: "tree-bound" };
        if ((!safeTreeBasename(entry.name) && !packageName) || childRelative.startsWith(`..${path.sep}`) || path.isAbsolute(childRelative)) return { ok: false, reason: "traversal" };
        pending.push({ file: child, depth: depth + 1 });
      }
    } else if (!stat.isFile() || stat.nlink !== 1 || (!passive && !privateMode(stat, false) && !packageLeaf &&
        !(selectedRunnerEnvironment && relative === path.join("runner", ".env") && (stat.mode & 0o7777) === 0o400)) || (passive && !ancestorModeAllowed(stat))) {
      return { ok: false, reason: stat.isSymbolicLink() ? "symlink" : "unsafe-leaf" };
    }
  }
  return { ok: true };
}

function safeLegacyFreshTree(fsImpl, root) {
  const pending = [{ file: path.resolve(root), depth: 0 }]; let visited = 0;
  while (pending.length) {
    const { file, depth } = pending.pop(), result = lstat(fsImpl, file);
    if (!result.ok || result.stat.isSymbolicLink() || !uidAllowed(result.stat)) return false;
    const relative = path.relative(path.resolve(root), file);
    if (relative && !relative.split(path.sep).every(safeTreeBasename)) return false;
    if (result.stat.isDirectory()) {
      if (!ancestorModeAllowed(result.stat) || depth >= MAX_TREE_DEPTH || ++visited > MAX_TREE_ENTRIES) return false;
      let entries; try { entries = fsImpl.readdirSync(file, { withFileTypes: true }); } catch { return false; }
      for (const entry of entries) {
        if (!safeTreeBasename(entry.name)) return false;
        pending.push({ file: path.join(file, entry.name), depth: depth + 1 });
      }
    } else if (!result.stat.isFile() || result.stat.nlink !== 1 || (result.stat.mode & 0o022) !== 0 || ![0o600, 0o644].includes(result.stat.mode & 0o777)) return false;
  }
  return true;
}

function readJson(fsImpl, file) {
  const safe = safeFile(fsImpl, file);
  if (!safe.ok) return safe.missing ? { present: false } : { present: true, valid: false, reason: safe.reason };
  try {
    const value = JSON.parse(fsImpl.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? { present: true, valid: true, value } : { present: true, valid: false, reason: "malformed-json" };
  } catch { return { present: true, valid: false, reason: "malformed-json" }; }
}

function routeNames(value) {
  const routes = Array.isArray(value?.routes) ? value.routes : value?.routes && typeof value.routes === "object" ? Object.entries(value.routes).map(([route, item]) => ({ route, ...item })) : [];
  return routes.map(item => item?.route).filter(safeName).sort();
}

function routeBindings(value) {
  const routes = Array.isArray(value?.routes) ? value.routes : value?.routes && typeof value.routes === "object" ? Object.entries(value.routes).map(([route, item]) => ({ route, ...item })) : [];
  const identity = declaredIdentity(value);
  return routes
    .filter(item => safeName(item?.route))
    .map(item => ({
      route: item.route,
      status: item.status,
      project: item.project,
      ...Object.fromEntries(IDENTITY_FIELDS
        .filter(key => Object.hasOwn(item, key) || Object.hasOwn(identity, key))
        .map(key => [key, Object.hasOwn(item, key) ? item[key] : identity[key]]))
    }));
}

const IDENTITY_FIELDS = ["instance_id", "installation_id", "control_repository", "sandbox_repository"];

function declaredIdentity(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(IDENTITY_FIELDS.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
    : {};
}

function snapshotNames(fsImpl, instanceRoot, entries) {
  const names = [];
  for (const entry of entries.filter(name => name.startsWith("control-routing-migration-"))) {
    const directory = safeDirectory(fsImpl, path.join(instanceRoot, entry), { privateDirectory: true });
    if (!directory.ok) { names.push(`${entry}:INVALID`); continue; }
    const file = path.join(instanceRoot, entry, "instance.json");
    const result = readJson(fsImpl, file);
    if (result.present && result.valid) names.push(entry);
    else if (result.present) names.push(`${entry}:INVALID`);
  }
  return names.sort();
}

function candidate(fsImpl, instancesRoot, id) {
  const root = path.join(instancesRoot, id);
  let entries;
  try { entries = fsImpl.readdirSync(root, { withFileTypes: true }).map(entry => entry.name).sort(); }
  catch { return { instance_id: id, status: "CONFLICT", missing_verification_gates: ["enumerable_instance"] }; }
  const tree = safeInstanceTree(fsImpl, root);
  if (!tree.ok) return { instance_id: id, status: "CONFLICT", missing_verification_gates: ["safe_instance_tree"] };
  const routeFile = readJson(fsImpl, path.join(root, "chat-routes.json"));
  const routeNamesFound = routeFile.valid ? routeNames(routeFile.value) : [];
  const routeRecords = routeFile.valid ? (Array.isArray(routeFile.value.routes) ? routeFile.value.routes : Object.entries(routeFile.value.routes || {}).map(([route, item]) => ({ route, ...item }))) : [];
  const snapshots = snapshotNames(fsImpl, root, entries);
  const reasons = [];
  if (routeFile.present && !routeFile.valid) reasons.push("valid_chat_routes_json");
  if (snapshots.some(name => name.endsWith(":INVALID"))) reasons.push("valid_migration_snapshot");
  if (!routeFile.present) reasons.push("chat_routes_metadata");
  if (!snapshots.length) reasons.push("migration_snapshot_metadata");
  if (!routeRecords.some(route => safeName(route?.route) && route?.status === "active" && safeName(route?.project))) reasons.push("registered_route_evidence");
  const instanceMetadata = readJson(fsImpl, path.join(root, "instance.json"));
  if (instanceMetadata.present && !instanceMetadata.valid) reasons.push("valid_instance_metadata");
  const identityRecords = [instanceMetadata.valid ? instanceMetadata.value : null].filter(Boolean);
  const routeIdentity = routeFile.valid ? declaredIdentity(routeFile.value) : {};
  if (Object.keys(routeIdentity).length) identityRecords.push(routeIdentity);
  for (const name of entries.filter(item => item.startsWith("control-routing-migration-") && !item.endsWith(":INVALID"))) {
    const snapshot = readJson(fsImpl, path.join(root, name, "instance.json"));
    if (snapshot.valid) identityRecords.push(snapshot.value);
  }
  const instanceIds = identityRecords.map(value => value.instance_id).filter(value => value !== undefined);
  const installationIds = identityRecords.map(value => value.installation_id).filter(value => value !== undefined);
  const controlRepositories = identityRecords.map(value => value.control_repository).filter(value => value !== undefined);
  const sandboxRepositories = identityRecords.map(value => value.sandbox_repository).filter(value => value !== undefined);
  const requiredIdentity = IDENTITY_FIELDS;
  if (!instanceMetadata.valid || identityRecords.some(value => requiredIdentity.some(key => typeof value[key] !== "string" || !value[key]))) reasons.push("verified_role_identities");
  const activeRoutes = routeRecords.filter(route => route?.status === "active");
  const validActiveRoutes = activeRoutes.filter(route => safeName(route?.route) && safeName(route?.project) && typeof route?.installation_id === "string");
  if (!validActiveRoutes.length || validActiveRoutes.length !== activeRoutes.length || new Set(validActiveRoutes.map(route => route.route)).size !== validActiveRoutes.length) reasons.push("registered_route_identity");
  const routeIdentifiers = routeRecords.map(route => route?.route).filter(safeName);
  const duplicateRouteIdentifiers = new Set(routeIdentifiers).size !== routeIdentifiers.length;
  if (duplicateRouteIdentifiers) reasons.push("unique_route_identifiers");
  const routeIdentityMismatch = routeRecords.some(route => IDENTITY_FIELDS.some(key => Object.hasOwn(route || {}, key) && (typeof route[key] !== "string" || !identityRecords.every(value => value[key] === undefined || value[key] === route[key]))));
  if (routeIdentityMismatch || validActiveRoutes.some(route => route.installation_id !== installationIds[0])) reasons.push("matching_route_identity");
  const mismatched = (instanceMetadata.valid && instanceMetadata.value.instance_id !== undefined && instanceMetadata.value.instance_id !== id)
    || instanceIds.some(value => value !== id || value !== instanceIds[0])
    || new Set(installationIds).size > 1
    || new Set(controlRepositories).size > 1
    || new Set(sandboxRepositories).size > 1
    || new Set(instanceIds).size > 1
    || new Set(installationIds).size > 1;
  if (mismatched) reasons.push("matching_instance_identifier");
  const conflict = (routeFile.present && !routeFile.valid) || snapshots.some(name => name.endsWith(":INVALID")) || (instanceMetadata.present && !instanceMetadata.valid) || mismatched || routeIdentityMismatch || duplicateRouteIdentifiers;
  const identity = { instance_id: instanceIds[0] || null, installation_id: installationIds[0] || null, control_repository: controlRepositories[0] || null, sandbox_repository: sandboxRepositories[0] || null };
  return { instance_id: id, status: conflict ? "CONFLICT" : "NEEDS_VERIFICATION", metadata: { chat_routes: routeFile.present, migration_snapshots: snapshots.length > 0, instance: instanceMetadata.present }, identity, route_names: routeNamesFound, route_bindings: routeFile.valid ? routeBindings(routeFile.value) : [], missing_verification_gates: [...new Set(reasons)].sort(), ...(conflict ? {} : { clues_unverified: true }) };
}

const LEGACY_ID = "1832f0bb";
const LEGACY_AUDIT = Object.freeze({ schema_version: 1, classification: "OPAQUE_PRESERVED_NONAUTHORITY", instance_id: LEGACY_ID, diagnostics_subtree: "short-turn-evidence", historical_instances_are_authority: false, descendants_inspected: false, runtime_activity_verified: false });
const legacyIntent = state => state.macos_setup_approved === true && state.fresh_first_install_bootstrap === true && state.fresh_first_install_legacy_instance_id === LEGACY_ID;
const validRepositoryId = value => (typeof value === "number" && Number.isSafeInteger(value) && value > 0) || (typeof value === "string" && /^[1-9]\d*$/.test(value));
const legacyInitialAbsentFields = ["installation_id", "instance_id", "instance_root", "control_repository", "sandbox_repository", "control_repository_id", "sandbox_repository_id", "control_clone_path", "sandbox_clone_path", "sandbox_project_key", "chat_route_file", "sandbox_review_route", "review_route", "sandbox_chat_registration_issue"];
const isAbsentLegacyField = value => value === undefined || value === null || value === "";
class LegacyPolicyError extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const legacyIdentityKeys = ["instance_id", "installation_id", "control_repository", "sandbox_repository", "control_repository_id", "sandbox_repository_id"];
const sameStat = (a, b) => ["dev", "ino", "uid", "gid", "mode", "mtimeMs", "ctimeMs"].every(key => a[key] === b[key]);

// Parse once with JSON.parse, but separately walk the JSON grammar to reject
// duplicate object keys, including differently escaped spellings.
function noDuplicateJsonKeys(text) {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] || "") && i < text.length) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error("unterminated string");
  }
  function value() {
    ws();
    if (text[i] === '"') { string(); return; }
    if (text[i] === "{") {
      i++; ws(); const keys = new Set();
      if (text[i] === "}") { i++; return; }
      while (true) {
        ws(); if (text[i] !== '"') throw new Error("object key");
        const key = string(); if (keys.has(key)) throw new Error("duplicate key"); keys.add(key);
        ws(); if (text[i++] !== ":") throw new LegacyPolicyError("colon"); value(); ws();
        const separator = text[i++]; if (separator === "}") return; if (separator !== ",") throw new LegacyPolicyError("separator");
      }
    }
    if (text[i] === "[") {
      i++; ws(); if (text[i] === "]") { i++; return; }
      while (true) { value(); ws(); const separator = text[i++]; if (separator === "]") return; if (separator !== ",") throw new LegacyPolicyError("separator"); }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!match) throw new LegacyPolicyError("value"); i += match[0].length;
  }
  value(); ws(); if (i !== text.length) throw new Error("trailing data");
}

function legacyJson(fsImpl, file) {
  const before = lstat(fsImpl, file);
  if (!before.ok || before.stat.isSymbolicLink() || !before.stat.isFile() || !strictOwner(before.stat) || before.stat.nlink !== 1 || (before.stat.mode & 0o7777) !== 0o600 || before.stat.size > 1024 * 1024) throw new LegacyPolicyError("metadata_integrity");
  let fd;
  try {
    fd = fsImpl.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fsImpl.fstatSync(fd);
    if (!sameStat(before.stat, opened) || opened.size !== before.stat.size || opened.nlink !== 1) throw new LegacyPolicyError("metadata_drift");
    const buffer = Buffer.alloc(1024 * 1024 + 1); let length = 0;
    while (length < buffer.length) { const count = fsImpl.readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    if (length !== opened.size || length > 1024 * 1024) throw new LegacyPolicyError("metadata_size");
    const data = buffer.subarray(0, length);
    const finalOpened = fsImpl.fstatSync(fd);
    if (!sameStat(opened, finalOpened) || finalOpened.size !== opened.size || finalOpened.nlink !== 1 || !strictOwner(finalOpened) || (finalOpened.mode & 0o7777) !== 0o600) throw new LegacyPolicyError("metadata_drift");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    noDuplicateJsonKeys(text);
    const result = JSON.parse(text);
    const after = fsImpl.lstatSync(file);
    if (!sameStat(opened, after) || after.size !== opened.size || after.nlink !== 1) throw new LegacyPolicyError("metadata_drift");
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new LegacyPolicyError("metadata_shape");
    return result;
  } finally { if (fd !== undefined) fsImpl.closeSync(fd); }
}

function classifyLegacyIsolation({ fsImpl, home, instancesRoot, entries, state }) {
  const audit = (classification, reason) => ({ ...LEGACY_AUDIT, classification, reason });
  const reject = reason => ({ status: "CONFLICT", mutations_performed: false, instances_root_present: true, instance_ids: entries.filter(safeName), instances: [{ instance_id: LEGACY_ID, status: "CONFLICT", missing_verification_gates: ["safe_instance_tree"], fresh_first_install_candidate: false, legacy_evidence_isolation: audit("REJECTED", reason) }], fresh_first_install_candidate: false, missing_verification_gates: ["safe_instance_tree"], legacy_evidence_isolation: audit("REJECTED", reason) });
  try {
    if (home !== path.resolve(home) || fsImpl.realpathSync(home) !== home) throw new LegacyPolicyError("noncanonical_home");
    const roots = [path.join(home, INSTANCE_ROOT_NAME), instancesRoot, path.join(instancesRoot, LEGACY_ID)];
    for (const root of roots) {
      const check = safeDirectory(fsImpl, root), stat = lstat(fsImpl, root);
      if (!check.ok || !stat.ok || !strictOwner(stat.stat) || (stat.stat.mode & 0o7777) !== 0o700 || fsImpl.realpathSync(root) !== root) throw new LegacyPolicyError("private_root");
    }
    const initial = legacyInitialAbsentFields.every(key => isAbsentLegacyField(state[key]));
    if (entries.some(name => !safeName(name)) || new Set(entries.map(name => name.toLowerCase())).size !== entries.length || !entries.includes(LEGACY_ID)) throw new LegacyPolicyError("instance_set");
    if (initial) {
      if (entries.length !== 1 || state.control_environment_ready === true || state.target_environment_ready === true) throw new LegacyPolicyError("instance_set");
    } else {
      if (!safeName(state.installation_id) || !safeName(state.instance_id) || state.instance_id !== canonicalInstallationId(state.installation_id) || state.instance_id.toLowerCase() === LEGACY_ID || state.instance_root !== path.join(instancesRoot, state.instance_id) || entries.length !== 2 || !entries.includes(state.instance_id) || state.control_environment_ready !== true || state.target_environment_ready === true || state.sandbox_project_key !== `sandbox-${state.instance_id}` || !safeName(state.sandbox_project_key) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(state.control_repository || "") || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(state.sandbox_repository || "") || state.control_repository.toLowerCase() === state.sandbox_repository.toLowerCase() || ![state.control_repository_id, state.sandbox_repository_id].every(validRepositoryId) || String(state.control_repository_id) === String(state.sandbox_repository_id)) throw new LegacyPolicyError("new_identity");
      const fresh = lstat(fsImpl, state.instance_root), old = lstat(fsImpl, roots[2]);
      if (!fresh.ok || fresh.stat.isSymbolicLink() || !fresh.stat.isDirectory() || !strictOwner(fresh.stat) || (fresh.stat.mode & 0o7777) !== 0o700 || !safeDirectory(fsImpl, state.instance_root).ok || fsImpl.realpathSync(state.instance_root) !== state.instance_root || (fresh.stat.dev === old.stat.dev && fresh.stat.ino === old.stat.ino)) throw new LegacyPolicyError("new_root");
      const official = defaultLocalPaths({ home, installationId: state.installation_id, projectKey: state.sandbox_project_key, platform: "darwin" });
      if ((state.control_clone_path !== undefined && state.control_clone_path !== official.control) || (state.sandbox_clone_path !== undefined && state.sandbox_clone_path !== official.project) || (state.chat_route_file !== undefined && state.chat_route_file !== path.join(state.instance_root, "chat-routes.json"))) throw new LegacyPolicyError("new_path");
      roots.push(state.instance_root);
    }
    const oldRoot = roots[2], diagnostic = path.join(oldRoot, "short-turn-evidence"), before = lstat(fsImpl, diagnostic);
    if (!before.ok || before.stat.isSymbolicLink() || !before.stat.isDirectory() || !strictOwner(before.stat) || (before.stat.mode & 0o7022) !== 0 || roots.some(root => { const stat = fsImpl.lstatSync(root); return stat.dev === before.stat.dev && stat.ino === before.stat.ino; })) throw new LegacyPolicyError("diagnostics_root");
    const allowedDirs = new Set(["pending-wakes", "registration-intents", "registration-delivery", ".git", "automation", "logs", "browser-profile"]);
    const allowedFiles = new Set(["chat-routes.json", "instance.json", "migration-intent.json"]);
    const top = fsImpl.readdirSync(oldRoot, { withFileTypes: true }).map(entry => entry.name);
    if (new Set(top.map(name => name.toLowerCase())).size !== top.length) throw new LegacyPolicyError("top_level_alias");
    const records = [], routes = [], pending = [];
    for (const name of top) {
      if (name === "short-turn-evidence") continue;
      const snapshot = name.startsWith("control-routing-migration-") && safeName(name.slice("control-routing-migration-".length));
      if (!allowedDirs.has(name) && !allowedFiles.has(name) && !snapshot) throw new LegacyPolicyError("unknown_top_level");
      const file = path.join(oldRoot, name), st = fsImpl.lstatSync(file);
      if ((allowedDirs.has(name) || snapshot) ? !st.isDirectory() : !st.isFile()) throw new LegacyPolicyError("top_level_type");
      if (pending.length >= MAX_TREE_ENTRIES) throw new LegacyPolicyError("tree_bound");
      pending.push({ file, depth: 1, snapshot });
      if (allowedFiles.has(name)) { const value = legacyJson(fsImpl, file); records.push(value); if (name === "chat-routes.json") { const parsed = selectedRoutes(value); if (!parsed) throw new LegacyPolicyError("routes_shape"); routes.push(...parsed); } }
    }
    let visited = 0, enqueued = pending.length;
    if (enqueued > MAX_TREE_ENTRIES) throw new LegacyPolicyError("tree_bound");
    while (pending.length) {
      const { file, depth, snapshot } = pending.pop(), st = fsImpl.lstatSync(file);
      if (++visited > MAX_TREE_ENTRIES || depth > MAX_TREE_DEPTH || st.isSymbolicLink() || !strictOwner(st) || (st.mode & 0o7022) !== 0) throw new LegacyPolicyError("unsafe_legacy_tree");
      if (st.isDirectory()) {
        if (depth >= MAX_TREE_DEPTH) throw new LegacyPolicyError("tree_bound");
        for (const entry of fsImpl.readdirSync(file, { withFileTypes: true })) {
          if (!safeTreeBasename(entry.name)) throw new LegacyPolicyError("unsafe_basename");
          const child = path.join(file, entry.name);
          if (++enqueued > MAX_TREE_ENTRIES) throw new LegacyPolicyError("tree_bound");
          if (snapshot && depth === 1 && entry.name === "instance.json") records.push(legacyJson(fsImpl, child));
          pending.push({ file: child, depth: depth + 1, snapshot: false });
        }
      } else if (!st.isFile() || st.nlink !== 1 || ![0o600, 0o644].includes(st.mode & 0o7777)) throw new LegacyPolicyError("unsafe_legacy_leaf");
    }
    const routeIds = routes.map(route => route.route.toLowerCase());
    if (new Set(routeIds).size !== routeIds.length) throw new LegacyPolicyError("duplicate_routes");
    const values = new Map();
    for (const record of records) if (record.destination !== undefined && (!record.destination || typeof record.destination !== "object" || Array.isArray(record.destination) || (record.destination.path !== undefined && record.destination.path !== oldRoot))) throw new LegacyPolicyError("invalid_destination");
    const nested = records.flatMap(record => record.generated_repositories === undefined ? [] : (record.generated_repositories && typeof record.generated_repositories === "object" && !Array.isArray(record.generated_repositories) ? [{ ...(record.generated_repositories.control === undefined ? {} : { control_repository: record.generated_repositories.control }), ...(record.generated_repositories.sandbox === undefined ? {} : { sandbox_repository: record.generated_repositories.sandbox }) }] : [null]));
    if (nested.includes(null)) throw new LegacyPolicyError("invalid_identity");
    for (const record of [...records, ...routes, ...nested]) {
      for (const key of legacyIdentityKeys) if (record[key] !== undefined) {
        const value = record[key];
        if (key.endsWith("_id") && key.includes("repository")) { if (!validRepositoryId(value)) throw new LegacyPolicyError("invalid_identity"); }
        else if (typeof value !== "string" || !value) throw new LegacyPolicyError("invalid_identity");
        if (key === "instance_id" && value !== LEGACY_ID) throw new LegacyPolicyError("old_instance_identity");
        if (key === "installation_id" && (!safeName(value) || canonicalInstallationId(value) !== LEGACY_ID)) throw new LegacyPolicyError("old_installation_identity");
        if (["control_repository", "sandbox_repository"].includes(key) && !new RegExp(`^[A-Za-z0-9_.-]+/chatgpt-codex-orchestrator-${key.startsWith("control") ? "control" : "sandbox"}-${LEGACY_ID}$`, "i").test(value)) throw new LegacyPolicyError("old_role_identity");
        const normalized = String(value).toLowerCase();
        if (values.has(key) && values.get(key) !== normalized) throw new LegacyPolicyError("old_identity_conflict"); values.set(key, normalized);
        if (!initial && (key === "installation_id" ? canonicalInstallationId(value) === state.instance_id : key === "instance_id" ? normalized === state.instance_id.toLowerCase() : key.endsWith("repository") ? [state.control_repository, state.sandbox_repository].some(v => v.toLowerCase() === normalized) : [state.control_repository_id, state.sandbox_repository_id].some(v => String(v) === String(value)))) throw new LegacyPolicyError("identity_collision");
      }
    }
    if (values.has("control_repository_id") && values.get("control_repository_id") === values.get("sandbox_repository_id")) throw new LegacyPolicyError("old_identity_conflict");
    const marker = audit("OPAQUE_PRESERVED_NONAUTHORITY", initial ? "initial_passive_legacy" : "continued_passive_legacy");
    const historical = { instance_id: LEGACY_ID, status: "CONFLICT", missing_verification_gates: ["safe_instance_tree"], fresh_first_install_candidate: true, legacy_evidence_isolation: marker };
    const instances = [historical];
    if (!initial) {
      const selected = candidate(fsImpl, instancesRoot, state.instance_id);
      if (selected.status === "CONFLICT" || selected.route_names.some(name => routeIds.includes(name.toLowerCase()))) throw new LegacyPolicyError("new_candidate_or_route_collision");
      instances.push(selected);
    }
    const after = fsImpl.lstatSync(diagnostic);
    if (!sameStat(before.stat, after)) throw new LegacyPolicyError("diagnostics_drift");
    return { status: "CONFLICT", mutations_performed: false, instances_root_present: true, instance_ids: entries.slice().sort(), instances, fresh_first_install_candidate: initial, missing_verification_gates: [...new Set(instances.flatMap(item => item.missing_verification_gates))].sort(), legacy_evidence_isolation: marker };
  } catch (error) { return reject(error instanceof LegacyPolicyError ? error.reason : "classification_failed"); }
}

export function inspectMacosExistingInstanceRecovery({ home = os.homedir(), fsImpl = fs, state = {} } = {}) {
  const report = { status: "ABSENT", mutations_performed: false, instances_root_present: false, instance_ids: [], instances: [], missing_verification_gates: [] };
  const homePath = path.resolve(home);
  const policyFailure = reason => ({ ...report, status: "CONFLICT", fresh_first_install_candidate: false, missing_verification_gates: ["safe_instance_tree"], legacy_evidence_isolation: { ...LEGACY_AUDIT, classification: "REJECTED", reason } });
  const homeCheck = safeDirectory(fsImpl, homePath, { privateDirectory: false });
  if (!homeCheck.ok) return legacyIntent(state) ? policyFailure("safe_home") : { ...report, status: "CONFLICT", missing_verification_gates: ["safe_home"] };
  const canonicalRoot = path.join(homePath, INSTANCE_ROOT_NAME);
  const rootCheck = safeDirectory(fsImpl, canonicalRoot, { privateDirectory: true });
  if (rootCheck.missing) return legacyIntent(state) ? policyFailure("missing_project_root") : report;
  if (!rootCheck.ok) return legacyIntent(state) ? policyFailure("safe_instances_root") : { ...report, status: "CONFLICT", instances_root_present: true, missing_verification_gates: ["safe_instances_root"] };
  const instancesRoot = path.join(canonicalRoot, "instances");
  const instancesCheck = safeDirectory(fsImpl, instancesRoot, { privateDirectory: true });
  if (instancesCheck.missing) return legacyIntent(state) ? policyFailure("missing_instances_directory") : { ...report, instances_root_present: true };
  if (!instancesCheck.ok) return legacyIntent(state) ? policyFailure("safe_instances_directory") : { ...report, status: "CONFLICT", instances_root_present: true, missing_verification_gates: ["safe_instances_directory"] };
  let entries;
  try { entries = fsImpl.readdirSync(instancesRoot, { withFileTypes: true }).map(entry => entry.name).sort(); }
  catch { return legacyIntent(state) ? policyFailure("enumerable_instances") : { ...report, status: "CONFLICT", instances_root_present: true, missing_verification_gates: ["enumerable_instances"] }; }
  if (legacyIntent(state)) return classifyLegacyIsolation({ fsImpl, home, instancesRoot, entries, state });
  const ids = entries.filter(safeName);
  const unsafe = entries.filter(name => !safeName(name));
  if (unsafe.length) return { ...report, status: "CONFLICT", instances_root_present: true, instance_ids: ids, missing_verification_gates: ["safe_instance_ids"] };
  for (const id of ids) {
    const dir = path.join(instancesRoot, id);
    const check = safeDirectory(fsImpl, dir, { privateDirectory: true });
    if (!check.ok) report.instances.push({ instance_id: id, status: "CONFLICT", missing_verification_gates: ["safe_instance_directory"] });
    else {
      try {
        const item = candidate(fsImpl, instancesRoot, id);
        if (item.status === "CONFLICT" && id === "1832f0bb" && safeLegacyFreshTree(fsImpl, dir)) item.fresh_first_install_candidate = true;
        report.instances.push(item);
      }
      catch { report.instances.push({ instance_id: id, status: "CONFLICT", missing_verification_gates: ["readable_instance_metadata"] }); }
    }
  }
  report.instance_ids = report.instances.map(item => item.instance_id).sort();
  report.status = report.instances.length === 1 && report.instances[0].status === "NEEDS_VERIFICATION" ? "NEEDS_VERIFICATION" : report.instances.length > 1 ? "CONFLICT" : report.instances[0]?.status || "ABSENT";
  report.fresh_first_install_candidate = report.instances.length === 1 && report.instances[0]?.fresh_first_install_candidate === true;
  report.missing_verification_gates = [...new Set(report.instances.flatMap(item => item.missing_verification_gates || []))].sort();
  return report;
}

const FRESH_APPROVAL_FILE = "selected-fresh-instance-approval-v1.json";
const MAX_PROOF_BYTES = 1024 * 1024;
const strictOwner = stat => typeof process.getuid !== "function" || stat.uid === process.getuid();

function selectedResult(status, gates = [], extra = {}) {
  return { status, selection_mode: "explicit-selected-fresh-instance-v1", mutations_performed: false, historical_instances_are_authority: false, missing_verification_gates: [...new Set(gates)].sort(), ...extra };
}

// A missing installer journal is the only authority for the fresh-first-install
// exception.  It is deliberately narrower than recovery: one already safe,
// untrusted historical instance may trigger the normal setup approval, but no
// selected or partially-created instance may use this path.
export function isMacosFreshFirstInstallBootstrap({ state = {}, recovery, installStateMissing = false } = {}) {
  if ((recovery && typeof recovery === "object" && Object.hasOwn(recovery, "legacy_evidence_isolation")) || (Array.isArray(recovery?.instances) && recovery.instances.some(item => item && typeof item === "object" && Object.hasOwn(item, "legacy_evidence_isolation")))) {
    const validMarker = marker => marker && Object.entries(LEGACY_AUDIT).every(([key, value]) => marker[key] === value) && marker.reason === "initial_passive_legacy";
    const historical = recovery.instances?.[0];
    const exactGates = gates => Array.isArray(gates) && gates.length === 1 && gates[0] === "safe_instance_tree";
    return Boolean(legacyIntent(state) && legacyInitialAbsentFields.every(key => isAbsentLegacyField(state[key])) && state.control_environment_ready !== true && state.target_environment_ready !== true && validMarker(recovery.legacy_evidence_isolation) && recovery.status === "CONFLICT" && recovery.mutations_performed === false && recovery.fresh_first_install_candidate === true && exactGates(recovery.missing_verification_gates) && recovery.instance_ids?.length === 1 && recovery.instance_ids[0] === LEGACY_ID && recovery.instances?.length === 1 && historical?.instance_id === LEGACY_ID && historical.status === "CONFLICT" && historical.fresh_first_install_candidate === true && !Object.hasOwn(historical, "identity") && exactGates(historical.missing_verification_gates) && validMarker(historical.legacy_evidence_isolation));
  }
  const approvedLegacyIntent = state.fresh_first_install_bootstrap === true
    && state.fresh_first_install_legacy_instance_id === "1832f0bb";
  return Boolean((installStateMissing || approvedLegacyIntent)
    && state.installation_id === undefined
    && state.instance_id === undefined
    && (recovery?.status === "NEEDS_VERIFICATION" || recovery?.fresh_first_install_candidate === true)
    && recovery.instances?.length === 1
    && (recovery.instances[0]?.status === "NEEDS_VERIFICATION" || recovery.instances[0]?.fresh_first_install_candidate === true)
    && recovery.instance_ids?.length === 1
    && recovery.instances[0]?.instance_id === "1832f0bb"
    && (recovery.instances[0]?.identity?.instance_id === undefined || recovery.instances[0]?.identity?.instance_id === "1832f0bb")
    && (recovery.instances[0]?.identity?.installation_id === undefined || typeof recovery.instances[0]?.identity?.installation_id === "string"));
}

function selectedJson(fsImpl, file, { allowMissing = false, passive = false } = {}) {
  const parent = safeDirectory(fsImpl, path.dirname(file), { privateDirectory: false });
  if (!parent.ok) return { ok: false, reason: "unsafe-proof-parent" };
  const before = lstat(fsImpl, file);
  if (before.missing && allowMissing) return { ok: true, missing: true };
  if (!before.ok || before.stat.isSymbolicLink() || !before.stat.isFile() || before.stat.nlink !== 1 ||
      !strictOwner(before.stat) || (passive ? !ancestorModeAllowed(before.stat) : (before.stat.mode & 0o777) !== 0o600) ||
      before.stat.size > MAX_PROOF_BYTES) return { ok: false, reason: "unsafe-proof-file" };
  let fd;
  try {
    fd = fsImpl.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fsImpl.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || !strictOwner(opened) || opened.ino !== before.stat.ino || opened.dev !== before.stat.dev || opened.size > MAX_PROOF_BYTES) return { ok: false, reason: "proof-file-changed" };
    const value = JSON.parse(fsImpl.readFileSync(fd, "utf8"));
    const after = fsImpl.lstatSync(file);
    if (after.isSymbolicLink() || after.ino !== opened.ino || after.dev !== opened.dev || after.nlink !== 1 || after.size !== opened.size || !strictOwner(after) ||
        (passive ? !ancestorModeAllowed(after) : (after.mode & 0o777) !== 0o600)) return { ok: false, reason: "proof-file-changed" };
    return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, value } : { ok: false, reason: "malformed-proof" };
  } catch { return { ok: false, reason: "unreadable-proof" }; }
  finally { if (fd !== undefined) fsImpl.closeSync(fd); }
}

function selectedRoutes(value) {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "routes")) return null;
  if (Array.isArray(value.routes)) return value.routes.every(item => item && typeof item === "object" && !Array.isArray(item) && safeName(item.route)) ? value.routes : null;
  if (!value.routes || typeof value.routes !== "object") return null;
  const entries = Object.entries(value.routes);
  if (entries.some(([route, item]) => !safeName(route) || !item || typeof item !== "object" || Array.isArray(item) || (item.route !== undefined && item.route !== route))) return null;
  return entries.map(([route, item]) => ({ route, ...item }));
}

function historicalIdentityCollision(fsImpl, instancesRoot, selectedId, expected) {
  let names;
  try { names = fsImpl.readdirSync(instancesRoot); } catch { return "enumerable_instances"; }
  const folded = selectedId.toLowerCase();
  const selectedStat = lstat(fsImpl, path.join(instancesRoot, selectedId));
  for (const name of names) {
    if (name === selectedId) continue;
    if (name.toLowerCase() === folded) return "colliding_instance_name";
    const root = path.join(instancesRoot, name);
    const stat = lstat(fsImpl, root);
    // Historical paths have no authority. In particular, never follow a link
    // or recursively traverse an unsafe historical tree in selected mode.
    if (!stat.ok) continue;
    if (stat.stat.isSymbolicLink()) {
      try { if (path.resolve(path.dirname(root), fsImpl.readlinkSync(root)) === path.join(instancesRoot, selectedId)) return "colliding_instance_alias"; } catch { /* Historical aliases confer no authority. */ }
      continue;
    }
    if (!stat.stat.isDirectory()) continue;
    if (selectedStat.ok && selectedStat.stat.ino === stat.stat.ino && selectedStat.stat.dev === stat.stat.dev) return "colliding_instance_alias";
    const proofs = ["instance.json", "migration-intent.json", FRESH_APPROVAL_FILE, "trusted-recovery-evidence-v1.json"];
    for (const basename of proofs) {
      const file = path.join(root, basename);
      const evidence = selectedJson(fsImpl, file, { allowMissing: true, passive: true });
      if (!evidence.ok || evidence.missing) continue;
      const record = evidence.value;
      if (record.instance_id === selectedId || record.installation_id === expected.installation_id ||
          [record.control_repository, record.sandbox_repository, record.generated_repositories?.control, record.generated_repositories?.sandbox].some(value => typeof value === "string" && [expected.control_repository.toLowerCase(), expected.sandbox_repository.toLowerCase()].includes(value.toLowerCase())) ||
          [record.control_repository_id, record.sandbox_repository_id].some(value => value !== undefined && [expected.control_repository_id, expected.sandbox_repository_id].includes(String(value)))) return "historical_identity_collision";
    }
  }
  return null;
}

function selectedApprovalInputs(state, provenance, root) {
  return {
    instance_id: state.instance_id, installation_id: state.installation_id, instance_root: root,
    control_repository: state.control_repository, sandbox_repository: state.sandbox_repository,
    control_repository_id: provenance.control_repository_id, sandbox_repository_id: provenance.sandbox_repository_id,
    github_login: provenance.github_login, github_user_id: provenance.github_user_id,
    project: state.sandbox_project_key, chat_url: state.reviewer_chat_url.replace(/\/$/, "")
  };
}

function selectedApprovalChallenge(inputs) {
  return `APPROVE selected fresh instance ${inputs.instance_id} installation ${inputs.installation_id} Control ${inputs.control_repository}#${inputs.control_repository_id} Sandbox ${inputs.sandbox_repository}#${inputs.sandbox_repository_id} project ${inputs.project} Chat ${inputs.chat_url}`;
}

function selectedOriginMatches(value, expected) {
  if (value === undefined) return true;
  return [`https://github.com/${expected}`, `https://github.com/${expected}.git`, `git@github.com:${expected}`, `git@github.com:${expected}.git`, `ssh://git@github.com/${expected}`, `ssh://git@github.com/${expected}.git`].includes(value);
}

export function inspectMacosSelectedFreshInstance({ state = {}, home = os.homedir(), fsImpl = fs, githubApi } = {}) {
  if (state.selected_fresh_instance !== true) return selectedResult("CONFLICT", ["explicit_selected_fresh_instance"]);
  if (!safeName(state.instance_id) || !safeName(state.installation_id) || state.instance_id !== canonicalInstallationId(state.installation_id) ||
      !safeName(state.sandbox_project_key) || state.sandbox_project_key !== `sandbox-${state.instance_id}` || state.control_environment_ready !== true) return selectedResult("CONFLICT", ["selected_installer_identity"]);
  const homePath = path.resolve(home);
  const instancesRoot = path.join(homePath, INSTANCE_ROOT_NAME, "instances");
  const root = path.join(instancesRoot, state.instance_id);
  if (state.instance_root !== root) return selectedResult("CONFLICT", ["canonical_selected_instance_root"]);
  for (const directory of [path.join(homePath, INSTANCE_ROOT_NAME), instancesRoot, root]) {
    const check = safeDirectory(fsImpl, directory);
    const stat = lstat(fsImpl, directory);
    if (!check.ok || !stat.ok || !strictOwner(stat.stat)) return selectedResult("CONFLICT", ["private_owned_selected_instance"]);
  }
  let selectedRunnerPackage;
  try { selectedRunnerPackage = inspectMacosRunnerPackageLeaves({ state, home: homePath, fsImpl }); }
  catch { return selectedResult("CONFLICT", ["safe_selected_instance_tree"]); }
  if (!safeInstanceTree(fsImpl, root, { strictOwner: true, selectedRunnerWork: true, selectedRuntimeBrowserProfileSingletons: true, selectedRunnerPackage, selectedRunnerEnvironment: true }).ok) return selectedResult("CONFLICT", ["safe_selected_instance_tree"]);
  const expectedControl = path.resolve(defaultLocalPaths({ home: homePath, installationId: state.installation_id, projectKey: state.sandbox_project_key }).control);
  if (state.control_clone_path !== expectedControl || state.chat_route_file !== path.join(root, "chat-routes.json")) return selectedResult("CONFLICT", ["canonical_selected_proof_paths"]);
  const control = selectedJson(fsImpl, path.join(expectedControl, "instance.json"));
  const instance = selectedJson(fsImpl, path.join(root, "instance.json"), { allowMissing: true });
  const intent = selectedJson(fsImpl, path.join(root, "migration-intent.json"));
  const routes = selectedJson(fsImpl, state.chat_route_file, { passive: true });
  const receiptPath = path.join(root, FRESH_APPROVAL_FILE);
  const receipt = selectedJson(fsImpl, receiptPath, { allowMissing: true });
  if (!control.ok || !instance.ok || !intent.ok || !routes.ok || !receipt.ok) return selectedResult("CONFLICT", ["selected_proof_integrity"]);
  const identity = { instance_id: state.instance_id, installation_id: state.installation_id, control_repository: state.control_repository, sandbox_repository: state.sandbox_repository };
  if (Object.entries(identity).some(([key, value]) => typeof value !== "string" || !value || control.value[key] !== value || (!instance.missing && instance.value[key] !== value) || (!routes.missing && routes.value[key] !== undefined && routes.value[key] !== value)) ||
      control.value.schema_version !== 1 || control.value.role !== "control" || control.value.platform !== "darwin" || control.value.arch !== "arm64" ||
      (control.value.trusted_github_username !== undefined && control.value.trusted_github_username !== state.github_login) ||
      !selectedOriginMatches(control.value.origin, state.control_repository) || !selectedOriginMatches(control.value.remote_origin, state.control_repository) ||
      intent.value.schema_version !== 1 || intent.value.phase !== "PREPARED" || intent.value.installation_id !== state.installation_id ||
      intent.value.generated_repositories?.control !== state.control_repository || intent.value.generated_repositories?.sandbox !== state.sandbox_repository ||
      (intent.value.destination?.path !== undefined && intent.value.destination.path !== root)) return selectedResult("CONFLICT", ["matching_selected_identity"]);
  const records = routes.missing ? [] : selectedRoutes(routes.value);
  if (!records || new Set(records.map(item => item.route)).size !== records.length ||
      records.some(item => ["instance_id", "installation_id", "control_repository", "sandbox_repository"].some(key => item[key] !== undefined && item[key] !== identity[key]))) return selectedResult("CONFLICT", ["selected_route_identity"]);
  let provenance;
  try { provenance = verifyMacosGeneratedRepositoryIdentity({ state, githubApi }); }
  catch { return selectedResult("CONFLICT", ["independent_generated_repository_identity"]); }
  if ([control.value, instance.value, intent.value].filter(Boolean).some(value => ["control_repository_id", "sandbox_repository_id"].some(key => value[key] !== undefined && String(value[key]) !== provenance[key]))) return selectedResult("CONFLICT", ["matching_selected_repository_ids"]);
  const recoveryReceipt = lstat(fsImpl, path.join(root, "trusted-recovery-evidence-v1.json"));
  if (!recoveryReceipt.ok && !recoveryReceipt.missing) return selectedResult("CONFLICT", ["trusted_manifest_integrity"]);
  if (recoveryReceipt.ok && verifyTrustedRecoveryEvidence({ state, home: homePath, fsImpl, githubApi, requireReceipt: true }).status !== "VERIFIED") return selectedResult("CONFLICT", ["trusted_manifest_integrity"]);
  const inputs = selectedApprovalInputs(state, provenance, root);
  const collision = historicalIdentityCollision(fsImpl, instancesRoot, state.instance_id, inputs);
  if (collision) return selectedResult("CONFLICT", [collision]);
  const challenge = selectedApprovalChallenge(inputs);
  const pendingRoute = records.length === 1 ? records[0] : null;
  const firstRoutePending = Boolean(pendingRoute && pendingRoute.project === state.sandbox_project_key && pendingRoute.status === "active" &&
    pendingRoute.chat_url === state.reviewer_chat_url.replace(/\/$/, "") && pendingRoute.installation_id === state.installation_id &&
    Number.isSafeInteger(pendingRoute.registration_issue) && pendingRoute.registration_issue > 0 && pendingRoute.route === `chat-${pendingRoute.registration_issue}`);
  const common = { instance_ids: [state.instance_id], identity, provenance, route_count: records.length, first_route_pending: firstRoutePending, approval_path: receiptPath, approval_challenge: challenge };
  if (receipt.missing) return selectedResult("NEEDS_USER_ACTION", ["separate_selected_fresh_instance_approval"], { ...common, fresh_approval_eligible: records.length === 0 });
  const value = receipt.value;
  if (value.schema_version !== 1 || value.kind !== "SELECTED_FRESH_INSTANCE_HUMAN_APPROVAL" || value.approval !== challenge ||
      Object.entries(inputs).some(([key, expected]) => value[key] !== expected) ||
      typeof value.approved_at !== "string" || !Number.isFinite(Date.parse(value.approved_at)) || new Date(value.approved_at).toISOString() !== value.approved_at ||
      value.identity_sha256 !== crypto.createHash("sha256").update(JSON.stringify(inputs)).digest("hex")) return selectedResult("CONFLICT", ["selected_approval_identity"]);
  return selectedResult("SELECTED_FRESH_INSTANCE_VERIFIED", [], common);
}

export function approveMacosSelectedFreshInstance({ state = {}, approval, home = os.homedir(), fsImpl = fs, githubApi, now = () => new Date() } = {}) {
  const report = inspectMacosSelectedFreshInstance({ state, home, fsImpl, githubApi });
  if (approval !== report.approval_challenge || typeof approval !== "string" || !approval) throw new Error("exact selected-fresh-instance approval is required");
  if (report.status === "SELECTED_FRESH_INSTANCE_VERIFIED") return { ...report, idempotent: true };
  if (report.status !== "NEEDS_USER_ACTION" || report.fresh_approval_eligible !== true) throw new Error("only an independently verified unused fresh instance can be approved");
  const inputs = selectedApprovalInputs(state, report.provenance, state.instance_root);
  const value = { schema_version: 1, kind: "SELECTED_FRESH_INSTANCE_HUMAN_APPROVAL", ...inputs, approval, identity_sha256: crypto.createHash("sha256").update(JSON.stringify(inputs)).digest("hex"), approved_at: now().toISOString() };
  // Exclusive creation avoids overwriting an old or concurrently created file.
  // No mkdir, chmod, adoption, migration, or historical-root write occurs here.
  const fd = fsImpl.openSync(report.approval_path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { fsImpl.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsImpl.fsyncSync(fd); }
  finally { fsImpl.closeSync(fd); }
  const directory = fsImpl.openSync(state.instance_root, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0));
  try { fsImpl.fsyncSync(directory); } finally { fsImpl.closeSync(directory); }
  const verified = inspectMacosSelectedFreshInstance({ state, home, fsImpl, githubApi });
  if (verified.status !== "SELECTED_FRESH_INSTANCE_VERIFIED") throw new Error("durable selected approval failed re-verification; manual review is required");
  return { ...verified, mutations_performed: true, idempotent: false };
}

