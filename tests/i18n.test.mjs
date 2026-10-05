import test from "node:test";
import assert from "node:assert/strict";
import {normalizeLanguage,t} from "../src/lib/i18n.mjs";
import {ERROR_CATALOG} from "../src/lib/errors.mjs";

test("Chinese request stays Chinese",()=>{
  assert.equal(normalizeLanguage("zh-CN"),"zh-CN");
  assert.match(t("zh-CN","setup.github.connect"),/GitHub/);
});

test("English is default for unknown languages",()=>{
  assert.equal(normalizeLanguage("fr"),"en");
  assert.match(t("en","setup.ready"),/ready/i);
});

test("runtime refresh messages and error catalog stay covered",()=>{
  assert.match(t("zh-CN","runtime.refresh.success"),/刷新/);
  assert.match(t("zh-CN","runtime.refresh.failed"),/刷新/);
  assert.match(t("en","runtime.refresh.success"),/refresh/i);
  assert.match(t("en","runtime.refresh.failed"),/refresh/i);
  assert.equal(ERROR_CATALOG["RUNTIME-REFRESH-001"],"Control runtime refresh failed.");
});
