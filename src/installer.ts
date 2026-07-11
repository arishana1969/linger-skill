import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { capabilityReport, type AdapterName } from "./adapters.js";
import { atomicJson } from "./io.js";
import { installHooks, uninstallHooks } from "./hook-installer.js";
import { installRuntime, uninstallRuntime } from "./runtime-installer.js";

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
}

export interface InstallOptions {
  home: string;
  packageRoot: string;
  adapters?: AdapterName[];
}

export async function install(options: InstallOptions): Promise<{ manifest: InstallManifest; capabilities: Awaited<ReturnType<typeof capabilityReport>> }> {
  const adapters = options.adapters ?? ["claude-code", "codex"];
  const sourceSkill = path.join(options.packageRoot, "skills", "continuity");
  await stat(path.join(sourceSkill, "SKILL.md"));
  const stateRoot = path.join(options.home, ".continuity");
  const manifestFile = path.join(stateRoot, "install-manifest.json");
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
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
    await writeFile(path.join(destination, ".continuity-managed"), "managed by continuity-skill\n", { mode: 0o600 });
    files.push(destination);
  }
  const runtime = await installRuntime(options.home, options.packageRoot);
  const hookFiles = await installHooks(options.home, runtime.root, adapters);
  const manifest: InstallManifest = { schema_version: 1, package_version: runtime.version, installed_at: new Date().toISOString(), package_root: options.packageRoot, runtime_root: runtime.root, adapters, files, backups, hook_files: hookFiles };
  await atomicJson(manifestFile, manifest);
  return { manifest, capabilities: await capabilityReport(options.home) };
}

export async function uninstall(home: string): Promise<{ removed: string[]; vault_preserved: true }> {
  const manifestFile = path.join(home, ".continuity", "install-manifest.json");
  let manifest: InstallManifest;
  try { manifest = JSON.parse(await readFile(manifestFile, "utf8")) as InstallManifest; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: [], vault_preserved: true }; throw error; }
  const removed: string[] = [];
  for (const target of manifest.files) {
    if (!isInside(home, target)) throw new Error(`Refusing to remove path outside home: ${target}`);
    if (await isManaged(target)) { await rm(target, { recursive: true, force: true }); removed.push(target); }
  }
  await uninstallHooks(home, manifest.adapters);
  await uninstallRuntime(home, manifest.runtime_root);
  await rm(manifestFile, { force: true });
  return { removed, vault_preserved: true };
}

function skillDestination(home: string, adapter: AdapterName): string {
  return path.join(home, adapter === "claude-code" ? ".claude" : ".codex", "skills", "continuity");
}
function isInside(parent: string, child: string): boolean { const relative = path.relative(path.resolve(parent), path.resolve(child)); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); }
async function isManaged(dir: string): Promise<boolean> { return await exists(path.join(dir, ".continuity-managed")); }
async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }
