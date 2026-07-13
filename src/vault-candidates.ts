import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export async function listVaultJsonCandidates(target: string): Promise<string[]> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) return [target];
    if (info.isFile()) return target.endsWith(".json") ? [target] : [];
    if (!info.isDirectory()) return [];
    const entries = await readdir(target, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(target, entry.name);
      if (entry.isSymbolicLink()) files.push(child);
      else if (entry.isDirectory()) files.push(...await listVaultJsonCandidates(child));
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(child);
    }
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
