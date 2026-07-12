import { rename } from "node:fs/promises";
import path from "node:path";
import { readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import { assertDecisionEvent, assertDecisionView, assertPendingCapture, assertProcessedMemory, assertQueueItem, assertRawEvent } from "./schema-validation.js";
import { listJsonFiles } from "./vault.js";

export async function quarantineInvalidFiles(root: string): Promise<{ quarantined: string[]; skipped: string[] }> {
  const p = vaultPaths(root);
  const quarantined: string[] = [];
  const skipped: string[] = [];
  const groups: Array<{ dir: string; kind: string; read: (file: string) => Promise<unknown> }> = [
    { dir: p.raw, kind: "raw", read: async file => { const value = await readJson<unknown>(file); assertRawEvent(value); } },
    { dir: p.processed, kind: "processed", read: async file => { const value = await readJson<unknown>(file); assertProcessedMemory(value); } },
    { dir: p.queue, kind: "queue", read: async file => { const value = await readJson<unknown>(file); assertQueueItem(value); } },
    { dir: path.join(p.tmp, "pending"), kind: "pending", read: async file => { const value = await readJson<unknown>(file); assertPendingCapture(value); } },
    { dir: p.decisions, kind: "decision", read: async file => { const value = await readJson<unknown>(file); if (path.basename(file) === "current.json") assertDecisionView(value); else assertDecisionEvent(value); } }
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
