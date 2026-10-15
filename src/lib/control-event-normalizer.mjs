import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ROUTE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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

export function normalizeControlEvent({event, controlRoot, controlRepository, trustedGithubUsername}) {
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
  const route = body.review_route; if (typeof route !== "string" || !ROUTE.test(route)) fail("Invalid review_route");
  const routeFile = path.join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".chatgpt-codex-orchestrator", "instances", instance.instance_id, "chat-routes.json");
  const routes = readJson(routeFile); const record = (routes.routes || []).find(r => r.project === project && r.route === route && r.status === "active");
  if (!record) fail("Missing or inactive review_route");
  if (typeof record.chat_url !== "string" || !/^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9-]+\/?$/.test(record.chat_url)) fail("Invalid registered Chat URL");
  const digest = crypto.createHash("sha256").update(canonical(raw)).digest("hex");
  const normalizedEvent = { ...raw, repository: { ...raw.repository, full_name: configured.repository }, issue: { ...raw.issue, body: JSON.stringify({ ...body, project, iteration, review_route: route, target_repo: configured.repository }) } };
  return { event: normalizedEvent, context: { control_provenance: { repository: controlRepository, issue_number: issue, author, event_digest_sha256: digest }, authorized_source: { project, repository: configured.repository, review_route: route, iteration } } };
}

export function writeNormalizedOutput(file, value) {
  file = safePath(file, true); const dir = path.dirname(file); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
  const temp = `${file}.${process.pid}.tmp`; const fd = fs.openSync(temp, "wx", 0o600); try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, file); fs.chmodSync(file, 0o600);
}
