import { createHash } from "node:crypto";
import path from "node:path";
import { readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import { assertDecisionEvent, assertDecisionView, assertMemoryControlEvent, assertPendingCapture, assertProcessedMemory, assertProjectRecord, assertQueueItem, assertRawEvent, assertTagRegistry, assertTermRelation } from "./schema-validation.js";
import { assertProcessedRecordPath, assertQueueRecordPath, assertRawRecordPath } from "./record-paths.js";
import { initVault, listJsonFiles } from "./vault.js";

export interface DoctorReport { ok: boolean; errors: string[]; warnings: string[]; }

export async function doctor(root: string): Promise<DoctorReport> {
  await initVault(root);
  const p = vaultPaths(root);
  const report: DoctorReport = { ok: true, errors: [], warnings: [] };
  const rawHashes = new Map<string, string>();
  for (const file of await listJsonFiles(p.raw)) {
    try {
      const event = await readJson<unknown>(file);
      assertRawEvent(event);
      assertRawRecordPath(p, file, event);
      const hash = createHash("sha256").update(event.content).digest("hex");
      rawHashes.set(event.event_id, hash);
      if (hash !== event.content_hash) report.warnings.push(`tampered:${path.relative(p.root, file)}`);
    } catch { report.errors.push(`invalid_raw:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(p.processed)) {
    try {
      const memory = await readJson<unknown>(file);
      assertProcessedMemory(memory);
      assertProcessedRecordPath(p, file, memory);
      if (!memory.source_events.length) report.warnings.push(`missing_evidence:${memory.id}`);
      if (memory.source_hash) {
        const verified = memory.source_events.some(eventId => rawHashes.get(eventId) === memory.source_hash);
        if (!verified) report.warnings.push(`processed_source_mismatch:${memory.id}`);
      }
    } catch { report.errors.push(`invalid_processed:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(p.decisions)) {
    try {
      const value = await readJson<unknown>(file);
      if (path.basename(file) === "current.json") assertDecisionView(value);
      else assertDecisionEvent(value);
    } catch { report.errors.push(`invalid_decision:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.registry, "tags"))) {
    try { const value = await readJson<unknown>(file); assertTagRegistry(value); }
    catch { report.errors.push(`invalid_tag_registry:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.registry, "memory-events"))) {
    try { const value = await readJson<unknown>(file); assertMemoryControlEvent(value); }
    catch { report.errors.push(`invalid_memory_control:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.registry, "term-graph"))) {
    try { const value = await readJson<unknown>(file); assertTermRelation(value); }
    catch { report.errors.push(`invalid_term_relation:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(p.projects)) {
    try { const value = await readJson<unknown>(file); assertProjectRecord(value); }
    catch { report.errors.push(`invalid_project_record:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.tmp, "pending"))) {
    try { const pending = await readJson<unknown>(file); assertPendingCapture(pending); report.warnings.push(`pending_capture:${pending.pending_id}`); }
    catch { report.errors.push(`invalid_pending:${path.relative(p.root, file)}`); }
  }
  let backlog = 0;
  for (const file of await listJsonFiles(p.queue)) {
    try {
      const item = await readJson<unknown>(file);
      assertQueueItem(item);
      assertQueueRecordPath(p, file, item);
      if (item.status === "pending" || item.status === "failed") backlog += 1;
      if (item.status === "failed") report.warnings.push(`failed_task:${item.task_id}`);
    } catch { report.errors.push(`invalid_queue:${path.relative(p.root, file)}`); }
  }
  if (backlog > 100) report.warnings.push(`severe_backlog:${backlog}`);
  report.ok = report.errors.length === 0;
  return report;
}
