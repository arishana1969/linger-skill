export function windowsCommand(input: { adapter: string; node: string; hook: string; runtimeIdentity?: string }): string {
  const adapter = ps(input.adapter);
  const node = ps(input.node);
  const hook = ps(input.hook);
  const identity = input.runtimeIdentity ? `$env:LINGER_RUNTIME_ID='${ps(input.runtimeIdentity)}'; ` : "";
  return `powershell.exe -NoProfile -Command "$env:LINGER_ADAPTER='${adapter}'; ${identity}& '${node}' '${hook}'"`;
}

function ps(value: string): string { return value.replaceAll("'", "''"); }
