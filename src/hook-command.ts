import path from "node:path";
import type { AdapterName } from "./adapters.js";

export interface ManagedHookCommand {
  adapter: AdapterName;
  node: string;
  hook: string;
  runtime_identity?: string;
  vault?: string;
}

export function posixHookCommand(input: ManagedHookCommand): string {
  const identity = input.runtime_identity ? ` LINGER_RUNTIME_ID=${input.runtime_identity}` : "";
  const vault = input.vault ? ` LINGER_VAULT=${quotePosix(input.vault)}` : "";
  return `LINGER_ADAPTER=${input.adapter}${identity}${vault} ${quotePosix(input.node)} ${quotePosix(input.hook)}`;
}

export function parseManagedHookCommand(command: string, home: string, adapter: AdapterName): ManagedHookCommand | undefined {
  const current = command.match(/^LINGER_ADAPTER=(claude-code|codex)(?: LINGER_RUNTIME_ID=([a-f0-9]{64}))?(?: LINGER_VAULT='((?:[^']|'"'"')*)')? '((?:[^']|'"'"')*)' '((?:[^']|'"'"')*)'$/);
  const parsed = current ? {
    adapter: current[1] as AdapterName,
    ...(current[2] ? { runtime_identity: current[2] } : {}),
    ...(current[3] ? { vault: unquotePosix(current[3]) } : {}),
    node: unquotePosix(current[4]!),
    hook: unquotePosix(current[5]!)
  } : legacyCommand(command);
  if (!parsed || parsed.adapter !== adapter) return undefined;
  const hook = path.resolve(parsed.hook);
  const runtime = path.resolve(home, ".linger", "runtime");
  const relative = path.relative(runtime, hook);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  if (path.basename(hook) !== "hook-cli.js" || path.basename(path.dirname(hook)) !== "dist") return undefined;
  if (parsed.vault && path.resolve(parsed.vault) !== path.resolve(home, ".linger", "vault")) return undefined;
  return parsed;
}

function legacyCommand(command: string): ManagedHookCommand | undefined {
  const legacy = command.match(/^LINGER_ADAPTER=(claude-code|codex) "([^"\r\n]+)" "([^"\r\n]+)"$/);
  return legacy ? { adapter: legacy[1] as AdapterName, node: legacy[2]!, hook: legacy[3]!.replaceAll("\\\\", "\\") } : undefined;
}

function quotePosix(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
function unquotePosix(value: string): string { return value.replaceAll(`'"'"'`, "'"); }
