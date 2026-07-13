export function windowsCommand(command: string): string {
  const match = command.match(/^LINGER_ADAPTER=(\S+) "([^"]+)" "([^"]+)"$/);
  if (!match) return command;
  const adapter = ps(match[1]!);
  const node = ps(match[2]!);
  const hook = ps(match[3]!);
  return `powershell.exe -NoProfile -Command "$env:LINGER_ADAPTER='${adapter}'; & '${node}' '${hook}'"`;
}

function ps(value: string): string { return value.replaceAll("'", "''"); }
