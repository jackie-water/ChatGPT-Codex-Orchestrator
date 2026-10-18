import crypto from "node:crypto";
const states = new Set(["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"]);

export function isValidCallbackId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,160}$/.test(value);
}

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

export function canInsertCallbackDraft({destination, expectedDestination, draft, message, busy = false}) {
  if (destination !== expectedDestination) return {ok:false, reason:"destination-changed"};
  if (busy) return {ok:false, reason:"chat-busy-generating"};
  if (draft && draft !== message) return {ok:false, reason:"draft-changed"};
  return {ok:true};
}

export function isBusyComposerControl(button = {}) {
  const values = [button.aria, button.title, button.text, button.testid]
    .map(value => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return values.some(value =>
    /(?:^|[\s_-])stop(?:[\s_-]|$)/i.test(value) ||
    /stop[\s_-]*generating/i.test(value) ||
    /cancel[\s_-]*generation/i.test(value)
  );
}

export function selectSafeSendButton({destination, expectedDestination, draft, message, busy = false, buttons = []}) {
  // Keep this function self-contained: wake-chat serializes it into the
  // isolated browser Runtime.evaluate VM with Function#toString().
  const safeSendAria = new Set(["send", "send message", "send prompt"]);
  const safeSendTestids = new Set(["composer-send-button", "send-message-button"]);
  const isBusy = (button = {}) => {
    const values = [button.aria, button.title, button.text, button.testid]
      .map(value => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return values.some(value =>
      /(?:^|[\s_-])stop(?:[\s_-]|$)/i.test(value) ||
      /stop[\s_-]*generating/i.test(value) ||
      /cancel[\s_-]*generation/i.test(value)
    );
  };
  const isExcluded = (button = {}) => /(?:feedback|submit)/i.test(String(button.testid || ""));
  if (destination !== expectedDestination || busy || draft !== message || buttons.some(isBusy)) return -1;
  const candidates = buttons.filter(button => !button.disabled && !isBusy(button) && !isExcluded(button));
  const accessible = candidates.findIndex(button => safeSendAria.has(String(button.aria || "").trim().toLowerCase()));
  if (accessible >= 0) return buttons.indexOf(candidates[accessible]);
  return candidates.findIndex(button => safeSendTestids.has(String(button.testid || "").trim().toLowerCase())) >= 0
    ? buttons.indexOf(candidates.find(button => safeSendTestids.has(String(button.testid || "").trim().toLowerCase())))
    : -1;
}

export function nextDeliveryState(state, next) {
  if (!states.has(state) || !states.has(next)) throw new Error("Invalid callback delivery state");
  const allowed = {
    PENDING: new Set(["PENDING", "DRAFT_INSERTED"]),
    DRAFT_INSERTED: new Set(["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED"]),
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
  try {
    const result = await send();
    if (result && result.clicked === false) {
      update("PENDING");
      return {action:"not-sent", state:"PENDING", result};
    }
    update(nextDeliveryState("DRAFT_INSERTED", "SUBMISSION_ATTEMPTED"));
    return {action:"sent", result};
  } catch (error) {
    if (error.code === "PRE_SEND_NOT_READY" || error.code === "NO_SEND_CLICK") update("PENDING");
    else if (error.code === "SUBMISSION_AMBIGUOUS" || error.submissionAttempted === true) update("SUBMISSION_ATTEMPTED");
    throw error;
  }
}
