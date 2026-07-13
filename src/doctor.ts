import { createHash } from "node:crypto";
import path from "node:path";
import { assertReadableInside, readJson } from "./io.js";
import { assertCodexAdapterEvidence, assertCodexAdapterEvidencePath } from "./adapter-evidence.js";
import { assertEnrichmentBatchPath, assertEnrichmentBatchRecord, assertEnrichmentOverlay, assertEnrichmentOverlayPath } from "./enrichment.js";
import { vaultPaths } from "./paths.js";
import { assertRecallSampleRecord } from "./recall-sampling.js";
import { assertDecisionEvent, assertDecisionView, assertMemoryControlEvent, assertPendingCapture, assertProcessedMemory, assertProcessingRunHistory, assertProjectRecord, assertQueueItem, assertRawEvent, assertSequenceState, assertTagRegistry, assertTermRelation, assertVaultConfig } from "./schema-validation.js";
import { assertDecisionEventPath, assertDecisionViewPath, assertMemoryControlPath, assertPendingRecordPath, assertProcessedRecordPath, assertProjectRecordPath, assertQueueRecordPath, assertRawRecordPath, assertTagRegistryPath, assertTermRelationPath } from "./record-paths.js";
import { initVault } from "./vault.js";
import { listVaultJsonCandidates } from "./vault-candidates.js";

export interface DoctorReport { ok: boolean; errors: string[]; warnings: string[]; }

export async function doctor(root: string): Promise<DoctorReport> {
  const p = vaultPaths(root);
  const report: DoctorReport = { ok: true, errors: [], warnings: [] };
  try { await initVault(root); const config = await readVaultJson(p.root, p.config); assertVaultConfig(config); }
  catch { report.errors.push("invalid_vault_config:config.json"); }
  const rawHashes = new Map<string, string>();
  const processed = new Map<string, { source_hash?: string; source_events: string[] }>();
  for (const file of await listVaultJsonCandidates(p.raw, p.root)) {
    try {
      const event = await readVaultJson(p.root, file);
      assertRawEvent(event);
      assertRawRecordPath(p, file, event);
      const hash = createHash("sha256").update(event.content).digest("hex");
      rawHashes.set(event.event_id, hash);
      if (hash !== event.content_hash) report.warnings.push(`tampered:${path.relative(p.root, file)}`);
    } catch { report.errors.push(`invalid_raw:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(p.processed, p.root)) {
    try {
      const memory = await readVaultJson(p.root, file);
      assertProcessedMemory(memory);
      assertProcessedRecordPath(p, file, memory);
      processed.set(memory.id, { source_hash: memory.source_hash, source_events: memory.source_events });
      if (!memory.source_events.length) report.warnings.push(`missing_evidence:${memory.id}`);
      if (memory.source_hash) {
        const verified = memory.source_events.some(eventId => rawHashes.get(eventId) === memory.source_hash);
        if (!verified) report.warnings.push(`processed_source_mismatch:${memory.id}`);
      }
    } catch { report.errors.push(`invalid_processed:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(p.enrichments, p.root)) {
    try {
      const overlay = await readVaultJson(p.root, file);
      assertEnrichmentOverlay(overlay);
      assertEnrichmentOverlayPath(p.root, file, overlay);
      const source = processed.get(overlay.memory_id);
      if (!source || source.source_hash !== overlay.source_hash || source.source_events.length !== overlay.source_events.length || !source.source_events.every(event => overlay.source_events.includes(event))) {
        report.warnings.push(`stale_enrichment:${overlay.memory_id}`);
      }
    } catch { report.errors.push(`invalid_enrichment:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(p.decisions, p.root)) {
    try {
      const value = await readVaultJson(p.root, file);
      if (path.basename(file) === "current.json") { assertDecisionView(value); assertDecisionViewPath(p, file, value); }
      else { assertDecisionEvent(value); assertDecisionEventPath(p, file, value); }
    } catch { report.errors.push(`invalid_decision:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "tags"), p.root)) {
    try { const value = await readVaultJson(p.root, file); assertTagRegistry(value); assertTagRegistryPath(p, file, value); }
    catch { report.errors.push(`invalid_tag_registry:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "memory-events"), p.root)) {
    try { const value = await readVaultJson(p.root, file); assertMemoryControlEvent(value); assertMemoryControlPath(p, file, value); }
    catch { report.errors.push(`invalid_memory_control:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "term-graph"), p.root)) {
    try { const value = await readVaultJson(p.root, file); assertTermRelation(value); assertTermRelationPath(p, file, value); }
    catch { report.errors.push(`invalid_term_relation:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(p.projects, p.root)) {
    try { const value = await readVaultJson(p.root, file); assertProjectRecord(value); assertProjectRecordPath(p, file, value); }
    catch { report.errors.push(`invalid_project_record:${path.relative(p.root, file)}`); }
  }
  for (const file of (await listVaultJsonCandidates(p.registry, p.root)).filter(file => path.dirname(file) === p.registry && file.endsWith(".sequence.json"))) {
    try { const value = await readVaultJson(p.root, file); assertSequenceState(value); }
    catch { report.errors.push(`invalid_sequence:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "processing-runs"), p.root)) {
    try { const value = await readVaultJson(p.root, file); assertProcessingRunHistory(value); }
    catch { report.errors.push(`invalid_processing_history:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "adapter-evidence"), p.root)) {
    try {
      const value = await readVaultJson(p.root, file);
      assertCodexAdapterEvidence(value);
      assertCodexAdapterEvidencePath(p.root, file);
    } catch { report.errors.push(`invalid_adapter_evidence:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "recall-samples"), p.root)) {
    try {
      assertRecallSampleRecord(p.root, file, await readVaultJson(p.root, file));
    } catch { report.errors.push(`invalid_recall_sample:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.registry, "enrichment-batches"), p.root)) {
    try {
      const value = await readVaultJson(p.root, file);
      assertEnrichmentBatchRecord(value);
      assertEnrichmentBatchPath(p.root, file, value);
    } catch { report.errors.push(`invalid_enrichment_batch:${path.relative(p.root, file)}`); }
  }
  for (const file of await listVaultJsonCandidates(path.join(p.tmp, "pending"), p.root)) {
    try { const pending = await readVaultJson(p.root, file); assertPendingCapture(pending); assertPendingRecordPath(p, file, pending); report.warnings.push(`pending_capture:${pending.pending_id}`); }
    catch { report.errors.push(`invalid_pending:${path.relative(p.root, file)}`); }
  }
  let backlog = 0;
  for (const file of await listVaultJsonCandidates(p.queue, p.root)) {
    try {
      const item = await readVaultJson(p.root, file);
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

async function readVaultJson(root: string, file: string): Promise<unknown> {
  await assertReadableInside(root, file);
  return await readJson<unknown>(file);
}
