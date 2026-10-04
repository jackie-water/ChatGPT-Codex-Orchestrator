import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {removeLegacyDefaultReviewRoutes} from "../src/lib/control-env.mjs";

test("legacy project routes are removed without changing other registry fields",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"routing-migration-"));
  const file=path.join(dir,"projects.json");
  const registry={schema_version:1,projects:{
    first:{repository:"owner/first",enabled:false,default_review_route:"https://chatgpt.com/old-1",limits:{max_iterations:5},code_review:{required_for_code_changes:true}},
    second:{repository:"owner/second",enabled:true,checkpoint_branch:"codex/checkpoint",validation:{required:true},default_review_route:"https://chatgpt.com/old-2"}
  }};
  fs.writeFileSync(file,JSON.stringify(registry,null,2)+"\n");

  assert.deepEqual(removeLegacyDefaultReviewRoutes(file),{changed:true});
  const migrated=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.deepEqual(migrated,{schema_version:1,projects:{
    first:{repository:"owner/first",enabled:false,limits:{max_iterations:5},code_review:{required_for_code_changes:true}},
    second:{repository:"owner/second",enabled:true,checkpoint_branch:"codex/checkpoint",validation:{required:true}}
  }});
  const unchanged=fs.readFileSync(file,"utf8");
  assert.deepEqual(removeLegacyDefaultReviewRoutes(file),{changed:false});
  assert.equal(fs.readFileSync(file,"utf8"),unchanged);
});

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
