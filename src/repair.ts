import { rename } from "node:fs/promises";
import path from "node:path";
import { readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import { assertDecisionEvent, assertDecisionView, assertMemoryControlEvent, assertPendingCapture, assertProcessedMemory, assertProcessingRunHistory, assertProjectRecord, assertQueueItem, assertRawEvent, assertSequenceState, assertTagRegistry, assertTermRelation, assertVaultConfig } from "./schema-validation.js";
import { assertDecisionEventPath, assertDecisionViewPath, assertMemoryControlPath, assertPendingRecordPath, assertProcessedRecordPath, assertProjectRecordPath, assertQueueRecordPath, assertRawRecordPath, assertTagRegistryPath, assertTermRelationPath } from "./record-paths.js";
import { listJsonFiles } from "./vault.js";

export async function quarantineInvalidFiles(root: string): Promise<{ quarantined: string[]; skipped: string[] }> {
  const p = vaultPaths(root);
  const quarantined: string[] = [];
  const skipped: string[] = [];
  try { const value = await readJson<unknown>(p.config); assertVaultConfig(value); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") await quarantineFile(p, "vault-config", p.root, p.config, quarantined, skipped);
  }
  const groups: Array<{ dir: string; kind: string; read: (file: string) => Promise<unknown> }> = [
    { dir: p.raw, kind: "raw", read: async file => { const value = await readJson<unknown>(file); assertRawEvent(value); assertRawRecordPath(p, file, value); } },
    { dir: p.processed, kind: "processed", read: async file => { const value = await readJson<unknown>(file); assertProcessedMemory(value); assertProcessedRecordPath(p, file, value); } },
    { dir: p.queue, kind: "queue", read: async file => { const value = await readJson<unknown>(file); assertQueueItem(value); assertQueueRecordPath(p, file, value); } },
    { dir: path.join(p.tmp, "pending"), kind: "pending", read: async file => { const value = await readJson<unknown>(file); assertPendingCapture(value); assertPendingRecordPath(p, file, value); } },
    { dir: p.decisions, kind: "decision", read: async file => { const value = await readJson<unknown>(file); if (path.basename(file) === "current.json") { assertDecisionView(value); assertDecisionViewPath(p, file, value); } else { assertDecisionEvent(value); assertDecisionEventPath(p, file, value); } } },
    { dir: path.join(p.registry, "tags"), kind: "tag-registry", read: async file => { const value = await readJson<unknown>(file); assertTagRegistry(value); assertTagRegistryPath(p, file, value); } },
    { dir: path.join(p.registry, "memory-events"), kind: "memory-control", read: async file => { const value = await readJson<unknown>(file); assertMemoryControlEvent(value); assertMemoryControlPath(p, file, value); } },
    { dir: path.join(p.registry, "term-graph"), kind: "term-relation", read: async file => { const value = await readJson<unknown>(file); assertTermRelation(value); assertTermRelationPath(p, file, value); } },
    { dir: p.projects, kind: "project-record", read: async file => { const value = await readJson<unknown>(file); assertProjectRecord(value); assertProjectRecordPath(p, file, value); } },
    { dir: path.join(p.registry, "processing-runs"), kind: "processing-history", read: async file => { const value = await readJson<unknown>(file); assertProcessingRunHistory(value); } }
  ];
  for (const group of groups) {
    for (const file of await listJsonFiles(group.dir)) {
      try { await group.read(file); }
      catch { await quarantineFile(p, group.kind, group.dir, file, quarantined, skipped); }
    }
  }
  for (const file of (await listJsonFiles(p.registry)).filter(file => path.dirname(file) === p.registry && file.endsWith(".sequence.json"))) {
    try { const value = await readJson<unknown>(file); assertSequenceState(value); }
    catch { await quarantineFile(p, "sequence", p.registry, file, quarantined, skipped); }
  }
  return { quarantined, skipped };
}

async function quarantineFile(p: ReturnType<typeof vaultPaths>, kind: string, base: string, file: string, quarantined: string[], skipped: string[]): Promise<void> {
  const relative = path.relative(base, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) { skipped.push(file); return; }
  const destination = path.join(p.quarantine, kind, `${Date.now()}-${relative}`);
  const { ensureDir } = await import("./io.js");
  await ensureDir(path.dirname(destination));
  await rename(file, destination);
  quarantined.push(path.relative(p.root, destination));
}
