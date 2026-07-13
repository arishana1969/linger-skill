import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { assertReadableInside, assertWritableInside } from "./io.js";

export async function listVaultJsonCandidates(target: string, boundaryRoot: string): Promise<string[]> {
  try {
    await assertWritableInside(boundaryRoot, target);
    await assertReadableInside(boundaryRoot, target);
    const info = await lstat(target);
    if (info.isSymbolicLink()) return [target];
    if (info.isFile()) return target.endsWith(".json") ? [target] : [];
    if (!info.isDirectory()) return [];
    const entries = await readdir(target, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(target, entry.name);
      if (entry.isSymbolicLink()) files.push(child);
      else if (entry.isDirectory()) files.push(...await listVaultJsonCandidates(child, boundaryRoot));
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(child);
    }
    return files;
  } catch (error) {
    const symlink = await firstSymlink(boundaryRoot, target);
    if (symlink) return [symlink];
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function firstSymlink(root: string, target: string): Promise<string | undefined> {
  const rootResolved = path.resolve(root);
  const relative = path.relative(rootResolved, path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  let current = rootResolved;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) return current; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  return undefined;
}
