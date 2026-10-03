import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {detectProjectProfile} from "../src/lib/project-detect.mjs";

test("detects npm scripts without asking a user for commands",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"detect-node-"));
  try{
    fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node --test",lint:"eslint .",build:"vite build"}}));
    const p=detectProjectProfile(root);
    assert.equal(p.kind,"node");
    assert.deepEqual(p.validation_steps.map(x=>x.name),["tests","lint","build"]);
    assert.deepEqual(p.allowed_executables,["git","node","npm"]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test("detects Python tools conservatively",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"detect-python-"));
  try{
    fs.writeFileSync(path.join(root,"pyproject.toml"),"[project]\ndependencies=['pytest','ruff']\n");
    const p=detectProjectProfile(root);
    assert.equal(p.kind,"python");
    assert.deepEqual(p.validation_steps.map(x=>x.name),["tests","code quality"]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test("does not invent commands for unknown projects",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"detect-unknown-"));
  try{
    const p=detectProjectProfile(root);
    assert.equal(p.kind,"unknown");
    assert.deepEqual(p.validation_steps,[]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
