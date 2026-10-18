import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { callbackReceiptMatches, normalizeReceiptText, receiptMatcherSource, receiptDomSource } from "./callback-receipt.mjs";
import { createCallbackStateStore, assertSafeMutation, canInsertCallbackDraft, selectSafeSendButton, isBusyComposerControl, deliverCallback, nextDeliveryState, reconcileReceipt, isValidCallbackId } from "./callback-delivery.mjs";
const message = process.argv.slice(2).join(" ");
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync.native(path.resolve(process.argv[1])) === fs.realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isMain = isMainModule();
if (isMain && !message.trim()) {
  console.error("WAKE_CHAT_FAILED: missing message");
  process.exit(2);
}

const port = process.env.ORCHESTRATOR_BROWSER_DEBUG_PORT || "9333";
const expected = process.env.ORCHESTRATOR_CHAT_URL || "";
const callbackId = process.env.CODEX_CALLBACK_ID || "";
const callbackStateFile = process.env.CODEX_CALLBACK_STATE_FILE || "";
const reconcileOnly = process.env.CODEX_RECONCILE_ONLY === "1";
const wakeBudgetMs = Number(process.env.CODEX_WAKE_DEADLINE_MS || 130000);
const wakeDeadlineAt = Date.now() + (Number.isFinite(wakeBudgetMs) && wakeBudgetMs > 0 ? wakeBudgetMs : 130000);
function remainingMs() { return Math.max(0, wakeDeadlineAt - Date.now()); }
function boundedMs(requested) { return Math.min(requested, remainingMs()); }
function assertWakeTime() { if (remainingMs() <= 0) { const error = new Error("Callback wake deadline exceeded"); error.code = "WAKE_DEADLINE_EXCEEDED"; throw error; } }
function deadlineError() { const error = new Error("Callback wake deadline exceeded"); error.code = "WAKE_DEADLINE_EXCEEDED"; return error; }
function sleep(requested) {
  assertWakeTime();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, boundedMs(requested));
    if (remainingMs() <= 0) { clearTimeout(timer); reject(deadlineError()); }
  });
}
async function fetchWithDeadline(url, options = {}) {
  assertWakeTime();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(deadlineError()), boundedMs(5000));
  try {
    return await fetch(url, {...options, signal:controller.signal});
  } catch (error) {
    if (controller.signal.aborted && remainingMs() <= 0) throw deadlineError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
let expectedFingerprint = process.env.CODEX_CALLBACK_EXPECTED_FINGERPRINT || "";
if (isMain && !isValidCallbackId(callbackId)) {
  console.error("WAKE_CHAT_FAILED: valid CODEX_CALLBACK_ID is required (1-160 ASCII letters, digits, '.', '_', or '-')");
  process.exit(2);
}
if (isMain && !expected) {
  console.error("WAKE_CHAT_FAILED: exact Chat destination is required");
  process.exit(2);
}

const stateStore = createCallbackStateStore({file:callbackStateFile, expected, callbackId, message, fsModule:fs, pathModule:path, expectedFingerprint});
const readDeliveryState = stateStore.read;
function updateDeliveryState(state, extra = {}) { const nextFingerprint = stateStore.update(state, extra); if (nextFingerprint) { expectedFingerprint = nextFingerprint; console.log("CHAT_STATE_FINGERPRINT:" + nextFingerprint); } return nextFingerprint; }

function fingerprint(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

async function connect(wsUrl) {
  if (typeof WebSocket === "undefined") throw new Error("Node.js 22+ is required for browser wake automation");
  assertWakeTime();
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error("CDP connection timeout")); }, boundedMs(5000));
    const cleanup = () => { clearTimeout(timer); ws.onopen = null; ws.onerror = null; };
    ws.onopen = () => { cleanup(); resolve(); };
    ws.onerror = () => { cleanup(); reject(new Error("CDP websocket error")); };
  });

  ws.onmessage = event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.error ? p.reject(new Error(msg.error.message || "CDP error")) : p.resolve(msg.result);
  };
  ws.onerror = () => {
    for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(new Error("CDP websocket error")); }
    pending.clear();
  };
  ws.onclose = () => {
    for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(new Error("CDP websocket closed")); }
    pending.clear();
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    assertWakeTime();
    const callId = id++;
    const timer = setTimeout(() => {
      pending.delete(callId);
      reject(remainingMs() <= 0 ? deadlineError() : new Error(`CDP ${method} timeout`));
    }, boundedMs(10000));
    pending.set(callId, {resolve, reject, timer});
    try { ws.send(JSON.stringify({ id: callId, method, params })); }
    catch (error) { clearTimeout(timer); pending.delete(callId); reject(error); }
  });

  return { ws, send, close: () => {
    for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(new Error("CDP connection closed")); }
    pending.clear();
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
  }};
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
  assertWakeTime();
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
    const busy = localButtons.some(x => /(^|\\s)(stop|cancel)(\\s|$)|stop generating|cancel generation/i.test(x));

    candidates.push({
      el,
      score,
      busy,
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
        score:x.score,busy:x.busy,top:x.top,bottom:x.bottom,width:x.width,height:x.height,attrs:x.attrs,localButtons:x.localButtons
      }))
    };
  }

  chosen.el.setAttribute('data-orchestrator-composer','true');
  chosen.el.scrollIntoView({block:'center',inline:'nearest'});
  chosen.el.focus();

  return {
    ok:true,
    busy:chosen.busy,
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

async function waitForComposer(send, timeoutMs = 130000) {
  const start = Date.now();
  const phaseDeadline = start + Math.min(timeoutMs, remainingMs());
  let last = null;

  while (Date.now() < phaseDeadline) {
    assertWakeTime();
    last = await evaluate(send, findComposerExpression);
    if (last?.ok && !last.busy) return last;
    await sleep(500);
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

  throw new Error("Could not find usable composer before the wake deadline. Diagnostics: " + JSON.stringify(diagnostics || last));
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
    "const canInsert=" + canInsertCallbackDraft.toString() + ";" +
    "const busy=[...(el.closest('form')?.querySelectorAll('button')||[])].some(b=>/(^|\\s)(stop|cancel)(\\s|$)|stop generating|cancel generation/i.test([b.getAttribute('aria-label')||'',b.getAttribute('title')||'',b.innerText||b.textContent||''].join(' ')));" +
    "const guard=canInsert({destination:location.origin+location.pathname,expectedDestination:" + JSON.stringify(normalizeConversationUrl(expected)) + ",draft:current,message:text,busy});" +
    "if(!guard.ok) return {ok:false,reason:guard.reason,text:current};" +
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
    await sleep(100);
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
  const phaseDeadline = start + Math.min(timeoutMs, remainingMs());

  while (Date.now() < phaseDeadline) {
    assertWakeTime();
    if (await hasReceipt(send, callbackId, text)) {
      return {ok:true, verifiedBy:"committed-user-turn"};
    }

    // A cleared composer or matching text elsewhere in the page is not
    // sufficient proof of delivery. Only a newly committed user-role
    // message can mark the callback DELIVERED.
    await sleep(250);
  }

  const state = await userMessageState(send);
  throw new Error("Send action was issued but ChatGPT did not confirm a new user message. State: " + JSON.stringify({
    userRoleCount:state?.count || 0,
    userRoleLengths:(state?.texts || []).map(text => String(text).length)
  }));
}

async function sendMessage(send) {
  // Wait for ChatGPT to become idle and expose a real Send button.
  // Never submit a form or synthesize Enter while a Stop/generating control is active.
  for (let i = 0; i < 120 && remainingMs() > 0; i++) {
    let clicked;
    try {
      clicked = await evaluate(send, `(() => {
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

      const busy = buttons.some(b => ${isBusyComposerControl.toString()}(b));
      const select = ${selectSafeSendButton.toString()};
      const sendIndex = select({destination:location.origin + location.pathname, expectedDestination:${JSON.stringify(normalizeConversationUrl(expected))}, draft:actual, message:${JSON.stringify(message)}, busy, buttons});
      if (sendIndex >= 0) {
        buttons[sendIndex].el.click();
        return {
          ok:true,
          clicked:true,
          method:'button-click',
          button:{aria:buttons[sendIndex].aria,testid:buttons[sendIndex].testid,title:buttons[sendIndex].title,type:buttons[sendIndex].type,text:buttons[sendIndex].text}
        };
      }

      return {
        ok:false,
        reason:'send-control-not-ready',
        buttons:buttons.map(({aria,testid,title,type,text,disabled})=>({aria,testid,title,type,text,disabled}))
      };
      })()`);
    } catch (error) {
      error.code = "SUBMISSION_AMBIGUOUS";
      error.submissionAttempted = true;
      throw error;
    }

    if (clicked?.ok) {
      console.log("CHAT_SEND_METHOD:", JSON.stringify(clicked));
      return clicked;
    }

    if (i === 0 || i % 20 === 0) console.log("CHAT_SEND_WAIT:", JSON.stringify(clicked));
    await sleep(500);
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

export function wakeDestinationMatches(actual, wanted) {
  return normalizeConversationUrl(actual) === normalizeConversationUrl(wanted);
}

async function listPages() {
  return fetchWithDeadline(`http://127.0.0.1:${port}/json/list`).then(r => {
    if (!r.ok) throw new Error(`Edge debug endpoint returned ${r.status}`);
    return r.json();
  });
}

async function createChatTab(url) {
  const endpoint = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`;
  const response = await fetchWithDeadline(endpoint, {method:"PUT"});
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
    await sleep(1200);

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
  const { send, close } = await connect(page.webSocketDebuggerUrl);

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
    close();
  }
}

if (isMain) main().catch(err => {
  console.error(`WAKE_CHAT_FAILED: ${err.message}`);
  process.exit(1);
});
