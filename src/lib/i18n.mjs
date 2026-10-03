import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const localeDir=path.resolve(here,"..","locales");
const cache=new Map();

export function normalizeLanguage(value){
  const v=String(value||"").toLowerCase();
  if(v.startsWith("zh")) return "zh-CN";
  return "en";
}

function load(lang){
  const normalized=normalizeLanguage(lang);
  if(!cache.has(normalized)) cache.set(normalized,JSON.parse(fs.readFileSync(path.join(localeDir,normalized+".json"),"utf8")));
  return cache.get(normalized);
}

export function t(lang,key){
  const dict=load(lang);
  return dict[key]||load("en")[key]||key;
}
