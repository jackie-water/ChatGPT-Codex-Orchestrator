import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { callbackReceiptMatches, normalizeReceiptText, receiptMatcherSource, receiptDomSource } from "./callback-receipt.mjs";
import { createCallbackStateStore, assertSafeMutation, deliverCallback, nextDeliveryState, reconcileReceipt } from "./callback-delivery.mjs";
const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error("WAKE_CHAT_FAILED: missing message");
  process.exit(2);
}

const port = process.env.ORCHESTRATOR_BROWSER_DEBUG_PORT || "9333";
const expected = process.env.ORCHESTRATOR_CHAT_URL || "";
const callbackId = process.env.CODEX_CALLBACK_ID || "";
const callbackStateFile = process.env.CODEX_CALLBACK_STATE_FILE || "";
const reconcileOnly = process.env.CODEX_RECONCILE_ONLY === "1";
let expectedFingerprint = process.env.CODEX_CALLBACK_EXPECTED_FINGERPRINT || "";
if (!expected) {
  console.error("WAKE_CHAT_FAILED: exact Chat destination is required");
  process.exit(2);
}

const stateStore = createCallbackStateStore({file:callbackStateFile, expected, callbackId, message, fsModule:fs, pathModule:path, expectedFingerprint});
const readDeliveryState = stateStore.read;
function updateDeliveryState(state, extra = {}) { const nextFingerprint = stateStore.update(state, extra); if (nextFingerprint) { expectedFingerprint = nextFingerprint; console.log("CHAT_STATE_FINGERPRINT:" + nextFingerprint); } return nextFingerprint; }

function fingerprint(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

async function connect(wsUrl) {
  if (typeof WebSocket === "undefined") throw new Error("Node.js 22+ is required for browser wake automation");
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP connection timeout")), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => reject(new Error("CDP websocket error"));
  });

  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message || "CDP error")) : p.resolve(msg.result);
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = id++;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });

  return { ws, send };
}

function score(p) {
  let s = 0;
  const url = p.url || "";
  if (url.startsWith("https://chatgpt.com/")) s += 10;
  if (expected && url === expected) s += 100;
  else if (expected && url.startsWith(expected)) s += 80;
  return s;
}

async function evaluate(send, expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "Runtime.evaluate failed");
  return r?.result?.value;
}

const findComposerExpression = `(() => {
  document.querySelectorAll('[data-orchestrator-composer="true"]').forEach(x => x.removeAttribute('data-orchestrator-composer'));

  const all = [
    ...document.querySelectorAll('textarea'),
    ...document.querySelectorAll('[contenteditable="true"]'),
    ...document.querySelectorAll('input[type="text"]')
  ];

  const candidates = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const visible =
      r.width > 80 &&
      r.height > 20 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.pointerEvents !== 'none';

    if (!visible) continue;

    const attrs = {
      id: el.id || '',
      role: el.getAttribute('role') || '',
      aria: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '',
      cls: typeof el.className === 'string' ? el.className : ''
    };

    let score = 0;
    if (attrs.id === 'prompt-textarea') score += 1000;
    if (/prompt|composer|message/i.test(attrs.id + ' ' + attrs.cls)) score += 150;
    if (/textbox/i.test(attrs.role)) score += 80;
    if (/ask|message|prompt|chat/i.test(attrs.placeholder + ' ' + attrs.aria)) score += 180;
    if (el.closest('form')) score += 220;
    if (el.closest('[data-testid*="composer"],[class*="composer"],[class*="prompt"]')) score += 160;
    if (r.top > innerHeight * 0.55) score += 180;
    score += Math.round((Math.min(r.bottom, innerHeight) / innerHeight) * 120);
    if (r.width > 300) score += 40;

    let node = el;
    const localButtons = [];
    for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
      for (const b of node.querySelectorAll(':scope > button, :scope button')) {
        const label = [
          b.getAttribute('aria-label') || '',
          b.getAttribute('title') || '',
          b.getAttribute('data-testid') || '',
          (b.innerText || b.textContent || '').trim()
        ].join(' ').trim();
        if (label) localButtons.push(label);
      }
      if (localButtons.length > 30) break;
    }

    const localButtonText = localButtons.join(' | ');
    if (/Undo last edit|Redo last edit|Open editor|Add to Space/i.test(localButtonText)) score -= 1000;

    candidates.push({
      el,
      score,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height),
      attrs,
      localButtons: localButtons.slice(0,12)
    });
  }

  candidates.sort((a,b) => b.score - a.score);
  const chosen = candidates[0];

  if (!chosen || chosen.score < 100) {
    return {
      ok:false,
      href:location.href,
      viewport:{w:innerWidth,h:innerHeight},
      candidates:candidates.slice(0,10).map(x => ({
        score:x.score,top:x.top,bottom:x.bottom,width:x.width,height:x.height,attrs:x.attrs,localButtons:x.localButtons
      }))
    };
  }

  chosen.el.setAttribute('data-orchestrator-composer','true');
  chosen.el.scrollIntoView({block:'center',inline:'nearest'});
  chosen.el.focus();

  return {
    ok:true,
    href:location.href,
    score:chosen.score,
    top:chosen.top,
    bottom:chosen.bottom,
    width:chosen.width,
    height:chosen.height,
    attrs:chosen.attrs,
    localButtons:chosen.localButtons
  };
})()`;

