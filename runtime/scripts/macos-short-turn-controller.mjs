import fs from "node:fs";
import {registerTask, casRegisterNextAction, ingestEvidence, claimCallbackReceipt, acknowledgeCallback, statusTask, reconcileTask, dispatchIntent} from "../../src/lib/macos-short-turn-autoloop.mjs";

function main() {
  const args=process.argv.slice(2), command=args.shift(); const get=k=>{const i=args.indexOf(`--${k}`); return i<0?undefined:args[i+1];};
  if(!command || ["run","execute","browser","codex","review","merge","deploy"].includes(command)) throw new Error("LOCAL_SHORT_TURN_ONLY");
  const stateDir=get("state-dir"); if(!stateDir) throw new Error("MISSING_STATE_DIR"); const taskId=get("task-id");
  let result;
  if(command==="register") result=registerTask({stateDir,identity:{instanceId:get("instance-id"),project:get("project"),route:get("route"),chatUrl:get("chat-url"),taskId,logicalIteration:Number(get("iteration"))},maxIterations:Number(get("max-iterations")||5)});
  else if(command==="next-action") result=casRegisterNextAction({stateDir,taskId,expectedVersion:Number(get("expected-version")),nextAction:JSON.parse(get("action"))});
  else if(command==="ingest") result=ingestEvidence({stateDir,taskId,expectedVersion:Number(get("expected-version")),evidence:JSON.parse(get("evidence"))});
  else if(command==="claim") result=claimCallbackReceipt({stateDir,taskId,callbackId:get("callback-id"),message:get("message")});
  else if(command==="ack") result=acknowledgeCallback({stateDir,taskId,expectedVersion:Number(get("expected-version")),outcome:get("outcome"),successor:get("successor")?JSON.parse(get("successor")):null});
  else if(command==="status") result=statusTask({stateDir,taskId});
  else if(command==="reconcile") result=reconcileTask({stateDir,taskId,evidence:JSON.parse(get("evidence"))});
  else if(command==="dispatch") result=dispatchIntent({stateDir,taskId});
  else throw new Error("UNKNOWN_COMMAND");
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
try { main(); } catch(e) { console.error(`SHORT_TURN_REJECTED: ${e.code || e.message}`); process.exitCode=1; }
