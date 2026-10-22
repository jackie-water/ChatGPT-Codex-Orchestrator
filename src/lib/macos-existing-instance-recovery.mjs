import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { canonicalInstallationId, defaultLocalPaths } from "./control-render.mjs";
import { verifyMacosGeneratedRepositoryIdentity, verifyTrustedRecoveryEvidence } from "./macos-trusted-recovery-evidence.mjs";

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

function safeInstanceTree(fsImpl, root, { strictOwner = false, selectedRunnerWork = false } = {}) {
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
      visited += entries.length;
      if (visited > MAX_TREE_ENTRIES) return { ok: false, reason: "tree-bound" };
      for (const entry of entries) {
        const child = path.join(file, entry.name);
        const childRelative = path.relative(path.resolve(root), child);
        if (!safeTreeBasename(entry.name) || childRelative.startsWith(`..${path.sep}`) || path.isAbsolute(childRelative)) return { ok: false, reason: "traversal" };
        pending.push({ file: child, depth: depth + 1 });
      }
    } else if (!stat.isFile() || stat.nlink !== 1 || (!passive && !privateMode(stat, false)) || (passive && !ancestorModeAllowed(stat))) {
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

const FRESH_APPROVAL_FILE = "selected-fresh-instance-approval-v1.json";
const MAX_PROOF_BYTES = 1024 * 1024;
const strictOwner = stat => typeof process.getuid !== "function" || stat.uid === process.getuid();

function selectedResult(status, gates = [], extra = {}) {
  return { status, selection_mode: "explicit-selected-fresh-instance-v1", mutations_performed: false, historical_instances_are_authority: false, missing_verification_gates: [...new Set(gates)].sort(), ...extra };
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
  if (!safeInstanceTree(fsImpl, root, { strictOwner: true, selectedRunnerWork: true }).ok) return selectedResult("CONFLICT", ["safe_selected_instance_tree"]);
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

