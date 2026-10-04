export function normalizeReceiptText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function callbackReceiptMatches(value, callbackId, payload) {
  const text = normalizeReceiptText(value);
  const expected = normalizeReceiptText(payload);
  const header = new RegExp("^\\[[^\\]]+\\s+callback_id=" + callbackId + "\\]\\s");
  return Boolean(callbackId && expected && header.test(text) && text === expected);
}

export function receiptMatcherSource() {
  return `(${callbackReceiptMatches.toString()})`;
}
