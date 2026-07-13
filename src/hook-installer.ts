import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicJson } from "./io.js";
import { parseManagedHookCommand, posixHookCommand } from "./hook-command.js";
import { windowsCommand } from "./windows-command.js";
import type { AdapterName } from "./adapters.js";

type HookMap = Record<string, Array<{ matcher?: string; hooks: Array<{ type: "command"; command: string; commandWindows?: string; timeout?: number; statusMessage?: string }> }>>;

export async function installHooks(home: string, packageRoot: string, adapters: AdapterName[]): Promise<string[]> {
  const node = process.execPath;
  const hook = path.join(packageRoot, "dist", "hook-cli.js");
  const runtimeIdentity = await runtimeFingerprint(packageRoot, node);
  const written: string[] = [];
  if (adapters.includes("claude-code")) {
    const file = path.join(home, ".claude", "settings.json");
    const settings = await jsonObjectOr(file);
    const hooks = asHooks(settings.hooks);
    removeLingerHookCommands(hooks, home, "claude-code");
    addLingerHooks(hooks, "claude-code", node, hook, runtimeIdentity, ["SessionStart", "UserPromptSubmit", "Stop", "StopFailure"]);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicJson(file, { ...settings, hooks });
    written.push(file);
  }
  if (adapters.includes("codex")) {
    const file = path.join(home, ".codex", "hooks.json");
    const document = await jsonObjectOr(file);
    const hooks = asHooks(document.hooks);
    removeLingerHookCommands(hooks, home, "codex");
    addLingerHooks(hooks, "codex", node, hook, runtimeIdentity, ["SessionStart", "UserPromptSubmit", "Stop"]);
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
    const document = await jsonObjectOr(file);
    const hooks = asHooks(document.hooks);
    const removed = removeLingerHookCommands(hooks, home, adapter);
    if (removed) { await atomicJson(file, { ...document, hooks }); changed.push(file); }
  }
  return changed;
}

function addLingerHooks(hooks: HookMap, adapter: AdapterName, node: string, hook: string, runtimeIdentity: string, events: string[]): void {
  const command = posixHookCommand({ adapter, node, hook, runtime_identity: runtimeIdentity });
  const commandWindows = windowsCommand({ adapter, node, hook, runtimeIdentity });
  for (const event of events) {
    const groups = hooks[event] ?? [];
    const already = groups.some(group => group.hooks.some(hook => hook.command === command));
    if (!already) groups.push({ ...(event === "SessionStart" ? { matcher: "startup|resume|compact" } : {}), hooks: [{ type: "command", command, commandWindows, timeout: 10, statusMessage: "Linger capture" }] });
    hooks[event] = groups;
  }
}

function removeLingerHookCommands(hooks: HookMap, home: string, adapter: AdapterName): boolean {
  let removed = false;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event] ?? [];
    for (const group of groups) {
      const before = group.hooks.length;
      group.hooks = group.hooks.filter(hook => !isLingerHookCommand(hook.command, home, adapter));
      removed ||= before !== group.hooks.length;
    }
    hooks[event] = groups.filter(group => group.hooks.length);
    if (!hooks[event]!.length) delete hooks[event];
  }
  return removed;
}

function asHooks(value: unknown): HookMap {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid host hooks configuration");
  for (const groups of Object.values(value)) {
    if (!Array.isArray(groups)) throw new Error("Invalid host hook groups");
    for (const group of groups) {
      if (!group || typeof group !== "object" || Array.isArray(group) || !Array.isArray((group as { hooks?: unknown }).hooks)) throw new Error("Invalid host hook group");
      for (const hook of (group as { hooks: unknown[] }).hooks) if (!hook || typeof hook !== "object" || Array.isArray(hook) || typeof (hook as { command?: unknown }).command !== "string") throw new Error("Invalid host hook command");
    }
  }
  return value as HookMap;
}
async function jsonObjectOr(file: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid host configuration document");
    return value as Record<string, unknown>;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
function isLingerHookCommand(command: string, home: string, adapter: AdapterName): boolean {
  return Boolean(parseManagedHookCommand(command, home, adapter));
}
async function runtimeFingerprint(packageRoot: string, node: string): Promise<string> {
  const hash = createHash("sha256").update(path.resolve(packageRoot)).update("\0").update(path.resolve(node));
  const files = await runtimeFiles(path.join(packageRoot, "dist"));
  for (const file of files) hash.update("\0").update(path.relative(packageRoot, file)).update("\0").update(await readFile(file));
  return hash.digest("hex");
}
async function runtimeFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await runtimeFiles(target));
      else if (entry.isFile()) files.push(target);
    }
    return files.sort();
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
