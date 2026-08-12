import path from "node:path";
import { assertCodexAdapterEvidence, assertCodexAdapterEvidencePath } from "./adapter-evidence.js";
import { assertEnrichmentBatchPath, assertEnrichmentBatchRecord, assertEnrichmentOverlay, assertEnrichmentOverlayPath } from "./enrichment.js";
import { assertReadableInside, readJson } from "./io.js";
import { assertLifecycleEvidence, assertLifecycleEvidencePath } from "./lifecycle-evidence.js";
import { vaultPaths } from "./paths.js";
import { assertRecallSampleRecord } from "./recall-sampling.js";
import { assertSessionControlRecord } from "./session-control.js";
import {
  assertDecisionEvent,
  assertDecisionView,
  assertMemoryControlEvent,
  assertPendingCapture,
  assertProcessedMemory,
  assertProcessingRunHistory,
  assertProjectRecord,
  assertQueueItem,
  assertRawEvent,
  assertSequenceState,
  assertTagRegistry,
  assertTermRelation
} from "./schema-validation.js";
import {
  assertDecisionEventPath,
  assertDecisionViewPath,
  assertMemoryControlPath,
  assertPendingRecordPath,
  assertProcessedRecordPath,
  assertProjectRecordPath,
  assertQueueRecordPath,
  assertRawRecordPath,
  assertTagRegistryPath,
  assertTermRelationPath
} from "./record-paths.js";
import { listVaultJsonCandidates } from "./vault-candidates.js";

export type VaultRecordKind =
  | "raw"
  | "processed"
  | "enrichment"
  | "queue"
  | "pending"
  | "decision"
  | "tag_registry"
  | "memory_control"
  | "term_relation"
  | "project_record"
  | "sequence"
  | "processing_history"
  | "adapter_evidence"
  | "lifecycle_evidence"
  | "session_control"
  | "recall_sample"
  | "enrichment_batch";

export interface VaultRecordCandidate {
  file: string;
  kind: VaultRecordKind;
  repairable: boolean;
}

export async function listVaultRecordCandidates(root: string): Promise<VaultRecordCandidate[]> {
  const p = vaultPaths(root);
  const groups: Array<{ dir: string; kind: VaultRecordKind; repairable?: boolean }> = [
    { dir: p.raw, kind: "raw" },
    { dir: p.processed, kind: "processed" },
    { dir: p.enrichments, kind: "enrichment" },
    { dir: p.queue, kind: "queue" },
    { dir: path.join(p.tmp, "pending"), kind: "pending" },
    { dir: p.decisions, kind: "decision" },
    { dir: path.join(p.registry, "tags"), kind: "tag_registry" },
    { dir: path.join(p.registry, "memory-events"), kind: "memory_control" },
    { dir: path.join(p.registry, "term-graph"), kind: "term_relation" },
    { dir: p.projects, kind: "project_record" },
    { dir: path.join(p.registry, "processing-runs"), kind: "processing_history" },
    { dir: path.join(p.registry, "adapter-evidence"), kind: "adapter_evidence" },
    { dir: path.join(p.registry, "lifecycle-evidence", "v3"), kind: "lifecycle_evidence", repairable: false },
    { dir: path.join(p.registry, "session-controls"), kind: "session_control" },
    { dir: path.join(p.registry, "recall-samples"), kind: "recall_sample" },
    { dir: path.join(p.registry, "enrichment-batches"), kind: "enrichment_batch" }
  ];
  const candidates: VaultRecordCandidate[] = [];
  for (const group of groups) {
    for (const file of await listVaultJsonCandidates(group.dir, p.root)) {
      candidates.push({ file, kind: group.kind, repairable: group.repairable !== false });
    }
  }
  for (const file of (await listVaultJsonCandidates(p.registry, p.root)).filter(file => path.dirname(file) === p.registry && file.endsWith(".sequence.json"))) {
    candidates.push({ file, kind: "sequence", repairable: true });
  }
  return candidates.sort((a, b) => a.file.localeCompare(b.file));
}

export async function inspectVaultRecord(root: string, candidate: VaultRecordCandidate): Promise<unknown> {
  const p = vaultPaths(root);
  await assertReadableInside(p.root, candidate.file);
  const value = await readJson<unknown>(candidate.file);
  switch (candidate.kind) {
    case "raw": assertRawEvent(value); assertRawRecordPath(p, candidate.file, value); break;
    case "processed": assertProcessedMemory(value); assertProcessedRecordPath(p, candidate.file, value); break;
    case "enrichment": assertEnrichmentOverlay(value); assertEnrichmentOverlayPath(p.root, candidate.file, value); break;
    case "queue": assertQueueItem(value); assertQueueRecordPath(p, candidate.file, value); break;
    case "pending": assertPendingCapture(value); assertPendingRecordPath(p, candidate.file, value); break;
    case "decision":
      if (path.basename(candidate.file) === "current.json") { assertDecisionView(value); assertDecisionViewPath(p, candidate.file, value); }
      else { assertDecisionEvent(value); assertDecisionEventPath(p, candidate.file, value); }
      break;
    case "tag_registry": assertTagRegistry(value); assertTagRegistryPath(p, candidate.file, value); break;
    case "memory_control": assertMemoryControlEvent(value); assertMemoryControlPath(p, candidate.file, value); break;
    case "term_relation": assertTermRelation(value); assertTermRelationPath(p, candidate.file, value); break;
    case "project_record": assertProjectRecord(value); assertProjectRecordPath(p, candidate.file, value); break;
    case "sequence": assertSequenceState(value); break;
    case "processing_history": assertProcessingRunHistory(value); break;
    case "adapter_evidence": assertCodexAdapterEvidence(value); assertCodexAdapterEvidencePath(p.root, candidate.file); break;
    case "lifecycle_evidence": assertLifecycleEvidence(value); assertLifecycleEvidencePath(root, candidate.file, value); break;
    case "session_control": assertSessionControlRecord(root, candidate.file, value); break;
    case "recall_sample": assertRecallSampleRecord(p.root, candidate.file, value); break;
    case "enrichment_batch": assertEnrichmentBatchRecord(value); assertEnrichmentBatchPath(p.root, candidate.file, value); break;
  }
  return value;
}
