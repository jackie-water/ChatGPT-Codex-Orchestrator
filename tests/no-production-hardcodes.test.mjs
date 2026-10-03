import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const forbidden=[/priceup/i,/jackie-water/i,/room_rate/i,/PRICEUP_/];
const roots=["runtime","templates/control-repo"];

function walk(dir){
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const p=path.join(dir,e.name);
    return e.isDirectory()?walk(p):[p];
  });
}

test("generic runtime contains no production-specific hardcodes",()=>{
  for(const file of roots.flatMap(walk)){
    const text=fs.readFileSync(file,"utf8");
    for(const pattern of forbidden){
      assert.doesNotMatch(text,pattern,`${file} contains forbidden production-specific text ${pattern}`);
    }
  }
});
