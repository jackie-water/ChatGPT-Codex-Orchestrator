export function normalizeReceiptText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function callbackReceiptMatches(value, callbackId, payload) {
  const text = normalizeReceiptText(value);
  const expected = normalizeReceiptText(payload);
  const escapedId = String(callbackId ?? "").replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&");
  const header = new RegExp("^\\[[^\\]]+\\s+callback_id=" + escapedId + "\\]\\s");
  return Boolean(callbackId && expected && header.test(text) && text === expected);
}

export function receiptMatcherSource() {
  return `(()=>{${normalizeReceiptText.toString()};${callbackReceiptMatches.toString()};return callbackReceiptMatches})()`;
}
