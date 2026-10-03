import os from "node:os";

const SECRET_KEY=/(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|passwd|cookie|session|secret)/i;
const TOKENISH=/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{16,})\b/gi;

function sanitizeString(value){
  let out=String(value).replace(TOKENISH,"[REDACTED]");
  const home=os.homedir();
  if(home) out=out.split(home).join("<USER_HOME>");
  return out;
}

export function sanitizeObject(value,key=""){
  if(SECRET_KEY.test(key)) return "[REDACTED]";
  if(Array.isArray(value)) return value.map(v=>sanitizeObject(v));
  if(value&&typeof value==="object") return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitizeObject(v,k)]));
  if(typeof value==="string") return sanitizeString(value);
  return value;
}
