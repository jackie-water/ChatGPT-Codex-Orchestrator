import fs from "node:fs";
import path from "node:path";

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return null; }
}

export function detectProjectProfile(repoPath) {
  const root=path.resolve(repoPath);
  const pkg=readJson(path.join(root,"package.json"));

  if (pkg) {
    const scripts=pkg.scripts||{};
    const steps=[];
    if (scripts.test) steps.push({name:"tests",command:"npm",arguments:["test"]});
    if (scripts.lint) steps.push({name:"lint",command:"npm",arguments:["run","lint"]});
    if (scripts.build) steps.push({name:"build",command:"npm",arguments:["run","build"]});
    return {
      kind:"node",
      confidence:"high",
      allowed_executables:["git","node","npm"],
      validation_steps:steps,
      detected_from:["package.json"],
      user_summary:steps.length ? "Tests/code-quality/build checks were detected automatically." : "A Node.js project was detected, but no standard validation scripts were found."
    };
  }

  const pyproject=path.join(root,"pyproject.toml");
  const requirements=path.join(root,"requirements.txt");
  if (fs.existsSync(pyproject)||fs.existsSync(requirements)) {
    const text=(fs.existsSync(pyproject)?fs.readFileSync(pyproject,"utf8"):"")+"\n"+
      (fs.existsSync(requirements)?fs.readFileSync(requirements,"utf8"):"");
    const lower=text.toLowerCase();
    const steps=[];
    if (lower.includes("pytest")) steps.push({name:"tests",command:"python",arguments:["-m","pytest"]});
    if (lower.includes("ruff")) steps.push({name:"code quality",command:"python",arguments:["-m","ruff","check","."]});
    if (lower.includes("mypy")) steps.push({name:"type check",command:"python",arguments:["-m","mypy","."]});
    return {
      kind:"python",
      confidence:"medium",
      allowed_executables:["git","python"],
      validation_steps:steps,
      detected_from:[fs.existsSync(pyproject)?"pyproject.toml":null,fs.existsSync(requirements)?"requirements.txt":null].filter(Boolean),
      user_summary:steps.length ? "Python project checks were detected automatically." : "A Python project was detected, but no standard validation tools were found."
    };
  }

  return {
    kind:"unknown",
    confidence:"low",
    allowed_executables:["git"],
    validation_steps:[],
    detected_from:[],
    user_summary:"The project type could not be identified safely. Setup will not invent validation commands."
  };
}