async function waitForComposer(send, timeoutMs = 20000) {
  const start = Date.now();
  let last = null;

  while (Date.now() - start < timeoutMs) {
    last = await evaluate(send, findComposerExpression);
    if (last?.ok) return last;
    await new Promise(r => setTimeout(r, 500));
  }

  const diagnostics = await evaluate(send, `(() => ({
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    textareas: [...document.querySelectorAll('textarea')].map(x => ({
      id:x.id, placeholder:x.placeholder, disabled:x.disabled,
      w:Math.round(x.getBoundingClientRect().width),
      h:Math.round(x.getBoundingClientRect().height)
    })).slice(0,10),
    editables: [...document.querySelectorAll('[contenteditable="true"]')].map(x => ({
      id:x.id, cls:x.className, role:x.getAttribute('role'),
      w:Math.round(x.getBoundingClientRect().width),
      h:Math.round(x.getBoundingClientRect().height)
    })).slice(0,10)
  }))()`);

  throw new Error("Could not find usable composer after 20s. Diagnostics: " + JSON.stringify(diagnostics || last));
}

async function composerState(send) {
  return evaluate(send, `(() => {
    const el = document.querySelector('[data-orchestrator-composer="true"]');
    if (!el) return {ok:false, text:null};
    const text = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.innerText ?? el.textContent ?? '')).trim();
    return {ok:true, text};
  })()`);
}

async function insertText(send, text) {
  const direct = await evaluate(send,
    "(() => {" +
    "if(" + JSON.stringify(normalizeConversationUrl(expected)) + ".toString()!==" +
      "(location.origin+location.pathname).toString()) return {ok:false,reason:'destination-changed'};" +
    "const el=document.querySelector('[data-orchestrator-composer=\"true\"]');" +
    "if(!el) return {ok:false,reason:'composer-missing'};" +
    "const current=(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?el.value:(el.innerText??el.textContent??'')).trim();" +
    "const text=" + JSON.stringify(text) + ";" +
    "if(current===text) return {ok:true,reused:true,text:current};" +
    "if(current) return {ok:false,reason:'draft-changed',text:current};" +
    "el.focus();" +
    "if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){" +
      "const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;" +
      "const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;" +
      "if(setter) setter.call(el,text); else el.value=text;" +
      "el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));" +
      "el.dispatchEvent(new Event('change',{bubbles:true}));" +
      "return {ok:true,mode:'native-value'};" +
    "}" +
    "if(!document.execCommand?.('insertText',false,text)) return {ok:false,reason:'contenteditable-insert-failed'};" +
    "return {ok:true,mode:'page-insert'};" +
    "})()"
  );

  if (!direct?.ok) throw new Error("No mutation performed: " + (direct?.reason || "composer unavailable"));
  if (direct.reused) {
    console.log("PENDING_CALLBACK_DRAFT_REUSED:", callbackId);
    return direct;
  }

  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const state = await composerState(send);
    if (state?.text === text) return state;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Text reached the browser but the ChatGPT composer state did not register it");
}

const receiptExpression = receiptMatcherSource();
const receiptDomExpression = `(${receiptDomSource()})`;

async function userMessageState(send) {
  return evaluate(send, `(() => {
    const roleNodes = ${receiptDomExpression}(document);
    return {
      count: roleNodes.length,
      texts: roleNodes.map(x=>x.text)
    };
  })()`);
}

