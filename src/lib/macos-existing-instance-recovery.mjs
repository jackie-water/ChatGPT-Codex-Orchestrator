import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PRIVATE_MODES = new Set([0o600, 0o700]);
const INSTANCE_ROOT_NAME = ".chatgpt-codex-orchestrator";
const MAX_TREE_ENTRIES = 4096;
const MAX_TREE_DEPTH = 64;
const MAX_TREE_BASENAME_LENGTH = 255;

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
    && /^[A-Za-z0-9._-]+$/.test(value);
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

function safeInstanceTree(fsImpl, root) {
  const pending = [{ file: path.resolve(root), depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { file, depth } = pending.pop();
    const relative = path.relative(path.resolve(root), file);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { ok: false, reason: "traversal" };
    const result = lstat(fsImpl, file);
    if (!result.ok) return { ok: false, reason: result.missing ? "traversal" : "unreadable" };
    const stat = result.stat;
    if (stat.isSymbolicLink()) return { ok: false, reason: "symlink" };
    if (!uidAllowed(stat)) return { ok: false, reason: "unsafe-owner" };
    if (stat.isDirectory()) {
      if (!privateMode(stat, true)) return { ok: false, reason: "odd-directory-mode" };
      if (depth >= MAX_TREE_DEPTH) return { ok: false, reason: "tree-bound" };
      let entries;
      try { entries = fsImpl.readdirSync(file, { withFileTypes: true }); }
      catch { return { ok: false, reason: "traversal" }; }
      visited += entries.length;
      if (visited > MAX_TREE_ENTRIES) return { ok: false, reason: "tree-bound" };
      for (const entry of entries) {
        const child = path.join(file, entry.name);
        const childRelative = path.relative(path.resolve(root), child);
        if (!safeTreeBasename(entry.name) || childRelative.startsWith(`..${path.sep}`) || path.isAbsolute(childRelative)) return { ok: false, reason: "traversal" };
        pending.push({ file: child, depth: depth + 1 });
      }
    } else if (!stat.isFile() || stat.nlink !== 1 || !privateMode(stat, false)) {
      return { ok: false, reason: stat.isSymbolicLink() ? "symlink" : "unsafe-leaf" };
    }
  }
  return { ok: true };
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
  const conflict = (routeFile.present && !routeFile.valid) || snapshots.some(name => name.endsWith(":INVALID")) || (instanceMetadata.present && !instanceMetadata.valid) || mismatched || routeIdentityMismatch;
  const identity = { instance_id: instanceIds[0] || null, installation_id: installationIds[0] || null, control_repository: controlRepositories[0] || null, sandbox_repository: sandboxRepositories[0] || null };
  return { instance_id: id, status: conflict ? "CONFLICT" : "NEEDS_VERIFICATION", metadata: { chat_routes: routeFile.present, migration_snapshots: snapshots.length > 0, instance: instanceMetadata.present }, identity, route_names: routeNamesFound, missing_verification_gates: [...new Set(reasons)].sort(), ...(conflict ? {} : { clues_unverified: true }) };
}

export function inspectMacosExistingInstanceRecovery({ home = os.homedir(), fsImpl = fs } = {}) {
  const report = { status: "ABSENT", mutations_performed: false, instances_root_present: false, instance_ids: [], instances: [], missing_verification_gates: [] };
  const homePath = path.resolve(home);
  const homeCheck = safeDirectory(fsImpl, homePath, { privateDirectory: false });
  if (!homeCheck.ok) return { ...report, status: "CONFLICT", missing_verification_gates: ["safe_home"] };
  const canonicalRoot = path.join(homePath, INSTANCE_ROOT_NAME);
  const rootCheck = safeDirectory(fsImpl, canonicalRoot, { privateDirectory: true });
  if (rootCheck.missing) return report;
  if (!rootCheck.ok) return { ...report, status: "CONFLICT", instances_root_present: true, missing_verification_gates: ["safe_instances_root"] };
  const instancesRoot = path.join(canonicalRoot, "instances");
  const instancesCheck = safeDirectory(fsImpl, instancesRoot, { privateDirectory: true });
  if (instancesCheck.missing) return { ...report, instances_root_present: true };
  if (!instancesCheck.ok) return { ...report, status: "CONFLICT", instances_root_present: true, missing_verification_gates: ["safe_instances_directory"] };
  let entries;
  try { entries = fsImpl.readdirSync(instancesRoot, { withFileTypes: true }).map(entry => entry.name).sort(); }
  catch { return { ...report, status: "CONFLICT", instances_root_present: true, missing_verification_gates: ["enumerable_instances"] }; }
  const ids = entries.filter(safeName);
  const unsafe = entries.filter(name => !safeName(name));
  if (unsafe.length) return { ...report, status: "CONFLICT", instances_root_present: true, instance_ids: ids, missing_verification_gates: ["safe_instance_ids"] };
  for (const id of ids) {
    const dir = path.join(instancesRoot, id);
    const check = safeDirectory(fsImpl, dir, { privateDirectory: true });
    if (!check.ok) report.instances.push({ instance_id: id, status: "CONFLICT", missing_verification_gates: ["safe_instance_directory"] });
    else {
      try { report.instances.push(candidate(fsImpl, instancesRoot, id)); }
      catch { report.instances.push({ instance_id: id, status: "CONFLICT", missing_verification_gates: ["readable_instance_metadata"] }); }
    }
  }
  report.instance_ids = report.instances.map(item => item.instance_id).sort();
  report.status = report.instances.length === 1 && report.instances[0].status === "NEEDS_VERIFICATION" ? "NEEDS_VERIFICATION" : report.instances.length > 1 ? "CONFLICT" : report.instances[0]?.status || "ABSENT";
  report.missing_verification_gates = [...new Set(report.instances.flatMap(item => item.missing_verification_gates || []))].sort();
  return report;
}

