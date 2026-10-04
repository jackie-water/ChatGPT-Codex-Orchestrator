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

export function receiptDomSource() {
  return `root=>{const normalizeReceiptText=${normalizeReceiptText.toString()};const out=[];const seen=new Set();const owned=n=>{let node=n;let user=false;while(node&&node!==root){const role=node.getAttribute?.('data-message-author-role')||node.getAttribute?.('data-turn');if(role==='assistant'||node.matches?.('[contenteditable="true"],textarea,input,[data-orchestrator-composer="true"]'))return false;if(role==='user')user=true;node=node.parentElement;}return user;};const key=n=>{let node=n;while(node&&node!==root){const turn=node.getAttribute?.('data-turn-key');if(turn)return turn;const testid=node.getAttribute?.('data-testid');if(testid?.startsWith('conversation-turn-'))return testid;node=node.parentElement;}return '';};for(const n of root.querySelectorAll('[data-message-author-role="user"],[data-turn="user"],[data-user-message-bubble]')){const bubble=n.matches('[data-user-message-bubble]')?n:n.querySelector('[data-user-message-bubble]');const candidate=bubble||n;if(!owned(candidate))continue;const k=key(candidate);if(!k||seen.has(k))continue;const c=candidate.cloneNode(true);c.querySelectorAll('blockquote,pre,code,[data-message-author-role="assistant"],[data-turn="assistant"],[data-orchestrator-composer="true"],[contenteditable="true"],textarea,input').forEach(x=>x.remove());const text=normalizeReceiptText(c.innerText||c.textContent||'');if(text){seen.add(k);out.push({text,key:k});}}return out}`;
}
