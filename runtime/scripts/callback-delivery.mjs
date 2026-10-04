const states = new Set(["PENDING", "DRAFT_INSERTED", "SUBMISSION_ATTEMPTED", "DELIVERED"]);

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
