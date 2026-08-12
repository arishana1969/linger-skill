import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { embeddingIndexStatus } from "./local/embedding-index.js";
import { resolveEffectiveSearchDocuments } from "./effective-search-document.js";
import { vaultPaths } from "./paths.js";
import { serializeProcessedMarkdown } from "./processed-markdown.js";
import { inspectVaultRecord, listVaultRecordCandidates, type VaultRecordKind } from "./record-inspection.js";
import { assertVaultConfig } from "./schema-validation.js";
import { listVaultJsonCandidates } from "./vault-candidates.js";
import { projectLocatorErrors, readVaultConfig } from "./vault.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";

export interface DoctorReport {
  ok: boolean;
  state: "healthy" | "degraded" | "broken";
  errors: string[];
  warnings: string[];
}

const ERROR_NAMES: Record<VaultRecordKind, string> = {
  raw: "raw",
  processed: "processed",
  enrichment: "enrichment",
  queue: "queue",
  pending: "pending",
  decision: "decision",
  tag_registry: "tag_registry",
  memory_control: "memory_control",
  term_relation: "term_relation",
  project_record: "project_record",
  sequence: "sequence",
  processing_history: "processing_history",
  adapter_evidence: "adapter_evidence",
  lifecycle_evidence: "lifecycle_evidence",
  session_control: "session_control",
  recall_sample: "recall_sample",
  enrichment_batch: "enrichment_batch"
};

export async function doctor(root: string): Promise<DoctorReport> {
  const p = vaultPaths(root);
  const report: DoctorReport = { ok: true, state: "healthy", errors: [], warnings: [] };
  let integrityFailure = false;
  try {
    const config = await readVaultConfig(root);
    if (!config) throw new Error("missing config");
    assertVaultConfig(config);
  } catch {
    report.errors.push("invalid_vault_config:config.json");
  }

  const projects = new Set<string>();
  let backlog = 0;
  for (const candidate of await listVaultRecordCandidates(root)) {
    try {
      const value = await inspectVaultRecord(root, candidate);
      if (candidate.kind === "raw") {
        const event = value as RawEvent;
        if (createHash("sha256").update(event.content).digest("hex") !== event.content_hash) {
          report.warnings.push(`tampered:${path.relative(p.root, candidate.file)}`);
          integrityFailure = true;
        }
      }
      if (candidate.kind === "processed") {
        const memory = value as ProcessedMemory;
        projects.add(memory.project_id);
        const markdown = path.join(p.processed, memory.project_id, `${memory.id}.md`);
        try {
          if (await readFile(markdown, "utf8") !== serializeProcessedMarkdown(memory)) report.warnings.push(`processed_markdown_stale:${memory.id}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") report.warnings.push(`processed_markdown_missing:${memory.id}`);
          else report.errors.push(`invalid_processed_markdown:${memory.id}`);
        }
      }
      if (candidate.kind === "enrichment") projects.add((value as { project_id: string }).project_id);
      if (candidate.kind === "pending") report.warnings.push(`pending_capture:${(value as { pending_id: string }).pending_id}`);
      if (candidate.kind === "queue") {
        const queue = value as QueueItem;
        if (queue.status === "pending" || queue.status === "failed") backlog += 1;
        if (queue.status === "failed") report.warnings.push(`failed_task:${queue.task_id}`);
      }
    } catch {
      report.errors.push(`invalid_${ERROR_NAMES[candidate.kind]}:${path.relative(p.root, candidate.file)}`);
    }
  }

  for (const project of [...projects].sort()) {
    for (const document of await resolveEffectiveSearchDocuments(root, project, { maxFiles: 50_000 })) {
      for (const reason of new Set([...document.ineligible_reasons, ...document.warning_flags])) {
        if (!isDocumentIntegrityReason(reason)) continue;
        report.warnings.push(`effective_document:${document.memory_id}:${reason}`);
        if (!isDegradedDocumentReason(reason)) integrityFailure = true;
      }
    }
  }

  for (const file of await projectLocatorErrors(root)) report.errors.push(`invalid_project_locator:${file}`);
  const embeddingProjects = new Set<string>();
  for (const file of await listVaultJsonCandidates(p.embeddings, p.root)) {
    const project = path.relative(p.embeddings, file).split(path.sep)[0];
    if (project && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(project)) embeddingProjects.add(project);
  }
  for (const project of [...embeddingProjects].sort()) {
    if (await embeddingIndexStatus(root, project) === "failed") {
      report.errors.push(`invalid_embedding_index:${project}`);
      integrityFailure = true;
    }
  }
  if (backlog > 100) report.warnings.push(`severe_backlog:${backlog}`);
  report.ok = report.errors.length === 0 && !integrityFailure;
  report.state = report.errors.length ? "broken" : report.warnings.length || integrityFailure ? "degraded" : "healthy";
  return report;
}

function isDocumentIntegrityReason(reason: string): boolean {
  return [
    "missing_source",
    "tampered_source",
    "source_hash_mismatch",
    "source_set_mismatch",
    "wrong_project",
    "invalid_source_path",
    "partial_source",
    "unverified_source",
    "invalid_overlay",
    "stale_overlay"
  ].includes(reason);
}

function isDegradedDocumentReason(reason: string): boolean {
  return ["partial_source", "unverified_source", "invalid_overlay", "stale_overlay"].includes(reason);
}
