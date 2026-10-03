import test from "node:test";
import assert from "node:assert/strict";
import {normalizeLanguage,t} from "../src/lib/i18n.mjs";

test("Chinese request stays Chinese",()=>{
  assert.equal(normalizeLanguage("zh-CN"),"zh-CN");
  assert.match(t("zh-CN","setup.github.connect"),/GitHub/);
});

test("English is default for unknown languages",()=>{
  assert.equal(normalizeLanguage("fr"),"en");
  assert.match(t("en","setup.ready"),/ready/i);
});
