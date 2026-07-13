import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { capabilityReport, type AdapterName } from "./adapters.js";
import { atomicJson } from "./io.js";
import { installHooks, uninstallHooks } from "./hook-installer.js";
import { installRuntime, uninstallRuntime } from "./runtime-installer.js";
import { assertSafeId } from "./paths.js";

export const PRIVACY_NOTICE = "Linger stores visible conversations in local files. Recalled evidence and bounded normal-sensitivity enrichment batches may be sent to the model provider configured in the current Codex or Claude Code host. Linger does not configure a separate model provider or API key. Local-first does not mean data never leaves this device. No telemetry is installed, and uninstall preserves the vault.";

export interface InstallManifest {
  schema_version: 1;
  package_version: string;
  installed_at: string;
  package_root: string;
  runtime_root: string;
  adapters: AdapterName[];
  files: string[];
  backups: string[];
  hook_files: string[];
  claude_auto_memory?: ClaudeAutoMemoryState;
}

export interface ClaudeAutoMemoryState {
  had_value: boolean;
  previous_value?: boolean;
}

export interface InstallOptions {
  home: string;
  packageRoot: string;
  adapters?: AdapterName[];
}

export async function install(options: InstallOptions): Promise<{ manifest: InstallManifest; capabilities: Awaited<ReturnType<typeof capabilityReport>>; privacy_notice: string }> {
  const adapters = options.adapters ?? ["claude-code", "codex"];
  assertAdapters(adapters);
  const sourceSkill = path.join(options.packageRoot, "skills", "linger");
  await stat(path.join(sourceSkill, "SKILL.md"));
  const stateRoot = path.join(options.home, ".linger");
  const manifestFile = path.join(stateRoot, "install-manifest.json");
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const previousManifest = await existingManifest(options.home, manifestFile);
  const claudeAutoMemory = adapters.includes("claude-code")
    ? previousManifest?.claude_auto_memory ?? await readClaudeAutoMemoryState(options.home)
    : previousManifest?.claude_auto_memory;
  const backups: string[] = [];
  const files: string[] = [];
  for (const adapter of adapters) {
    const destination = skillDestination(options.home, adapter);
    if (await exists(destination)) {
      if (await isManaged(destination)) await rm(destination, { recursive: true, force: true });
      else {
        const backup = `${destination}.backup-${Date.now()}`;
        await rename(destination, backup);
        backups.push(backup);
      }
    }
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await cp(sourceSkill, destination, { recursive: true, force: false });
    await writeFile(path.join(destination, ".linger-managed"), "managed by linger-skill\n", { mode: 0o600 });
    files.push(destination);
  }
  const runtime = await installRuntime(options.home, options.packageRoot);
  const hookFiles = await installHooks(options.home, runtime.root, adapters);
  const manifest: InstallManifest = { schema_version: 1, package_version: runtime.version, installed_at: new Date().toISOString(), package_root: options.packageRoot, runtime_root: runtime.root, adapters, files, backups, hook_files: hookFiles, ...(claudeAutoMemory ? { claude_auto_memory: claudeAutoMemory } : {}) };
  await atomicJson(manifestFile, manifest);
  return { manifest, capabilities: await capabilityReport(options.home), privacy_notice: PRIVACY_NOTICE };
}

export async function uninstall(home: string): Promise<{ removed: string[]; vault_preserved: true }> {
  const manifestFile = path.join(home, ".linger", "install-manifest.json");
  let manifest: InstallManifest;
  try { manifest = JSON.parse(await readFile(manifestFile, "utf8")) as InstallManifest; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: [], vault_preserved: true }; throw error; }
  assertInstallManifest(home, manifest);
  const removed: string[] = [];
  for (const target of manifest.files) {
    if (!isInside(home, target)) throw new Error(`Refusing to remove path outside home: ${target}`);
    if (await isManaged(target)) { await rm(target, { recursive: true, force: true }); removed.push(target); }
  }
  await uninstallHooks(home, manifest.adapters, manifest.claude_auto_memory);
  await uninstallRuntime(home, manifest.runtime_root);
  await rm(manifestFile, { force: true });
  return { removed, vault_preserved: true };
}

function skillDestination(home: string, adapter: AdapterName): string {
  return path.join(home, adapter === "claude-code" ? ".claude" : ".codex", "skills", "linger");
}
function assertAdapters(adapters: unknown): asserts adapters is AdapterName[] {
  if (!Array.isArray(adapters) || !adapters.length || !adapters.every(adapter => adapter === "claude-code" || adapter === "codex") || new Set(adapters).size !== adapters.length) throw new Error("Invalid install adapters");
}
function assertInstallManifest(home: string, value: unknown): asserts value is InstallManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid install manifest");
  const item = value as Record<string, unknown>;
  if (item.schema_version !== 1) throw new Error("Invalid install manifest schema");
  const packageVersion = typeof item.package_version === "string" ? assertSafeId(item.package_version, "package version") : (() => { throw new Error("Invalid install manifest package version"); })();
  if (typeof item.installed_at !== "string" || !Number.isFinite(Date.parse(item.installed_at))) throw new Error("Invalid install manifest timestamp");
  if (typeof item.package_root !== "string" || typeof item.runtime_root !== "string") throw new Error("Invalid install manifest paths");
  assertAdapters(item.adapters);
  for (const field of ["files", "backups", "hook_files"] as const) if (!Array.isArray(item[field]) || !(item[field] as unknown[]).every(entry => typeof entry === "string")) throw new Error(`Invalid install manifest ${field}`);
  if (item.claude_auto_memory !== undefined) assertClaudeAutoMemoryState(item.claude_auto_memory);
  const allowedTargets = new Set(item.adapters.map(adapter => path.resolve(skillDestination(home, adapter))));
  if (!(item.files as string[]).every(file => allowedTargets.has(path.resolve(file)))) throw new Error("Invalid install manifest target");
  const allowedRuntime = path.resolve(home, ".linger", "runtime", packageVersion);
  if (path.resolve(item.runtime_root) !== allowedRuntime) throw new Error("Invalid install manifest runtime");
}
function isInside(parent: string, child: string): boolean { const relative = path.relative(path.resolve(parent), path.resolve(child)); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); }
async function isManaged(dir: string): Promise<boolean> { return await exists(path.join(dir, ".linger-managed")); }
async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }

async function existingManifest(home: string, file: string): Promise<InstallManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    assertInstallManifest(home, value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readClaudeAutoMemoryState(home: string): Promise<ClaudeAutoMemoryState> {
  const file = path.join(home, ".claude", "settings.json");
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Claude settings document");
    const settings = value as Record<string, unknown>;
    if (!Object.hasOwn(settings, "autoMemoryEnabled")) return { had_value: false };
    if (typeof settings.autoMemoryEnabled !== "boolean") throw new Error("Invalid Claude autoMemoryEnabled setting");
    return { had_value: true, previous_value: settings.autoMemoryEnabled };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { had_value: false };
    throw error;
  }
}

function assertClaudeAutoMemoryState(value: unknown): asserts value is ClaudeAutoMemoryState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid install manifest Claude auto-memory state");
  const item = value as Record<string, unknown>;
  if (typeof item.had_value !== "boolean") throw new Error("Invalid install manifest Claude auto-memory state");
  if (item.had_value ? typeof item.previous_value !== "boolean" : item.previous_value !== undefined) throw new Error("Invalid install manifest Claude auto-memory state");
  if (Object.keys(item).some(key => key !== "had_value" && key !== "previous_value")) throw new Error("Invalid install manifest Claude auto-memory state");
}
