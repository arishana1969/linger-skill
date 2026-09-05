import { randomUUID } from "node:crypto";
import { chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./io.js";
import { assertSafeId } from "./paths.js";

export interface RuntimeInstall { root: string; version: string; }
export interface StableCliInstall { launchers: string[]; }

export async function installRuntime(home: string, packageRoot: string): Promise<RuntimeInstall> {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as unknown;
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    throw new Error("Invalid package version");
  }
  if (typeof (packageJson as Record<string, unknown>).version !== "string") {
    throw new Error("Invalid package version");
  }
  const version = assertSafeId((packageJson as { version: string }).version, "package version");
  const sourceDist = path.join(packageRoot, "dist");
  await stat(path.join(sourceDist, "hook-cli.js"));
  const runtimeParent = path.join(home, ".linger", "runtime");
  const root = path.join(runtimeParent, version);
  const managed = path.join(root, ".linger-managed");
  const transaction = randomUUID();
  const staged = path.join(runtimeParent, `.stage-${version}-${transaction}`);
  const previous = path.join(runtimeParent, `.previous-${version}-${transaction}`);
  await mkdir(runtimeParent, { recursive: true, mode: 0o700 });
  if (await exists(root)) {
    if (!await exists(managed)) throw new Error(`Refusing to replace unmanaged runtime: ${root}`);
  }
  try {
    await mkdir(staged, { mode: 0o700 });
    // The CLI also reads package metadata, install assets, and the Local manifests.
    for (const entry of ["dist", "package.json", "skills", "local-model-manifests", "local-runtime-manifests", "LICENSE"]) {
      await cp(path.join(packageRoot, entry), path.join(staged, entry), { recursive: true, force: false });
    }
    await writeFile(path.join(staged, ".linger-managed"), "managed by linger-skill\n", { mode: 0o600, flag: "wx" });
    await stat(path.join(staged, "dist", "hook-cli.js"));
    if (await exists(root)) await rename(root, previous);
    try { await rename(staged, root); }
    catch (error) {
      if (await exists(previous) && !await exists(root)) await rename(previous, root);
      throw error;
    }
    await rm(previous, { recursive: true, force: true }).catch(() => undefined);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
  return { root, version };
}

export async function preflightStableCli(home: string, previous?: RuntimeInstall & StableCliInstall): Promise<void> {
  for (const target of stableCliTargets(home, previous?.launchers)) {
    if (!await exists(target)) continue;
    const previouslyManaged = Boolean(previous?.launchers.some(file => path.resolve(file) === path.resolve(target))
      && await isManagedLauncher(target, previous.root));
    if (!previouslyManaged) throw new Error(`Refusing to replace unmanaged CLI launcher: ${target}`);
  }
}

export async function installStableCli(
  home: string,
  runtime: RuntimeInstall,
  previous?: RuntimeInstall & StableCliInstall
): Promise<StableCliInstall> {
  await preflightStableCli(home, previous);
  const launchers = stableCliTargets(home, previous?.launchers);
  const cli = path.join(runtime.root, "dist", "cli.js");
  for (const launcher of launchers) {
    await mkdir(path.dirname(launcher), { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      await atomicWrite(launcher, `@echo off\r\nrem managed by linger-skill\r\n"${process.execPath.replaceAll('"', '""')}" "${cli.replaceAll('"', '""')}" %*\r\n`);
    } else {
      await atomicWrite(launcher, `#!/bin/sh\n# managed by linger-skill\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`);
      await chmod(launcher, 0o700);
    }
  }
  return { launchers };
}

export async function uninstallStableCli(runtimeRoot: string, launchers: string[]): Promise<string[]> {
  const removed: string[] = [];
  for (const launcher of launchers) {
    if (!await isManagedLauncher(launcher, runtimeRoot)) continue;
    await rm(launcher, { force: true });
    removed.push(launcher);
  }
  return removed;
}

export async function uninstallRuntime(home: string, runtimeRoot: string): Promise<boolean> {
  const allowed = path.join(home, ".linger", "runtime");
  if (path.resolve(path.dirname(runtimeRoot)) !== path.resolve(allowed)) throw new Error("Refusing to remove runtime outside managed root");
  assertSafeId(path.basename(runtimeRoot), "runtime version");
  const relative = path.relative(path.resolve(allowed), path.resolve(runtimeRoot));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Refusing to remove runtime outside managed root");
  if (!await exists(path.join(runtimeRoot, ".linger-managed"))) return false;
  await rm(runtimeRoot, { recursive: true, force: true });
  return true;
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
function quote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }

function stableCliTargets(home: string, previous: string[] = []): string[] {
  const primary = process.platform === "win32"
    ? path.join(home, ".linger", "bin", "linger.cmd")
    : path.join(home, ".local", "bin", "linger");
  // Preserve previously advertised absolute paths across upgrades.
  return [...new Set([primary, ...previous].map(file => path.resolve(file)))];
}

async function isManagedLauncher(file: string, runtimeRoot: string): Promise<boolean> {
  try {
    const content = await readFile(file, "utf8");
    const cli = path.join(runtimeRoot, "dist", "cli.js");
    const launcherShape = content.startsWith("#!/bin/sh\n") || content.startsWith("@echo off\r\n");
    return launcherShape && content.includes(cli);
  } catch {
    return false;
  }
}
