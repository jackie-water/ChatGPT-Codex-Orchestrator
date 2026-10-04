import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const wake=()=>fs.readFileSync(new URL("../runtime/scripts/wake-chat.mjs",import.meta.url),"utf8");


test("callback delivery requires a committed user-role message",()=>{
  const text=wake();
  assert.match(text,/data-message-author-role=\\"user\\"/);
  assert.match(text,/Only a newly committed user-role/);
  assert.doesNotMatch(text,/cleared-composer-and-rendered-text/);
});

test("existing callback id is considered delivered only in a user message",()=>{
  const text=wake();
  assert.match(text,/alreadyDelivered[\s\S]*data-message-author-role=\\\"user\\\"/);
  assert.doesNotMatch(text,/document\.body\.innerText[^\n]*callbackId/);
});
