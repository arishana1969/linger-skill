export function windowsCommand(input: { adapter: string; node: string; hook: string; vault?: string; runtimeIdentity?: string }): string {
  const adapter = ps(input.adapter);
  const node = ps(input.node);
  const hook = ps(input.hook);
  const identity = input.runtimeIdentity ? `$env:LINGER_RUNTIME_ID='${ps(input.runtimeIdentity)}'; ` : "";
  const vault = input.vault ? `$env:LINGER_VAULT='${ps(input.vault)}'; ` : "";
  return `powershell.exe -NoProfile -Command "$env:LINGER_ADAPTER='${adapter}'; ${identity}${vault}& '${node}' '${hook}'"`;
}

function ps(value: string): string { return value.replaceAll("'", "''"); }
