import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ROUTE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const authorizedSnapshots = new WeakMap();

function safePath(value, allowMissing = false) {
  const absolute = path.resolve(String(value));
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink() && current !== "/tmp" && current !== "/var") throw new Error("Unsafe symlink path"); }
    catch (e) { if (e.code === "ENOENT" && allowMissing) break; throw e; }
  }
  return absolute;
}
function readJson(file) { return JSON.parse(fs.readFileSync(safePath(file), "utf8").replace(/^\uFEFF/, "")); }
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}
function fail(message) { throw new Error(message); }

function immutableClone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(immutableClone));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableClone(item)])));
}

export function getAuthorizedSnapshot(normalized) {
  const snapshot = normalized && typeof normalized === "object" ? authorizedSnapshots.get(normalized) : undefined;
  if (!snapshot) fail("A normalized event authorization snapshot is required");
  return snapshot;
}

export function normalizeControlEvent({event, controlRoot, controlRepository, trustedGithubUsername}) {
  if (!Array.isArray(trustedGithubUsername) || trustedGithubUsername.length === 0 || trustedGithubUsername.some(name => typeof name !== "string" || !name)) fail("trustedGithubUsername must be a nonempty array of usernames");
  const raw = event && typeof event === "object" ? event : fail("Invalid GitHub event");
  if (!REPO.test(String(controlRepository || ""))) fail("Invalid trusted Control repository");
  if (raw.repository?.full_name !== controlRepository) fail("Control event repository does not match trusted Control repository");
  if (raw.issue?.title !== undefined && (typeof raw.issue.title !== "string" || !/^\[CODEX-RUN\] [^\r\n]+$/.test(raw.issue.title))) fail("Unsupported issue title");
  if (typeof raw.issue?.title !== "string" || !/^\[CODEX-RUN\] [^\r\n]+$/.test(raw.issue.title)) fail("CODEX-RUN issue title is required");
  const issue = Number(raw.issue?.number); if (!Number.isInteger(issue) || issue < 1) fail("Invalid issue number");
  const author = raw.issue?.user?.login; if (typeof author !== "string" || !trustedGithubUsername.includes(author)) fail("Untrusted issue author");
  let body; try { body = JSON.parse(String(raw.issue.body)); } catch { fail("Malformed issue body"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Issue body must be a JSON object");
  const project = String(body.project || "").toLowerCase(); const iteration = Number(body.iteration);
  if (!ID.test(project) || !Number.isInteger(iteration) || iteration < 1) fail("Invalid project or iteration");
  const root = safePath(controlRoot); const instance = readJson(path.join(root, "instance.json"));
  if (!ID.test(String(instance.instance_id || ""))) fail("Invalid instance metadata");
  const projects = readJson(path.join(root, "projects.json")); const configured = projects.projects?.[project];
  if (!configured || configured.enabled === false || !REPO.test(String(configured.repository || ""))) fail("Unknown or disabled project");
  if (body.target_repo !== undefined && body.target_repo !== configured.repository) fail("Target repository does not match project registry");
  if (Object.prototype.hasOwnProperty.call(body, "chat_url")) fail("Issue body must not provide chat_url");
  const route = body.review_route; if (typeof route !== "string" || !ROUTE.test(route)) fail("Invalid review_route");
  const routeFile = path.join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".chatgpt-codex-orchestrator", "instances", instance.instance_id, "chat-routes.json");
  const routes = readJson(routeFile); const record = (routes.routes || []).find(r => r.project === project && r.route === route && r.status === "active");
  if (!record) fail("Missing or inactive review_route");
  if (typeof record.chat_url !== "string" || !/^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]+\/?$/.test(record.chat_url)) fail("Invalid registered Chat URL");
  const digest = crypto.createHash("sha256").update(canonical(raw)).digest("hex");
  const normalizedEvent = { repository: { full_name: configured.repository }, issue: { title: raw.issue.title, number: issue, user: { login: author }, body: JSON.stringify({ ...body, project, iteration, review_route: route, target_repo: configured.repository }) } };
  const normalized = { event: normalizedEvent, context: { control_provenance: { repository: controlRepository, issue_number: issue, author, event_digest_sha256: digest }, authorized_source: { project, repository: configured.repository, review_route: route, iteration } } };
  authorizedSnapshots.set(normalized, immutableClone({ instance_id: instance.instance_id, project, configuration: projects.projects[project] }));
  return normalized;
}

export function writeNormalizedOutput(file, value, { controlRoot } = {}) {
  if (typeof controlRoot !== "string" || !controlRoot) fail("controlRoot is required for normalized output");
  const root = safePath(controlRoot); const instance = readJson(path.join(root, "instance.json"));
  if (!ID.test(String(instance.instance_id || ""))) fail("Invalid instance metadata");
  const home = safePath(process.env.HOME || process.env.USERPROFILE || "/tmp");
  const instanceDir = path.join(home, ".chatgpt-codex-orchestrator", "instances", instance.instance_id);
  const allowed = path.join(instanceDir, "normalized-control-events");
  file = safePath(file, true);
  if (path.dirname(file) !== allowed) fail("Output file must be inside the instance normalized-control-events directory");
  for (const dir of [instanceDir, allowed]) {
    let st; try { st = fs.lstatSync(dir); } catch (e) { if (e.code !== "ENOENT") throw e; fs.mkdirSync(dir, 0o700); st = fs.lstatSync(dir); }
    if (st.isSymbolicLink() || !st.isDirectory()) fail("Unsafe normalized output directory");
    if ((st.mode & 0o777) !== 0o700) fail("Normalized output directory is not private");
  }
  let existing; try { const st = fs.lstatSync(file); if (st.isSymbolicLink() || !st.isFile()) fail("Unsafe normalized output file"); if ((st.mode & 0o777) !== 0o600) fail("Normalized output file is not private"); existing = fs.readFileSync(file); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (existing) { try { if (canonical(JSON.parse(existing.toString())) === canonical(value)) return; } catch {} fail("Conflicting normalized output exists"); }
  const temp = path.join(allowed, "." + path.basename(file) + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp");
  const serialized = JSON.stringify(value, null, 2) + "\n";
  const fd = fs.openSync(temp, "wx", 0o600); try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    fs.linkSync(temp, file);
    fs.rmSync(temp);
  } catch (e) {
    if (e.code === "EEXIST") {
      try { const st = fs.lstatSync(file); if (st.isSymbolicLink() || !st.isFile() || (st.mode & 0o777) !== 0o600) fail("Unsafe normalized output file"); const bytes = fs.readFileSync(file); if (bytes.toString() === serialized || canonical(JSON.parse(bytes.toString())) === canonical(value)) { fs.rmSync(temp); return; } } catch (readError) { if (readError.code !== "EEXIST") { try { fs.rmSync(temp); } catch {} throw readError; } }
      try { fs.rmSync(temp); } catch {} fail("Conflicting normalized output exists");
    }
    try { fs.rmSync(temp); } catch {}
    throw e;
  }
}
