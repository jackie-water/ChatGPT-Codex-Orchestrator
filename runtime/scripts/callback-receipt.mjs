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
  return `root=>{const normalizeReceiptText=${normalizeReceiptText.toString()};const out=[];const seen=new Set();const bad='blockquote,pre,code,[contenteditable="true"],textarea,input,[data-orchestrator-composer="true"]';const role=n=>n?.getAttribute?.('data-message-author-role')||n?.getAttribute?.('data-turn');const marker=n=>{for(let x=n;x&&x!==root;x=x.parentElement){if(role(x)==='assistant'||x.matches?.(bad))return null;if(role(x)==='user')return x;if(x.getAttribute?.('data-user-message-bubble')!==null)return x;}return null};const key=n=>{let id='',turn='';for(let x=n;x&&x!==root;x=x.parentElement){id ||= x.getAttribute?.('data-message-id')||'';turn ||= x.getAttribute?.('data-turn-key')||'';const t=x.getAttribute?.('data-testid')||'';if(!turn&&t.startsWith('conversation-turn-'))turn=t;}return turn||id};const nodes=root.querySelectorAll('[data-message-id],[data-user-message-bubble],[data-message-author-role="user"],[data-turn="user"]');for(const n of nodes){const owner=marker(n);if(!owner)continue;const candidate=n.matches?.('[data-user-message-bubble]')?n:(n.querySelector?.('[data-user-message-bubble]')||n);if(candidate.closest?.('blockquote,pre,code,[data-message-author-role="assistant"],[data-turn="assistant"]')||candidate.matches?.(bad))continue;const k=key(candidate);if(!k||seen.has(k))continue;const c=candidate.cloneNode(true);c.querySelectorAll?.('blockquote,pre,code,[data-message-author-role="assistant"],[data-turn="assistant"],[data-orchestrator-composer="true"],[contenteditable="true"],textarea,input').forEach(x=>x.remove());const text=normalizeReceiptText(c.innerText||c.textContent||'');if(text){seen.add(k);out.push({text,key:k});}}return out}`;
}
