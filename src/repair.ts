import { rename } from "node:fs/promises";
import path from "node:path";
import { readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";
import { listJsonFiles } from "./vault.js";

export async function quarantineInvalidFiles(root: string): Promise<{ quarantined: string[]; skipped: string[] }> {
  const p = vaultPaths(root);
  const quarantined: string[] = [];
  const skipped: string[] = [];
  const groups: Array<{ dir: string; kind: string; read: (file: string) => Promise<unknown> }> = [
    { dir: p.raw, kind: "raw", read: file => readJson<RawEvent>(file) },
    { dir: p.processed, kind: "processed", read: file => readJson<ProcessedMemory>(file) },
    { dir: p.queue, kind: "queue", read: file => readJson<QueueItem>(file) },
    { dir: path.join(p.tmp, "pending"), kind: "pending", read: file => readJson<unknown>(file) }
  ];
  for (const group of groups) {
    for (const file of await listJsonFiles(group.dir)) {
      try { await group.read(file); }
      catch {
        const relative = path.relative(group.dir, file);
        if (relative.startsWith("..") || path.isAbsolute(relative)) { skipped.push(file); continue; }
        const destination = path.join(p.quarantine, group.kind, `${Date.now()}-${relative}`);
        const { ensureDir } = await import("./io.js");
        await ensureDir(path.dirname(destination));
        await rename(file, destination);
        quarantined.push(path.relative(p.root, destination));
      }
    }
  }
  return { quarantined, skipped };
}
