import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeId } from "./paths.js";

export interface RuntimeInstall { root: string; version: string; files: string[]; }

export async function installRuntime(home: string, packageRoot: string): Promise<RuntimeInstall> {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as unknown;
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson) || typeof (packageJson as Record<string, unknown>).version !== "string") throw new Error("Invalid package version");
  const version = assertSafeId((packageJson as { version: string }).version, "package version");
  const sourceDist = path.join(packageRoot, "dist");
  await stat(path.join(sourceDist, "hook-cli.js"));
  const root = path.join(home, ".linger", "runtime", version);
  const managed = path.join(root, ".linger-managed");
  if (await exists(root)) {
    if (!await exists(managed)) throw new Error(`Refusing to replace unmanaged runtime: ${root}`);
    await rm(root, { recursive: true, force: true });
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await cp(sourceDist, path.join(root, "dist"), { recursive: true });
  await writeFile(managed, "managed by linger-skill\n", { mode: 0o600 });
  return { root, version, files: [path.join(root, "dist"), managed] };
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

async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }
