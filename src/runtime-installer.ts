import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RuntimeInstall { root: string; version: string; files: string[]; }

export async function installRuntime(home: string, packageRoot: string): Promise<RuntimeInstall> {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version: string };
  const sourceDist = path.join(packageRoot, "dist");
  await stat(path.join(sourceDist, "hook-cli.js"));
  const root = path.join(home, ".continuity", "runtime", packageJson.version);
  const managed = path.join(root, ".continuity-managed");
  if (await exists(root)) {
    if (!await exists(managed)) throw new Error(`Refusing to replace unmanaged runtime: ${root}`);
    await rm(root, { recursive: true, force: true });
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await cp(sourceDist, path.join(root, "dist"), { recursive: true });
  await writeFile(managed, "managed by continuity-skill\n", { mode: 0o600 });
  return { root, version: packageJson.version, files: [path.join(root, "dist"), managed] };
}

export async function uninstallRuntime(home: string, runtimeRoot: string): Promise<boolean> {
  const allowed = path.join(home, ".continuity", "runtime");
  const relative = path.relative(path.resolve(allowed), path.resolve(runtimeRoot));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Refusing to remove runtime outside managed root");
  if (!await exists(path.join(runtimeRoot, ".continuity-managed"))) return false;
  await rm(runtimeRoot, { recursive: true, force: true });
  return true;
}

async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }
