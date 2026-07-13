import { createHash } from "node:crypto";
import path from "node:path";
import { assertReadableInside, readJson } from "./io.js";
import { assertCodexAdapterEvidence, assertCodexAdapterEvidencePath } from "./adapter-evidence.js";
import { vaultPaths } from "./paths.js";
import { assertRecallSampleRecord } from "./recall-sampling.js";
import { assertDecisionEvent, assertDecisionView, assertMemoryControlEvent, assertPendingCapture, assertProcessedMemory, assertProcessingRunHistory, assertProjectRecord, assertQueueItem, assertRawEvent, assertSequenceState, assertTagRegistry, assertTermRelation, assertVaultConfig } from "./schema-validation.js";
import { assertDecisionEventPath, assertDecisionViewPath, assertMemoryControlPath, assertPendingRecordPath, assertProcessedRecordPath, assertProjectRecordPath, assertQueueRecordPath, assertRawRecordPath, assertTagRegistryPath, assertTermRelationPath } from "./record-paths.js";
import { initVault, listJsonFiles } from "./vault.js";
import { listVaultJsonCandidates } from "./vault-candidates.js";

export interface DoctorReport { ok: boolean; errors: string[]; warnings: string[]; }

export async function doctor(root: string): Promise<DoctorReport> {
  const p = vaultPaths(root);
  const report: DoctorReport = { ok: true, errors: [], warnings: [] };
  try { await initVault(root); const config = await readJson<unknown>(p.config); assertVaultConfig(config); }
  catch { report.errors.push("invalid_vault_config:config.json"); }
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
      if (path.basename(file) === "current.json") { assertDecisionView(value); assertDecisionViewPath(p, file, value); }
      else { assertDecisionEvent(value); assertDecisionEventPath(p, file, value); }
    } catch { report.errors.push(`invalid_decision:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.registry, "tags"))) {
    try { const value = await readJson<unknown>(file); assertTagRegistry(value); assertTagRegistryPath(p, file, value); }
    catch { report.errors.push(`invalid_tag_registry:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.registry, "memory-events"))) {
    try { const value = await readJson<unknown>(file); assertMemoryControlEvent(value); assertMemoryControlPath(p, file, value); }
    catch { report.errors.push(`invalid_memory_control:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.registry, "term-graph"))) {
    try { const value = await readJson<unknown>(file); assertTermRelation(value); assertTermRelationPath(p, file, value); }
    catch { report.errors.push(`invalid_term_relation:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(p.projects)) {
    try { const value = await readJson<unknown>(file); assertProjectRecord(value); assertProjectRecordPath(p, file, value); }
    catch { report.errors.push(`invalid_project_record:${path.relative(p.root, file)}`); }
  }
  for (const file of (await listJsonFiles(p.registry)).filter(file => path.dirname(file) === p.registry && file.endsWith(".sequence.json"))) {
    try { const value = await readJson<unknown>(file); assertSequenceState(value); }
    catch { report.errors.push(`invalid_sequence:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.registry, "processing-runs"))) {
    try { const value = await readJson<unknown>(file); assertProcessingRunHistory(value); }
    catch { report.errors.push(`invalid_processing_history:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "adapter-evidence"))) {
    try {
      await assertReadableInside(p.root, file);
      const value = await readJson<unknown>(file);
      assertCodexAdapterEvidence(value);
      assertCodexAdapterEvidencePath(p.root, file);
    } catch { report.errors.push(`invalid_adapter_evidence:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "recall-samples"))) {
    try {
      await assertReadableInside(p.root, file);
      assertRecallSampleRecord(p.root, file, await readJson<unknown>(file));
    } catch { report.errors.push(`invalid_recall_sample:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.tmp, "pending"))) {
    try { const pending = await readJson<unknown>(file); assertPendingCapture(pending); assertPendingRecordPath(p, file, pending); report.warnings.push(`pending_capture:${pending.pending_id}`); }
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
