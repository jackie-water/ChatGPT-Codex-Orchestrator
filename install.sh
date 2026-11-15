#!/bin/bash
set -euo pipefail
ROOT="$(cd -- "$(dirname "$0")" && pwd -P)"
cd -- "$ROOT"
LANGUAGE="en"
COMMAND="dry-run"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --language)
      if [[ $# -lt 2 ]]; then echo "Missing --language value" >&2; exit 2; fi
      LANGUAGE="$2"; shift 2 ;;
    --setup)
      if [[ "$COMMAND" != "dry-run" ]]; then echo "Duplicate installer action" >&2; exit 2; fi
      COMMAND="setup"; shift ;;
    --resume)
      if [[ "$COMMAND" != "dry-run" ]]; then echo "Duplicate installer action" >&2; exit 2; fi
      COMMAND="resume"; shift ;;
    *) echo "Unsupported macOS installer argument" >&2; exit 2 ;;
  esac
done
case "$LANGUAGE" in en|zh-CN) ;; *) echo "Unsupported language" >&2; exit 2 ;; esac
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS (此安装程序用于 macOS)。" >&2
  exit 2
fi
# An authorization-needed preflight has exit 1 by design: do not make it PASS.
# Only a strictly parsed, read-only PASS may enter setup/resume. Print the
# original result for a single, human-readable approval checkpoint.
RESULT=""
RC=0
RESULT="$(node "$ROOT/src/cli.mjs" dry-run --json --language "$LANGUAGE")" || RC=$?
printf '%s\n' "$RESULT"
if [[ "$RC" -ne 0 ]]; then exit "$RC"; fi
if ! printf '%s\n' "$RESULT" | node -e '
  let s="";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data",c=>{s+=c;if(s.length>1048576)process.exit(3)});
  process.stdin.on("end",()=>{
    // JSON.parse alone accepts duplicate keys. Reject duplicates in the
    // decision-bearing top-level object without trusting nested status fields.
    let depth=0,inString=false,escape=false,start=0,keys=[];
    try {
      for(let i=0;i<s.length;i++){
        const ch=s[i];
        if(inString){
          if(escape){escape=false;continue}
          if(ch==="\\"){escape=true;continue}
          if(ch===`"`){
            inString=false;
            if(depth===1 && /^\s*:/.test(s.slice(i+1))){keys.push(JSON.parse(s.slice(start,i+1)))}
          }
          continue;
        }
        if(ch===`"`){inString=true;start=i;continue}
        if(ch==="{"||ch==="[")depth++;
        else if(ch==="}"||ch==="]")depth--;
        if(depth<0)process.exit(3);
      }
      if(depth!==0||inString||keys.length!==new Set(keys).size)process.exit(3);
    }catch{process.exit(3)}
    let x;try{x=JSON.parse(s)}catch{process.exit(3)};
    if(!x||x.status!=="PASS"||x.dry_run!==true||x.mutations_performed!==false)process.exit(3);
  });
'; then
  echo "Read-only preflight was not a verified PASS; setup/resume stopped." >&2
  exit 3
fi
if [[ "$COMMAND" != "dry-run" ]]; then
  exec node "$ROOT/src/cli.mjs" "$COMMAND" --json --language "$LANGUAGE"
fi
