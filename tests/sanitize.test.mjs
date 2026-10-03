import test from "node:test";
import assert from "node:assert/strict";
import {sanitizeObject} from "../src/lib/sanitize.mjs";

test("redacts secret-key fields",()=>{
  const x=sanitizeObject({access_token:"abc",nested:{password:"secret"},safe:"ok"});
  assert.equal(x.access_token,"[REDACTED]");
  assert.equal(x.nested.password,"[REDACTED]");
  assert.equal(x.safe,"ok");
});

test("redacts token-shaped strings",()=>{
  const x=sanitizeObject({message:"token ghp_abcdefghijklmnopqrstuvwxyz012345"});
  assert.doesNotMatch(x.message,/ghp_/);
});
