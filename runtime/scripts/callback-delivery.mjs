import crypto from "node:crypto";
const states = new Set(["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"]);

export function createCallbackStateStore({file, expected, callbackId, message, fsModule, pathModule, expectedFingerprint = "", now = () => new Date().toISOString()}) {
  const fs = fsModule;
  const path = pathModule;
  let currentFingerprint = expectedFingerprint;
  const fingerprint = () => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const read = () => {
    if (!file) return null;
    if (!fs.existsSync(file)) throw new Error("Callback state disappeared");
    if (currentFingerprint && fingerprint() !== currentFingerprint) throw new Error("Callback state fingerprint changed");
    const current = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    validateCallbackState(current, {callbackId, chatUrl:expected, message});
    return current;
  };
  const update = (state, extra = {}) => {
    if (!file) return;
    if (!fs.existsSync(file)) throw new Error("Callback state disappeared");
    if (currentFingerprint && fingerprint() !== currentFingerprint) throw new Error("Callback state fingerprint changed");
    const current = read();
    const next = {...current, ...extra, routing_version:"explicit-route-v1", callback_id:callbackId || current.callback_id, chat_url:expected || current.chat_url, delivery_state:state, delivery_updated_at_utc:now()};
    const temp = file + "." + process.pid + ".tmp";
    fs.mkdirSync(path.dirname(file), {recursive:true});
    fs.writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", "utf8");
    fs.renameSync(temp, file);
    currentFingerprint = fingerprint();
    return currentFingerprint;
  };
  return {read, update};
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
  update(nextDeliveryState("DRAFT_INSERTED", "SUBMISSION_ATTEMPTED"));
  try {
    const result = await send();
    return {action:"sent", result};
  } catch (error) {
    if (error.code === "PRE_SEND_NOT_READY") update("PENDING");
    throw error;
  }
}
