import { createHash, randomUUID } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { capabilityReport, type AdapterName } from "./adapters.js";
import { atomicJson } from "./io.js";
import { installHooks, preflightHooks, uninstallHooks } from "./hook-installer.js";
import { installRuntime, installStableCli, preflightStableCli, uninstallRuntime, uninstallStableCli } from "./runtime-installer.js";
import { assertSafeId } from "./paths.js";
import { assertSupportedRuntime } from "./runtime-support.js";

export const PRIVACY_NOTICE = "Linger stores visible conversations in local files. "
  + "Recalled evidence and bounded normal-sensitivity enrichment batches may be sent to the model provider "
  + "configured in the current Codex or Claude Code host. Linger does not configure a separate model provider "
  + "or API key, and it does not disable or replace host-owned memory. Local-first does not mean data never "
  + "leaves this device. No telemetry is installed, and uninstall preserves the vault.";

export interface InstallManifest {
  schema_version: 1;
  package_version: string;
  installed_at: string;
  runtime_root: string;
  adapters: AdapterName[];
  files: string[];
  /** Legacy fields remain readable but are not written by v1. */
  package_root?: string;
  backups?: string[];
  hook_files?: string[];
  entry_conflicts?: string[];
  cli_launchers?: string[];
  active_state?: string;
  /** Legacy v0.2.1 migration state. New installs never create this field. */
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
  onEntryConflict?: "error" | "cli-only";
}

export async function install(options: InstallOptions): Promise<{
  manifest: InstallManifest;
  capabilities: Awaited<ReturnType<typeof capabilityReport>>;
  cli: { path: string; on_path: boolean };
  privacy_notice: string;
}> {
  await assertSupportedRuntime();
  const adapters = options.adapters ?? ["claude-code", "codex"];
  assertAdapters(adapters);
  const sourceSkill = path.join(options.packageRoot, "skills", "linger");
  await stat(path.join(sourceSkill, "SKILL.md"));
  const stateRoot = path.join(options.home, ".linger");
  const manifestFile = path.join(stateRoot, "install-manifest.json");
  const previousManifest = await existingManifest(options.home, manifestFile);
  const destinations = adapters.map(adapter => ({ adapter, destination: skillDestination(options.home, adapter) }));
  const entryConflicts: string[] = [];
  for (const { adapter, destination } of destinations) {
    if (await exists(destination) && !await isManaged(destination, adapter, previousManifest)) {
      entryConflicts.push(destination);
    }
  }
  if (entryConflicts.length && options.onEntryConflict !== "cli-only") {
    throw new Error(`Host entry is user-owned; no files were changed: ${entryConflicts.join(", ")}`);
  }
  const previousCli = previousManifest ? {
    root: previousManifest.runtime_root,
    version: previousManifest.package_version,
    launchers: previousManifest.cli_launchers ?? []
  } : undefined;
  await preflightStableCli(options.home, previousCli);
  await preflightHooks(options.home, adapters);
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const staleAdapters = previousManifest?.adapters.filter(adapter => !adapters.includes(adapter)) ?? [];
  if (staleAdapters.length || previousManifest?.claude_auto_memory) {
    await uninstallHooks(options.home, staleAdapters, previousManifest?.claude_auto_memory);
  }
  const currentDestinations = new Set(adapters.map(adapter => path.resolve(skillDestination(options.home, adapter))));
  for (const target of previousManifest?.files ?? []) {
    if (!currentDestinations.has(path.resolve(target))
      && previousManifest
      && await isManagedByManifest(target, previousManifest)) {
      await rm(target, { recursive: true, force: true });
    }
  }
  const files: string[] = [];
  const packageJson = JSON.parse(await readFile(path.join(options.packageRoot, "package.json"), "utf8")) as { version?: unknown };
  const packageVersion = assertSafeId(String(packageJson.version), "package version");
  const contentSha256 = createHash("sha256").update(await readFile(path.join(sourceSkill, "SKILL.md"))).digest("hex");
  for (const { adapter, destination } of destinations) {
    if (entryConflicts.includes(destination)) continue;
    await installManagedSkill(sourceSkill, destination, adapter, packageVersion, contentSha256, previousManifest);
    files.push(destination);
  }
  const runtime = await installRuntime(options.home, options.packageRoot);
  const stableCli = await installStableCli(options.home, runtime, previousCli);
  await installHooks(options.home, runtime.root, adapters);
  if (previousManifest?.active_state) await rm(previousManifest.active_state, { force: true });
  const manifest: InstallManifest = {
    schema_version: 1,
    package_version: runtime.version,
    installed_at: new Date().toISOString(),
    runtime_root: runtime.root,
    adapters,
    files,
    entry_conflicts: entryConflicts,
    cli_launchers: stableCli.launchers
  };
  await atomicJson(manifestFile, manifest);
  const cli = stableCli.launchers[0]!;
  return {
    manifest,
    capabilities: await capabilityReport(options.home),
    cli: { path: cli, on_path: pathOnPath(path.dirname(cli)) },
    privacy_notice: PRIVACY_NOTICE
  };
}

