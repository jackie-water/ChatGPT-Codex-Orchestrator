import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("existing install upgrade retires origin discovery runtime",()=>{
  const control=fs.readFileSync(new URL("../src/lib/control-env.mjs",import.meta.url),"utf8");
  const cli=fs.readFileSync(new URL("../src/cli.mjs",import.meta.url),"utf8");
  for(const file of ["capture-chat-origins.mjs","chat-routing.ps1","dispatch-chat-callback.ps1","origin-router-loop.ps1"]){
    assert.ok(control.includes(file),"upgrade must retire "+file);
  }
  assert.match(control,/stopRetiredOriginRouter/);
  assert.match(cli,/routing_architecture!==\"explicit-route-v1\"/);
  assert.match(cli,/retry-pending-callbacks\.ps1/);
});

test("new callback delivery has explicit state transitions",()=>{
  const ps=fs.readFileSync(new URL("../runtime/scripts/wake-chat.ps1",import.meta.url),"utf8");
  const js=fs.readFileSync(new URL("../runtime/scripts/wake-chat.mjs",import.meta.url),"utf8");
  assert.match(ps,/routing_version = \"explicit-route-v1\"/);
  assert.match(ps,/delivery_state = \"PENDING\"/);
  assert.match(js,/updateDeliveryState\(\"DRAFT_INSERTED\"\)/);
  assert.match(js,/updateDeliveryState\(\"DELIVERED\"/);
  assert.match(js,/data-message-author-role/);
  assert.match(js,/user/);
});
