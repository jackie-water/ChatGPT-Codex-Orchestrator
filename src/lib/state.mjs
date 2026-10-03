import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function stateRoot() {
  const root=process.env.CHATGPT_CODEX_ORCHESTRATOR_HOME||path.join(os.homedir(),".chatgpt-codex-orchestrator-dev");
  fs.mkdirSync(root,{recursive:true});
  return root;
}

export function statePath(){return path.join(stateRoot(),"install-state.json");}

export function loadState(){
  const p=statePath();
  if(!fs.existsSync(p)) return {schema_version:1,preferred_language:null,current_step:"not_started",completed:[],ready:false};
  return JSON.parse(fs.readFileSync(p,"utf8"));
}

export function saveState(state){
  const p=statePath();
  const temp=p+".tmp";
  fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});
  fs.renameSync(temp,p);
}