async function hasReceipt(send, callbackId, payload) {
  const result = await evaluate(send, `(() => {
    if ((location.origin + location.pathname) !== ${JSON.stringify(normalizeConversationUrl(expected))}) return false;
    const normalizeReceiptText = ${normalizeReceiptText.toString()};
    const callbackReceiptMatches = ${callbackReceiptMatches.toString()};
    return ${receiptDomExpression}(document).some(x => callbackReceiptMatches(x.text, ${JSON.stringify(callbackId)}, ${JSON.stringify(payload)}));
  })()`);
  return result === true;
}

async function confirmSubmission(send, callbackId, text, timeoutMs = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await hasReceipt(send, callbackId, text)) {
      return {ok:true, verifiedBy:"committed-user-turn"};
    }

    // A cleared composer or matching text elsewhere in the page is not
    // sufficient proof of delivery. Only a newly committed user-role
    // message can mark the callback DELIVERED.
    await new Promise(r => setTimeout(r, 250));
  }

  const state = await userMessageState(send);
  throw new Error("Send action was issued but ChatGPT did not confirm a new user message. State: " + JSON.stringify({
    userRoleCount:state?.count || 0,
    userRoleTexts:state?.texts || []
  }));
}

async function sendMessage(send) {
  // Wait for ChatGPT to become idle and expose a real Send button.
  // Never submit a form or synthesize Enter while a Stop/generating control is active.
  for (let i = 0; i < 120; i++) {
    const clicked = await evaluate(send, `(() => {
      if ((location.origin + location.pathname) !== ${JSON.stringify(normalizeConversationUrl(expected))}) return {ok:false, reason:'destination-changed'};
      const composer = document.querySelector('[data-orchestrator-composer="true"]');
      if (!composer) return {ok:false, reason:'composer missing'};
      const actual = composer instanceof HTMLInputElement || composer instanceof HTMLTextAreaElement ? composer.value : (composer.innerText ?? composer.textContent ?? '');
      if (actual !== ${JSON.stringify(message)}) return {ok:false, reason:'draft-changed'};

      const roots = [];
      let node = composer;
      for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) roots.push(node);

      const seen = new Set();
      const buttons = [];
      for (const root of roots) {
        for (const btn of root.querySelectorAll('button')) {
          if (seen.has(btn)) continue;
          seen.add(btn);
          const r = btn.getBoundingClientRect();
          const style = getComputedStyle(btn);
          if (r.width < 8 || r.height < 8 || style.display === 'none' || style.visibility === 'hidden') continue;
          buttons.push({
            el: btn,
            aria: btn.getAttribute('aria-label') || '',
            testid: btn.getAttribute('data-testid') || '',
            title: btn.getAttribute('title') || '',
            type: btn.getAttribute('type') || '',
            text: (btn.innerText || btn.textContent || '').trim(),
            disabled: !!btn.disabled
          });
        }
      }

      const label = b => [b.aria,b.testid,b.title,b.text].join(' ').toLowerCase();
      const busy = buttons.some(b => !b.disabled && /(^|\\s)(stop|cancel)(\\s|$)|stop generating|cancel generation/.test(label(b)));
      const sendButton = buttons.find(b => !b.disabled && /send/.test(label(b)));

      if (busy) return {ok:false, reason:'chat-busy-generating'};
      if (sendButton) {
        sendButton.el.click();
        return {
          ok:true,
          method:'button-click',
          button:{aria:sendButton.aria,testid:sendButton.testid,title:sendButton.title,type:sendButton.type,text:sendButton.text}
        };
      }

      const submitButton = buttons.find(b => !b.disabled && b.type === 'submit' && !/(stop|cancel)/.test(label(b)));
      if (submitButton) {
        submitButton.el.click();
        return {
          ok:true,
          method:'submit-button-click',
          button:{aria:submitButton.aria,testid:submitButton.testid,title:submitButton.title,type:submitButton.type,text:submitButton.text}
        };
      }

      return {
        ok:false,
        reason:'send-control-not-ready',
        buttons:buttons.map(({aria,testid,title,type,text,disabled})=>({aria,testid,title,type,text,disabled}))
      };
    })()`);

    if (clicked?.ok) {
      console.log("CHAT_SEND_METHOD:", JSON.stringify(clicked));
      return clicked;
    }

    if (i === 0 || i % 20 === 0) console.log("CHAT_SEND_WAIT:", JSON.stringify(clicked));
    await new Promise(r => setTimeout(r, 500));
  }

  const error = new Error("ChatGPT did not expose a usable Send control within 60 seconds; callback will be retried later");
  error.code = "PRE_SEND_NOT_READY";
  throw error;
}