export async function uninstall(home: string): Promise<{ removed: string[]; vault_preserved: true }> {
  const manifestFile = path.join(home, ".linger", "install-manifest.json");
  let manifest: InstallManifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8")) as InstallManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: [], vault_preserved: true };
    throw error;
  }
  assertInstallManifest(home, manifest);
  const removed: string[] = [];
  for (const target of manifest.files) {
    if (!isInside(home, target)) throw new Error(`Refusing to remove path outside home: ${target}`);
    if (await isManagedByManifest(target, manifest)) {
      await rm(target, { recursive: true, force: true });
      removed.push(target);
    }
  }
  await uninstallHooks(home, manifest.adapters, manifest.claude_auto_memory);
  await uninstallRuntime(home, manifest.runtime_root);
  removed.push(...await uninstallStableCli(manifest.runtime_root, manifest.cli_launchers ?? []));
  if (manifest.active_state) {
    await rm(manifest.active_state, { force: true });
    removed.push(manifest.active_state);
  }
  await rm(manifestFile, { force: true });
  return { removed, vault_preserved: true };
}

function skillDestination(home: string, adapter: AdapterName): string {
  return adapter === "claude-code" ? path.join(home, ".claude", "skills", "linger") : path.join(home, ".codex", "skills", "linger");
}
function assertAdapters(adapters: unknown): asserts adapters is AdapterName[] {
  if (!Array.isArray(adapters) || !adapters.length) throw new Error("Invalid install adapters");
  if (!adapters.every(adapter => adapter === "claude-code" || adapter === "codex")) {
    throw new Error("Invalid install adapters");
  }
  if (new Set(adapters).size !== adapters.length) throw new Error("Invalid install adapters");
}
function assertInstallManifest(home: string, value: unknown): asserts value is InstallManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid install manifest");
  const item = value as Record<string, unknown>;
  if (item.schema_version !== 1) throw new Error("Invalid install manifest schema");
  if (typeof item.package_version !== "string") throw new Error("Invalid install manifest package version");
  const packageVersion = assertSafeId(item.package_version, "package version");
  if (typeof item.installed_at !== "string" || !Number.isFinite(Date.parse(item.installed_at))) throw new Error("Invalid install manifest timestamp");
  if (item.package_root !== undefined && typeof item.package_root !== "string") throw new Error("Invalid install manifest package root");
  if (typeof item.runtime_root !== "string") throw new Error("Invalid install manifest runtime root");
  assertAdapters(item.adapters);
  if (!Array.isArray(item.files) || !(item.files as unknown[]).every(entry => typeof entry === "string")) throw new Error("Invalid install manifest files");
  for (const field of ["backups", "hook_files", "entry_conflicts", "cli_launchers"] as const) {
    if (item[field] === undefined) continue;
    if (!Array.isArray(item[field]) || !(item[field] as unknown[]).every(entry => typeof entry === "string")) {
      throw new Error(`Invalid install manifest ${field}`);
    }
  }
  if (item.active_state !== undefined && typeof item.active_state !== "string") throw new Error("Invalid install manifest active_state");
  if (item.claude_auto_memory !== undefined) assertClaudeAutoMemoryState(item.claude_auto_memory);
  const allowedTargets = new Set((item.adapters as AdapterName[]).flatMap(adapter => [
    path.resolve(skillDestination(home, adapter)),
    ...(adapter === "codex" ? [path.resolve(home, ".agents", "skills", "linger")] : [])
  ]));
  if (!(item.files as string[]).every(file => allowedTargets.has(path.resolve(file)))) throw new Error("Invalid install manifest target");
  const allowedRuntime = path.resolve(home, ".linger", "runtime", packageVersion);
  if (path.resolve(item.runtime_root) !== allowedRuntime) throw new Error("Invalid install manifest runtime");
  const allowedLaunchers = new Set([
    path.resolve(home, ".linger", "bin", "linger"),
    path.resolve(home, ".linger", "bin", "linger.cmd"),
    path.resolve(home, ".local", "bin", "linger"),
    path.resolve(home, ".local", "bin", "linger.cmd")
  ]);
  if ((item.cli_launchers as string[] | undefined)?.some(file => !allowedLaunchers.has(path.resolve(file)))) {
    throw new Error("Invalid install manifest CLI launcher");
  }
  if (item.active_state !== undefined
    && path.resolve(item.active_state as string) !== path.resolve(home, ".linger", "install", "active.json")) {
    throw new Error("Invalid install manifest active state");
  }
}
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function installManagedSkill(
  source: string,
  destination: string,
  adapter: AdapterName,
  packageVersion: string,
  contentSha256: string,
  previousManifest?: InstallManifest
): Promise<void> {
  const transaction = randomUUID();
  const parent = path.dirname(destination);
  const staged = path.join(parent, `.linger-stage-${transaction}`);
  const previous = path.join(parent, `.linger-previous-${transaction}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if (await exists(destination) && !await isManaged(destination, adapter, previousManifest)) {
    throw new Error(`Refusing to replace unmanaged host entry: ${destination}`);
  }
  try {
    await cp(source, staged, { recursive: true, force: false, errorOnExist: true });
    await chmod(staged, 0o700);
    const marker = {
      schema_version: 1,
      owner: "linger-skill",
      adapter,
      package_version: packageVersion,
      content_sha256: contentSha256
    };
    await writeFile(
      path.join(staged, ".linger-managed.json"),
      `${JSON.stringify(marker, null, 2)}\n`,
      { mode: 0o600, flag: "wx" }
    );
    if (await exists(destination)) await rename(destination, previous);
    try { await rename(staged, destination); }
    catch (error) {
      if (await exists(previous) && !await exists(destination)) await rename(previous, destination);
      throw error;
    }
    await rm(previous, { recursive: true, force: true }).catch(() => undefined);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

async function isManaged(dir: string, adapter: AdapterName, manifest?: InstallManifest): Promise<boolean> {
  try {
    if ((await lstat(dir)).isSymbolicLink()) return false;
    const marker = JSON.parse(await readFile(path.join(dir, ".linger-managed.json"), "utf8")) as Record<string, unknown>;
    if (marker.schema_version !== 1 || marker.owner !== "linger-skill" || marker.adapter !== adapter || typeof marker.content_sha256 !== "string") return false;
    const digest = createHash("sha256").update(await readFile(path.join(dir, "SKILL.md"))).digest("hex");
    return digest === marker.content_sha256 && Boolean(manifest?.files.some(file => path.resolve(file) === path.resolve(dir)));
  } catch { /* legacy marker is accepted only when a validated prior manifest owns this exact path */ }
  return Boolean(manifest?.files.some(file => path.resolve(file) === path.resolve(dir)) && await exists(path.join(dir, ".linger-managed")));
}

async function isManagedByManifest(dir: string, manifest: InstallManifest): Promise<boolean> {
  if (!manifest.files.some(file => path.resolve(file) === path.resolve(dir))) return false;
  const resolved = path.resolve(dir);
  const adapter = resolved.includes(`${path.sep}.claude${path.sep}`) ? "claude-code"
    : resolved.includes(`${path.sep}.agents${path.sep}`) || resolved.includes(`${path.sep}.codex${path.sep}`) ? "codex"
      : undefined;
  return adapter ? await isManaged(dir, adapter, manifest) : false;
}

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

function pathOnPath(directory: string): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some(entry => entry && path.resolve(entry) === path.resolve(directory));
}

function assertClaudeAutoMemoryState(value: unknown): asserts value is ClaudeAutoMemoryState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid install manifest Claude auto-memory state");
  const item = value as Record<string, unknown>;
  if (typeof item.had_value !== "boolean") throw new Error("Invalid install manifest Claude auto-memory state");
  if (item.had_value ? typeof item.previous_value !== "boolean" : item.previous_value !== undefined) throw new Error("Invalid install manifest Claude auto-memory state");
  if (Object.keys(item).some(key => key !== "had_value" && key !== "previous_value")) throw new Error("Invalid install manifest Claude auto-memory state");
}
