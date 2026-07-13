export function windowsCommand(input: { adapter: string; node: string; hook: string }): string {
  const adapter = ps(input.adapter);
  const node = ps(input.node);
  const hook = ps(input.hook);
  return `powershell.exe -NoProfile -Command "$env:LINGER_ADAPTER='${adapter}'; & '${node}' '${hook}'"`;
}

function ps(value: string): string { return value.replaceAll("'", "''"); }
