import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicJson } from "./io.js";
import type { AdapterName } from "./adapters.js";

type HookMap = Record<string, Array<{ matcher?: string; hooks: Array<{ type: "command"; command: string; timeout?: number; statusMessage?: string }> }>>;

export async function installHooks(home: string, packageRoot: string, adapters: AdapterName[]): Promise<string[]> {
  const commandBase = `${quote(process.execPath)} ${quote(path.join(packageRoot, "dist", "hook-cli.js"))}`;
  const written: string[] = [];
  if (adapters.includes("claude-code")) {
    const file = path.join(home, ".claude", "settings.json");
    const settings = await jsonOr<Record<string, unknown>>(file, {});
    const hooks = asHooks(settings.hooks);
    addContinuityHooks(hooks, `CONTINUITY_ADAPTER=claude-code ${commandBase}`);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicJson(file, { ...settings, hooks });
    written.push(file);
  }
  if (adapters.includes("codex")) {
    const file = path.join(home, ".codex", "hooks.json");
    const document = await jsonOr<{ hooks?: HookMap }>(file, {});
    const hooks = asHooks(document.hooks);
    addContinuityHooks(hooks, `CONTINUITY_ADAPTER=codex ${commandBase}`);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicJson(file, { ...document, hooks });
    written.push(file);
  }
  return written;
}

export async function uninstallHooks(home: string, adapters: AdapterName[]): Promise<string[]> {
  const changed: string[] = [];
  for (const [adapter, file] of [
    ["claude-code", path.join(home, ".claude", "settings.json")],
    ["codex", path.join(home, ".codex", "hooks.json")]
  ] as const) {
    if (!adapters.includes(adapter)) continue;
    const document = await jsonOr<Record<string, unknown>>(file, {});
    const hooks = asHooks(document.hooks);
    let removed = false;
    for (const event of Object.keys(hooks)) {
      const groups = hooks[event] ?? [];
      for (const group of groups) {
        const before = group.hooks.length;
        group.hooks = group.hooks.filter(hook => !hook.command.includes("dist/hook-cli.js") && !hook.command.includes("dist\\hook-cli.js"));
        removed ||= before !== group.hooks.length;
      }
      hooks[event] = groups.filter(group => group.hooks.length);
      if (!hooks[event]!.length) delete hooks[event];
    }
    if (removed) { await atomicJson(file, { ...document, hooks }); changed.push(file); }
  }
  return changed;
}

function addContinuityHooks(hooks: HookMap, command: string): void {
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
    const groups = hooks[event] ?? [];
    const already = groups.some(group => group.hooks.some(hook => hook.command === command));
    if (!already) groups.push({ ...(event === "SessionStart" ? { matcher: "startup|resume|compact" } : {}), hooks: [{ type: "command", command, timeout: 10, statusMessage: "Continuity capture" }] });
    hooks[event] = groups;
  }
}

function asHooks(value: unknown): HookMap { return value && typeof value === "object" && !Array.isArray(value) ? value as HookMap : {}; }
async function jsonOr<T>(file: string, fallback: T): Promise<T> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; } }
function quote(value: string): string { return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`; }
