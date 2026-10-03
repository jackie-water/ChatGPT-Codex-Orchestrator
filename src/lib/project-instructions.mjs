export function renderProjectInstructions(template,{projectKey,repository,controlRepository,sandboxProjectKey}){
  for(const [name,value] of Object.entries({projectKey,repository,controlRepository,sandboxProjectKey})){
    if(!String(value||"").trim()) throw new Error("Missing Project Instructions value: "+name);
  }
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid application repository");
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(controlRepository)) throw new Error("Invalid control repository");

  const rendered=String(template)
    .replaceAll("{{PROJECT_KEY}}",projectKey)
    .replaceAll("{{REPOSITORY}}",repository)
    .replaceAll("{{CONTROL_REPOSITORY}}",controlRepository)
    .replaceAll("{{SANDBOX_PROJECT_KEY}}",sandboxProjectKey);

  if(/\{\{[A-Z0-9_]+\}\}/.test(rendered)) throw new Error("Unresolved Project Instructions placeholder");
  return rendered;
}
