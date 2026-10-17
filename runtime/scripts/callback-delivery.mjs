import crypto from "node:crypto";
const states = new Set(["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"]);

export function isValidCallbackId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,160}$/.test(value);
}

function secureAncestors(fs, path, target) {
  const absolute = path.resolve(target);
  const ancestors = [];
  let current = path.dirname(absolute);
  while (true) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const ancestor of ancestors.reverse()) {
    const stat = fs.lstatSync(ancestor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe callback state ancestor: ${ancestor}`);
    const mode = stat.mode & 0o7777;
    if ((mode & 0o002) && !(mode & 0o1000)) throw new Error(`Insecure callback state ancestor permissions: ${ancestor}`);
    if (typeof process.getuid === "function" && typeof stat.uid === "number" && stat.uid !== process.getuid() && (mode & 0o002) && !(mode & 0o1000)) throw new Error(`Foreign callback state ancestor: ${ancestor}`);
  }
  return absolute;
}

function assertSecureTarget(fs, path, file) {
  const absolute = path.resolve(file);
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe callback state file: ${absolute}`);
  if (typeof process.getuid === "function" && typeof stat.uid === "number" && stat.uid !== process.getuid()) throw new Error(`Foreign callback state file: ${absolute}`);
  return true;
}

function atomicWrite(fs, path, file, value, platform = process.platform) {
  const absolute = secureAncestors(fs, path, file);
  const dir = path.dirname(absolute);
  const temp = `${absolute}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    const noFollow = fs.constants?.O_NOFOLLOW || 0;
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, absolute);
    if (platform !== "win32") {
      // POSIX directory fsync closes the rename durability window. Windows
      // does not support opening a directory this way (EPERM/EISDIR); the
      // file fsync and atomic rename above remain mandatory there, with this
      // bounded directory-durability limitation.
      const parentFd = fs.openSync(dir, fs.constants.O_RDONLY);
      try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
    }
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function sameFileIdentity(left, right) {
  return typeof left?.dev === "number" && typeof left?.ino === "number" && left.dev === right.dev && left.ino === right.ino;
}

function cleanupFailedLockAcquisition(fs, path, lock, fd, owner, platform) {
  // Keep fd open while proving that the pathname still names our private file.
  let fdClosed = false;
  let pathStat;
  let openedStat;
  try {
    pathStat = fs.lstatSync(lock);
    openedStat = fs.fstatSync(fd);
    if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1 ||
        (pathStat.mode & 0o7777) !== 0o600 || !sameFileIdentity(openedStat, pathStat)) return;
    if (typeof process.getuid === "function" && typeof pathStat.uid === "number" && pathStat.uid !== process.getuid()) return;
    try {
      const contents = fs.readFileSync(lock, "utf8");
      if (contents && !owner.startsWith(contents) && contents !== owner) return;
    } catch { return; }
    // Recheck immediately before unlink; pathname compare-and-delete is not an
    // atomic defense against an arbitrary same-user race in the final syscall.
    const finalPathStat = fs.lstatSync(lock);
    const finalOpenedStat = fs.fstatSync(fd);
    if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile() || finalPathStat.nlink !== 1 ||
        (finalPathStat.mode & 0o7777) !== 0o600 || !sameFileIdentity(finalOpenedStat, finalPathStat)) return;
    if (typeof process.getuid === "function" && typeof finalPathStat.uid === "number" && finalPathStat.uid !== process.getuid()) return;
    if (platform === "win32") {
      // Windows commonly rejects unlinking an open file. Mark the descriptor
      // closed before calling closeSync so the caller never double-closes it.
      fdClosed = true;
      try { fs.closeSync(fd); } catch { return fdClosed; }
      const afterClose = fs.lstatSync(lock);
      if (afterClose.isSymbolicLink() || !afterClose.isFile() || afterClose.nlink !== 1 ||
          (afterClose.mode & 0o7777) !== (pathStat.mode & 0o7777) ||
          (typeof afterClose.uid === "number" && typeof pathStat.uid === "number" && afterClose.uid !== pathStat.uid) ||
          !sameFileIdentity(openedStat, afterClose)) return fdClosed;
      fs.unlinkSync(lock);
      return fdClosed;
    }
    fs.unlinkSync(lock);
    const parentFd = fs.openSync(path.dirname(lock), fs.constants.O_RDONLY);
    try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
    return false;
  } catch {
    // Uncertainty about identity, replacement, or durability fails closed.
    return fdClosed;
  }
}

function acquireLock(fs, path, file, callbackId, platform = process.platform) {
  const lock = secureAncestors(fs, path, `${file}.delivery.lock`);
  let fd;
  const token = crypto.randomBytes(16).toString("hex");
  const owner = JSON.stringify({version:1, callback_id:callbackId, pid:process.pid, token}) + "\n";
  try {
    const noFollow = fs.constants?.O_NOFOLLOW || 0;
    fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
    fs.writeFileSync(fd, owner, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) {
      const closed = cleanupFailedLockAcquisition(fs, path, lock, fd, owner, platform);
      if (!closed) { try { fs.closeSync(fd); } catch {} }
    }
    if (error.code === "EEXIST") {
      let detail = "foreign or active owner";
      try {
        const stat = fs.lstatSync(lock);
        if (stat.isSymbolicLink() || !stat.isFile()) detail = "symlink or non-file owner";
        else detail = JSON.parse(fs.readFileSync(lock, "utf8")).callback_id === callbackId ? "active callback owner" : "foreign callback owner";
      } catch {}
      throw new Error(`Callback delivery lock is occupied (${detail}); inspect and remove it only after deterministic crash recovery`);
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const stat = fs.lstatSync(lock);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Callback delivery lock was replaced");
      const current = JSON.parse(fs.readFileSync(lock, "utf8"));
      if (current.token !== token || current.pid !== process.pid) throw new Error("Callback delivery lock owner changed");
      const opened = fs.fstatSync(fd);
      if (!sameFileIdentity(opened, stat)) throw new Error("Callback delivery lock was replaced");
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    } catch (error) {
      try { fs.closeSync(fd); } catch {}
      throw error;
    }
  };
}

export function createCallbackStateStore({file, expected, callbackId, message, fsModule, pathModule, expectedFingerprint = "", now = () => new Date().toISOString(), platform = process.platform}) {
  const fs = fsModule;
  const path = pathModule;
  let currentFingerprint = expectedFingerprint;
  const fingerprint = () => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const read = () => {
    if (!file) return null;
    secureAncestors(fs, path, file);
    if (!assertSecureTarget(fs, path, file)) throw new Error("Callback state disappeared");
    if (currentFingerprint && fingerprint() !== currentFingerprint) throw new Error("Callback state fingerprint changed");
    const current = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    validateCallbackState(current, {callbackId, chatUrl:expected, message});
    return current;
  };
  const update = (state, extra = {}) => {
    if (!file) return;
    secureAncestors(fs, path, file);
    if (!assertSecureTarget(fs, path, file)) throw new Error("Callback state disappeared");
    if (currentFingerprint && fingerprint() !== currentFingerprint) throw new Error("Callback state fingerprint changed");
    const current = read();
    const next = {...current, ...extra, routing_version:"explicit-route-v1", callback_id:callbackId || current.callback_id, chat_url:expected || current.chat_url, delivery_state:state, delivery_updated_at_utc:now()};
    atomicWrite(fs, path, file, next, platform);
    currentFingerprint = fingerprint();
    return currentFingerprint;
  };
  const withLock = async fn => {
    if (!file) return fn();
    const release = acquireLock(fs, path, file, callbackId, platform);
    try { return await fn(); } finally { release(); }
  };
  return {read, update, withLock};
}

export function validateCallbackState(current, expected) {
  if (!current || current.routing_version !== "explicit-route-v1" || !states.has(current.delivery_state) ||
      current.callback_id !== expected.callbackId || current.chat_url !== expected.chatUrl || current.message !== expected.message) {
    throw new Error("Invalid callback state");
  }
  return current;
}

export function assertSafeMutation({destination, expectedDestination, draft, message}) {
  if (destination !== expectedDestination) throw new Error("Callback destination changed before input");
  if (draft && draft !== message) throw new Error("No mutation performed: draft-changed");
}

export function nextDeliveryState(state, next) {
  if (!states.has(state) || !states.has(next)) throw new Error("Invalid callback delivery state");
  const allowed = {
    PENDING: new Set(["PENDING", "DRAFT_INSERTED"]),
    DRAFT_INSERTED: new Set(["DRAFT_INSERTED", "SUBMISSION_ATTEMPTED"]),
    SUBMISSION_ATTEMPTED: new Set(["SUBMISSION_ATTEMPTED", "DELIVERED"]),
    DELIVERED: new Set(["DELIVERED"])
  };
  if (!allowed[state].has(next)) throw new Error("Invalid callback delivery state");
  return next;
}

export function sendGate({state, destination, expectedDestination, draft, message}) {
  if (state !== "SUBMISSION_ATTEMPTED") throw new Error("Invalid callback delivery state");
  assertSafeMutation({destination, expectedDestination, draft, message});
  return true;
}

export function reconcileReceipt({state, receiptMatches}) {
  if (!["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"].includes(state)) throw new Error("Invalid callback delivery state");
  return receiptMatches ? "DELIVERED" : state;
}

export async function deliverCallback({read, hasReceipt, send, update, beforeSend = async () => {}, allowSend = true}) {
  const stored = read();
  if (!stored) {
    if (!allowSend) return {action:"reconcile", state:"PENDING"};
    await beforeSend();
    return {action:"sent", result:await send()};
  }
  if (!states.has(stored.delivery_state)) throw new Error("Invalid callback delivery state");
  if (await hasReceipt()) {
    if (stored.delivery_state !== "DELIVERED") update("DELIVERED", {verified_by:"existing-user-message"});
    return {action:"reconciled", state:"DELIVERED"};
  }
  if (stored.delivery_state !== "PENDING" || !allowSend) return {action:"reconcile", state:stored.delivery_state};
  await beforeSend();
  update(nextDeliveryState("PENDING", "DRAFT_INSERTED"));
  let attemptJournaled = false;
  const beforeClick = () => {
    if (!attemptJournaled) {
      update(nextDeliveryState("DRAFT_INSERTED", "SUBMISSION_ATTEMPTED"));
      attemptJournaled = true;
    }
  };
  try {
    // A real sender invokes beforeClick immediately before the irreversible
    // browser click. Test/legacy senders that do not accept the hook are kept
    // compatible by journaling after their successful return.
    const result = await send({beforeClick});
    if (!attemptJournaled) beforeClick();
    return {action:"sent", result};
  } catch (error) {
    // PRE_SEND_NOT_READY proves no Send control was exposed and beforeClick
    // never ran, so this one case is a durable safe retry. Any other error,
    // or any journaled attempt, remains reconcile-only.
    if (error.code === "PRE_SEND_NOT_READY" && !attemptJournaled) update("PENDING");
    throw error;
  }
}