function normalizeConversationUrl(value) {
  try {
    const u = new URL(value);
    return u.origin + u.pathname;
  } catch {
    return value || "";
  }
}

async function listPages() {
  return fetch(`http://127.0.0.1:${port}/json/list`).then(r => {
    if (!r.ok) throw new Error(`Edge debug endpoint returned ${r.status}`);
    return r.json();
  });
}

async function createChatTab(url) {
  const endpoint = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, {method:"PUT"});
  if (!response.ok) throw new Error(`Could not create target Chat tab: ${response.status}`);
  return response.json();
}

async function resolveTargetPage() {
  let pages = await listPages();
  const wanted = normalizeConversationUrl(expected);

  let exact = pages.find(p =>
    p.type === "page" &&
    p.webSocketDebuggerUrl &&
    normalizeConversationUrl(p.url || "") === wanted
  );

  if (!exact) {
    console.log("CHAT_TARGET_TAB_MISSING: creating exact target tab");
    const created = await createChatTab(expected);
    await new Promise(r => setTimeout(r, 1200));

    pages = await listPages();
    exact = pages.find(p =>
      p.type === "page" &&
      p.webSocketDebuggerUrl &&
      normalizeConversationUrl(p.url || "") === wanted
    );

    if (!exact && created?.webSocketDebuggerUrl) exact = created;
  }

  if (!exact?.webSocketDebuggerUrl) {
    throw new Error("Could not open the exact target Chat");
  }
  return exact;
}

async function main() {
  const page = await resolveTargetPage();
  const { ws, send } = await connect(page.webSocketDebuggerUrl);

  try {
    await send("Page.bringToFront");

    const currentUrl = await evaluate(send, "location.href");
    if (expected &&
        normalizeConversationUrl(currentUrl) !== normalizeConversationUrl(expected)) {
      throw new Error("Resolved Chat tab URL does not match the requested callback destination");
    }

    if (callbackId) {
      readDeliveryState();
      const alreadyDelivered = await hasReceipt(send, callbackId, message);
      if (alreadyDelivered) {
        updateDeliveryState("DELIVERED",{verified_by:"existing-user-message"});
        console.log("CHAT_WAKE_ALREADY_DELIVERED:", callbackId);
        return;
      }
    }

    const sendResult = await deliverCallback({
      read: readDeliveryState,
      hasReceipt: () => hasReceipt(send, callbackId, message),
      update: updateDeliveryState,
      beforeSend: async () => {
        const composer = await waitForComposer(send);
        console.log("CHAT_COMPOSER_FOUND:", JSON.stringify(composer));
        const beforeInputUrl = await evaluate(send, "location.href");
        assertSafeMutation({destination:normalizeConversationUrl(beforeInputUrl), expectedDestination:normalizeConversationUrl(expected), draft:"", message});
        await insertText(send, message);
        const verifyDestination = await evaluate(send, "location.href");
        assertSafeMutation({destination:normalizeConversationUrl(verifyDestination), expectedDestination:normalizeConversationUrl(expected), draft:message, message});
      },
      send: () => sendMessage(send),
      allowSend: !reconcileOnly
    });
    if (sendResult.action !== "sent") {
      console.log(sendResult.action === "reconciled" ? "CHAT_WAKE_ALREADY_DELIVERED:" : "CHAT_RECONCILE_PENDING:", callbackId);
      process.exitCode = sendResult.action === "reconciled" ? 0 : 3;
      return;
    }
    console.log("CHAT_WAKE_SENT:", JSON.stringify(sendResult.result));

    const confirmed = await confirmSubmission(send, callbackId, message, 30000);
    updateDeliveryState(reconcileReceipt({state:"SUBMISSION_ATTEMPTED", receiptMatches:true}),{verified_by:confirmed?.verifiedBy||"submission-confirmed"});
    console.log("CHAT_WAKE_CONFIRMED:", JSON.stringify(confirmed));
  } finally {
    ws.close();
  }
}

main().catch(err => {
  console.error(`WAKE_CHAT_FAILED: ${err.message}`);
  process.exit(1);
});
