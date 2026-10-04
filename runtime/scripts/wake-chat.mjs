import fs from "node:fs";
import path from "node:path";
const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error("WAKE_CHAT_FAILED: missing message");
  process.exit(2);
}

const port = process.env.ORCHESTRATOR_BROWSER_DEBUG_PORT || "9333";
const expected = process.env.ORCHESTRATOR_CHAT_URL || "";
const callbackId = process.env.CODEX_CALLBACK_ID || "";
const callbackStateFile = process.env.CODEX_CALLBACK_STATE_FILE || "";
if (!expected) {
  console.error("WAKE_CHAT_FAILED: exact Chat destination is required");
  process.exit(2);
}

function updateDeliveryState(state, extra = {}) {
  if (!callbackStateFile) return;
  try {
    const current = fs.existsSync(callbackStateFile)
      ? JSON.parse(fs.readFileSync(callbackStateFile,"utf8").replace(/^\uFEFF/,""))
      : {};
    const next = {
      ...current,
      ...extra,
      routing_version:"explicit-route-v1",
      callback_id:callbackId || current.callback_id,
      chat_url:expected || current.chat_url,
      delivery_state:state,
      delivery_updated_at_utc:new Date().toISOString()
    };
    const temp=callbackStateFile+"."+process.pid+".tmp";
    fs.mkdirSync(path.dirname(callbackStateFile),{recursive:true});
    fs.writeFileSync(temp,JSON.stringify(next,null,2)+"\n","utf8");
    fs.renameSync(temp,callbackStateFile);
  } catch (err) {
    console.warn("CALLBACK_STATE_UPDATE_FAILED:",err.message);
  }
}

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
    const text = (el.innerText ?? el.value ?? el.textContent ?? '').trim();
    return {ok:true, text};
  })()`);
}

async function clearKnownAutomationDraft(send, draftText) {
  const knownAutomationDraft =
    draftText.startsWith("[ORCHESTRATOR-AUTO") ||
    draftText.startsWith("[CODEX-AUTO") ||
    draftText.startsWith("[CODE-REVIEW-AUTO") ||
    draftText.startsWith("[MERGE-AUTO") ||
    draftText.startsWith("Orchestrator wake test") ||
    draftText.startsWith("Orchestrator Codex completed.");

  if (!knownAutomationDraft) {
    throw new Error("Composer already contains a non-automation draft; refusing to overwrite it: " + JSON.stringify(draftText.slice(0,120)));
  }

  // Composer is already focused. Clear only known stale automation text.
  await send("Input.dispatchKeyEvent", {
    type:"keyDown", key:"a", code:"KeyA",
    modifiers:2,
    windowsVirtualKeyCode:65, nativeVirtualKeyCode:65
  });
  await send("Input.dispatchKeyEvent", {
    type:"keyUp", key:"a", code:"KeyA",
    modifiers:2,
    windowsVirtualKeyCode:65, nativeVirtualKeyCode:65
  });
  await send("Input.dispatchKeyEvent", {
    type:"keyDown", key:"Backspace", code:"Backspace",
    windowsVirtualKeyCode:8, nativeVirtualKeyCode:8
  });
  await send("Input.dispatchKeyEvent", {
    type:"keyUp", key:"Backspace", code:"Backspace",
    windowsVirtualKeyCode:8, nativeVirtualKeyCode:8
  });

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const state = await composerState(send);
    if (state?.ok && !state.text) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Could not clear stale orchestrator automation draft safely");
}

async function insertText(send, text) {
  const before = await composerState(send);
  if (!before?.ok) throw new Error("Composer disappeared before input");

  if (before.text) {
    if (callbackId && before.text.includes(callbackId)) {
      console.log("PENDING_CALLBACK_DRAFT_REUSED:", callbackId);
      return before;
    }
    console.log("STALE_AUTOMATION_DRAFT_FOUND:", JSON.stringify(before.text.slice(0,120)));
    await clearKnownAutomationDraft(send, before.text);
    console.log("STALE_AUTOMATION_DRAFT_CLEARED");
  }

  // React-controlled textarea/input needs its native value setter + input event.
  // ProseMirror/contenteditable is more reliable through CDP Input.insertText.
  const direct = await evaluate(send,
    "(() => {" +
    "const el=document.querySelector('[data-orchestrator-composer=\"true\"]');" +
    "if(!el) return {ok:false,reason:'composer missing'};" +
    "el.focus();" +
    "const text=" + JSON.stringify(text) + ";" +
    "if(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement){" +
      "const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;" +
      "const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;" +
      "if(setter) setter.call(el,text); else el.value=text;" +
      "el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));" +
      "el.dispatchEvent(new Event('change',{bubbles:true}));" +
      "return {ok:true,mode:'native-value'};" +
    "}" +
    "return {ok:true,mode:'cdp'};" +
    "})()"
  );

  if (direct?.mode === "cdp") {
    await send("Input.insertText", { text });
  }

  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const state = await composerState(send);
    if (state?.text && (callbackId ? state.text.includes(callbackId) : state.text.includes(text.slice(0, Math.min(60, text.length))))) return state;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Text reached the browser but the ChatGPT composer state did not register it");
}
async function userMessageState(send) {
  return evaluate(send, `(() => {
    const structuredNodes = [...document.querySelectorAll('[data-testid^="conversation-turn-"][data-turn="user"]')];
    const roleNodes = [
      ...structuredNodes,
      ...[...document.querySelectorAll('[data-message-author-role="user"]')]
        .filter(node => !structuredNodes.some(turn => turn.contains(node)))
    ];
    return {
      count: roleNodes.length,
      last: roleNodes.length ? (roleNodes[roleNodes.length - 1].innerText || roleNodes[roleNodes.length - 1].textContent || '').trim() : '',
      bodyText: (document.body.innerText || '').slice(-30000)
    };
  })()`);
}

async function confirmSubmission(send, beforeCount, text, timeoutMs = 15000) {
  const normalized = text.replace(/\\s+/g, ' ').trim();
  const prefix = normalized.slice(0, Math.min(100, normalized.length));
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const state = await userMessageState(send);
    const last = (state?.last || '').replace(/\\s+/g, ' ').trim();
    const composer = await composerState(send);
    if ((state?.count || 0) > beforeCount && (last === normalized || last.includes(prefix))) {
      return {ok:true, verifiedBy:"committed-user-turn", userMessageCount:state.count, last};
    }

    // A cleared composer or matching text elsewhere in the page is not
    // sufficient proof of delivery. Only a newly committed user-role
    // message can mark the callback DELIVERED.
    await new Promise(r => setTimeout(r, 250));
  }

  const state = await userMessageState(send);
  const composer = await composerState(send);
  throw new Error("Send action was issued but ChatGPT did not confirm a new user message. State: " + JSON.stringify({
    userRoleCount:state?.count || 0,
    lastUserRoleText:state?.last || '',
    composer,
    renderedTextFound:(state?.bodyText || '').replace(/\\s+/g,' ').includes(prefix)
  }));
}

async function sendMessage(send) {
  // Wait for ChatGPT to become idle and expose a real Send button.
  // Never submit a form or synthesize Enter while a Stop/generating control is active.
  for (let i = 0; i < 120; i++) {
    const clicked = await evaluate(send, `(() => {
      const composer = document.querySelector('[data-orchestrator-composer="true"]');
      if (!composer) return {ok:false, reason:'composer missing'};

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

      if (sendButton) {
        sendButton.el.click();
        return {
          ok:true,
          method:'button-click',
          button:{aria:sendButton.aria,testid:sendButton.testid,title:sendButton.title,type:sendButton.type,text:sendButton.text}
        };
      }

      if (busy) return {ok:false, reason:'chat-busy-generating'};

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

  throw new Error("ChatGPT did not expose a usable Send control within 60 seconds; callback will be retried later");
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

    const composer = await waitForComposer(send);
    console.log("CHAT_COMPOSER_FOUND:", JSON.stringify(composer));

    if (callbackId) {
      const alreadyDelivered = await evaluate(send,
        "(() => [...document.querySelectorAll('[data-message-author-role=\"user\"],article[data-testid^=\"conversation-turn-\"][data-turn=\"user\"],[data-testid^=\"conversation-turn-\"][data-turn=\"user\"]')].some(n => ((n.innerText || n.textContent || '')).includes(" + JSON.stringify(callbackId) + ")))()"
      );
      if (alreadyDelivered) {
        updateDeliveryState("DELIVERED",{verified_by:"existing-user-message"});
        console.log("CHAT_WAKE_ALREADY_DELIVERED:", callbackId);
        return;
      }
    }

    const beforeMessages = await userMessageState(send);
    const existingComposer = await composerState(send);
    if (!(callbackId && existingComposer?.text?.includes(callbackId))) {
      await insertText(send, message);
    } else {
      console.log("PENDING_CALLBACK_DRAFT_REUSED:", callbackId);
    }
    updateDeliveryState("DRAFT_INSERTED");

    const sendResult = await sendMessage(send);
    console.log("CHAT_WAKE_SENT:", JSON.stringify(sendResult));

    const confirmed = await confirmSubmission(send, beforeMessages?.count || 0, message, 30000);
    updateDeliveryState("DELIVERED",{verified_by:confirmed?.verifiedBy||"submission-confirmed"});
    console.log("CHAT_WAKE_CONFIRMED:", JSON.stringify(confirmed));
  } finally {
    ws.close();
  }
}

main().catch(err => {
  console.error(`WAKE_CHAT_FAILED: ${err.message}`);
  process.exit(1);
});
