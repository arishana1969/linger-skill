import { createHash, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { effectiveMemoryStates } from "./memory-events.js";
import { assertReadableInside, assertWritableInside, atomicJson, readJson } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertProcessedMemory, assertRawEvent } from "./schema-validation.js";
import { assertProcessedRecordPath, assertRawRecordPath } from "./record-paths.js";
import { classifySensitivity } from "./sensitivity.js";
import type { ProcessedMemory, RawEvent } from "./types.js";
import { listJsonFiles } from "./vault.js";

export type HostAgent = "codex" | "claude-code";

export interface EnrichmentOverlay {
  schema_version: 1;
  enrichment_id: string;
  project_id: string;
  memory_id: string;
  source_events: string[];
  source_hash: string;
  type: ProcessedMemory["type"];
  title: string;
  summary: string;
  tags: string[];
  predictive_tags: string[];
  retrieval_phrases: string[];
  agent: HostAgent;
  model?: string;
  created_at: string;
}

export interface EnrichmentBatchTarget {
  memory_id: string;
  source_events: string[];
  source_hash: string;
}

export interface EnrichmentBatchRecord {
  schema_version: 1;
  batch_id: string;
  project_id: string;
  targets: EnrichmentBatchTarget[];
  created_at: string;
}

export interface EnrichmentBatchItem extends EnrichmentBatchTarget {
  baseline: Pick<ProcessedMemory, "type" | "title" | "summary" | "tags" | "predictive_tags" | "retrieval_phrases" | "source" | "confidence" | "source_savepoint_status">;
  evidence: Array<Pick<RawEvent, "event_id" | "session_id" | "turn_id" | "role" | "timestamp" | "content" | "savepoint_status"> & { content_truncated: boolean }>;
}

export interface EnrichmentBatch {
  schema_version: 1;
  batch_id: string;
  project_id: string;
  created_at: string;
  items: EnrichmentBatchItem[];
}

export interface EnrichmentSubmissionItem {
  memory_id: string;
  evidence_refs: string[];
  type: ProcessedMemory["type"];
  title: string;
  summary: string;
  tags: string[];
  predictive_tags: string[];
  retrieval_phrases: string[];
}

export interface EnrichmentSubmission {
  schema_version: 1;
  batch_id: string;
  project_id: string;
  agent: HostAgent;
  model?: string;
  items: EnrichmentSubmissionItem[];
}

const MEMORY_TYPES = new Set<ProcessedMemory["type"]>(["conversation", "idea", "preference", "proposal", "rationale", "constraint", "rejection", "decision", "current_state", "todo", "correction"]);

export async function prepareEnrichmentBatch(
  root: string,
  projectId: string,
  options: { limit?: number; maxCharacters?: number } = {}
): Promise<EnrichmentBatch | undefined> {
  const project = assertSafeId(projectId, "project id");
  const limit = boundedInteger(options.limit ?? 6, 1, 20, "enrichment batch limit");
  const maxCharacters = boundedInteger(options.maxCharacters ?? 12_000, 1_000, 50_000, "enrichment character budget");
  const p = vaultPaths(root);
  const states = await effectiveMemoryStates(root, project);
  const overlays = await readEnrichmentOverlays(root, project);
  const raw = await rawById(root, project);
  const candidates: ProcessedMemory[] = [];
  for (const file of await listJsonFiles(path.join(p.processed, project), p.root)) {
    try {
      const memory = await readJson<unknown>(file);
      assertProcessedMemory(memory);
      assertProcessedRecordPath(p, file, memory);
      if (memory.status !== "active" || memory.sensitivity !== "normal" || states.has(memory.id) || !memory.source_hash) continue;
      if (validOverlayForMemory(overlays.get(memory.id), memory)) continue;
      if (!verifiedSources(memory, raw)) continue;
      candidates.push(memory);
    } catch { /* doctor reports invalid records */ }
  }
  candidates.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const selected = candidates.slice(0, limit);
  if (!selected.length) return undefined;
  let remaining = maxCharacters;
  const items: EnrichmentBatchItem[] = [];
  for (const memory of selected) {
    const evidence: EnrichmentBatchItem["evidence"] = [];
    for (const eventId of memory.source_events) {
      const event = raw.get(eventId)!;
      const content = event.content.slice(0, Math.max(0, remaining));
      remaining -= content.length;
      evidence.push({
        event_id: event.event_id,
        session_id: event.session_id,
        turn_id: event.turn_id,
        role: event.role,
        timestamp: event.timestamp,
        content,
        savepoint_status: event.savepoint_status,
        content_truncated: content.length < event.content.length
      });
    }
    items.push({
      memory_id: memory.id,
      source_events: [...memory.source_events],
      source_hash: memory.source_hash!,
      baseline: {
        type: memory.type,
        title: memory.title,
        summary: memory.summary,
        tags: memory.tags,
        predictive_tags: memory.predictive_tags,
        retrieval_phrases: memory.retrieval_phrases,
        source: memory.source,
        confidence: memory.confidence,
        source_savepoint_status: memory.source_savepoint_status
      },
      evidence
    });
    if (remaining <= 0) break;
  }
  const createdAt = new Date().toISOString();
  const batch: EnrichmentBatch = {
    schema_version: 1,
    batch_id: `eb_${randomUUID().replaceAll("-", "")}`,
    project_id: project,
    created_at: createdAt,
    items
  };
  const record: EnrichmentBatchRecord = {
    schema_version: 1,
    batch_id: batch.batch_id,
    project_id: project,
    targets: items.map(item => ({ memory_id: item.memory_id, source_events: item.source_events, source_hash: item.source_hash })),
    created_at: createdAt
  };
  const file = path.join(p.registry, "enrichment-batches", project, `${batch.batch_id}.json`);
  await assertWritableInside(p.root, file);
  await atomicJson(file, record);
  return batch;
}

export async function commitEnrichment(root: string, value: unknown): Promise<{ committed: number; overlays: string[] }> {
  assertEnrichmentSubmission(value);
  const input = value;
  const p = vaultPaths(root);
  const batchFile = path.join(p.registry, "enrichment-batches", input.project_id, `${input.batch_id}.json`);
  await assertReadableInside(p.root, batchFile);
  const batch = await readJson<unknown>(batchFile);
  assertEnrichmentBatchRecord(batch);
  assertEnrichmentBatchPath(root, batchFile, batch);
  if (batch.project_id !== input.project_id || batch.batch_id !== input.batch_id) throw new Error("Enrichment submission does not match its batch");
  const targets = new Map(batch.targets.map(target => [target.memory_id, target]));
  const raw = await rawById(root, input.project_id);
  const prepared: Array<{ file: string; overlay: EnrichmentOverlay }> = [];
  for (const item of input.items) {
    const target = targets.get(item.memory_id);
    if (!target) throw new Error(`Enrichment item is not part of batch: ${item.memory_id}`);
    if (!sameSet(item.evidence_refs, target.source_events)) throw new Error(`Enrichment evidence mismatch: ${item.memory_id}`);
    const memoryFile = path.join(p.processed, input.project_id, `${item.memory_id}.json`);
    await assertReadableInside(p.root, memoryFile);
    const memory = await readJson<unknown>(memoryFile);
    assertProcessedMemory(memory);
    assertProcessedRecordPath(p, memoryFile, memory);
    if (memory.sensitivity !== "normal" || memory.source_hash !== target.source_hash || !sameSet(memory.source_events, target.source_events) || !verifiedSources(memory, raw)) {
      throw new Error(`Enrichment source is stale or unsafe: ${item.memory_id}`);
    }
    const createdAt = new Date().toISOString();
    const overlay: EnrichmentOverlay = {
      schema_version: 1,
      enrichment_id: enrichmentId(input, item, target.source_hash),
      project_id: input.project_id,
      memory_id: item.memory_id,
      source_events: [...target.source_events],
      source_hash: target.source_hash,
      type: item.type,
      title: item.title.trim(),
      summary: item.summary.trim(),
      tags: normalizedStrings(item.tags),
      predictive_tags: normalizedStrings(item.predictive_tags),
      retrieval_phrases: uniqueStrings(item.retrieval_phrases),
      agent: input.agent,
      ...(input.model ? { model: input.model.trim() } : {}),
      created_at: createdAt
    };
    assertEnrichmentOverlay(overlay);
    const file = path.join(p.enrichments, input.project_id, `${item.memory_id}.json`);
    await assertWritableInside(p.root, file);
    prepared.push({ file, overlay });
  }
  const written: string[] = [];
  for (const { file, overlay } of prepared) {
    await atomicJson(file, overlay);
    written.push(path.relative(p.root, file));
  }
  const { rebuildTagRegistry } = await import("./tag-registry.js");
  await rebuildTagRegistry(root, input.project_id);
  await unlink(batchFile);
  return { committed: written.length, overlays: written };
}

export async function enrichmentStatus(root: string, projectId: string): Promise<{ project_id: string; pending: number; enriched: number }> {
  const project = assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  const states = await effectiveMemoryStates(root, project);
  const overlays = await readEnrichmentOverlays(root, project);
  const raw = await rawById(root, project);
  let pending = 0;
  let enriched = 0;
  for (const file of await listJsonFiles(path.join(p.processed, project), p.root)) {
    try {
      const memory = await readJson<unknown>(file);
      assertProcessedMemory(memory);
      assertProcessedRecordPath(p, file, memory);
      if (memory.status !== "active" || memory.sensitivity !== "normal" || states.has(memory.id) || !memory.source_hash || !verifiedSources(memory, raw)) continue;
      if (validOverlayForMemory(overlays.get(memory.id), memory)) enriched += 1;
      else pending += 1;
    } catch { /* doctor reports invalid records */ }
  }
  return { project_id: project, pending, enriched };
}

export async function readEnrichmentOverlays(root: string, projectId: string): Promise<Map<string, EnrichmentOverlay>> {
  const project = assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  const overlays = new Map<string, EnrichmentOverlay>();
  for (const file of await listJsonFiles(path.join(p.enrichments, project), p.root)) {
    try {
      const overlay = await readJson<unknown>(file);
      assertEnrichmentOverlay(overlay);
      assertEnrichmentOverlayPath(root, file, overlay);
      overlays.set(overlay.memory_id, overlay);
    } catch { /* doctor reports invalid records */ }
  }
  return overlays;
}

export function applyEnrichment(memory: ProcessedMemory, overlay: EnrichmentOverlay | undefined): ProcessedMemory {
  if (!validOverlayForMemory(overlay, memory)) return memory;
  return {
    ...memory,
    type: overlay.type,
    title: overlay.title,
    summary: overlay.summary,
    tags: overlay.tags,
    predictive_tags: overlay.predictive_tags,
    retrieval_phrases: overlay.retrieval_phrases,
    updated_at: overlay.created_at,
    agent: `linger-host-enrichment:${overlay.agent}`,
    ...(overlay.model ? { model: overlay.model } : {})
  };
}

export function assertEnrichmentOverlay(value: unknown): asserts value is EnrichmentOverlay {
  const item = object(value, "enrichment overlay");
  if (item.schema_version !== 1) throw new Error("Invalid enrichment overlay schema");
  for (const field of ["enrichment_id", "project_id", "memory_id", "source_hash", "title", "summary", "agent", "created_at"] as const) {
    if (typeof item[field] !== "string" || !item[field]) throw new Error(`Invalid enrichment overlay ${field}`);
  }
  assertSafeId(item.enrichment_id as string, "enrichment id");
  assertSafeId(item.project_id as string, "project id");
  assertSafeId(item.memory_id as string, "memory id");
  if (!/^[a-f0-9]{64}$/.test(item.source_hash as string)) throw new Error("Invalid enrichment source hash");
  if (!MEMORY_TYPES.has(item.type as ProcessedMemory["type"])) throw new Error("Invalid enrichment memory type");
  if (item.agent !== "codex" && item.agent !== "claude-code") throw new Error("Invalid enrichment agent");
  if (!Number.isFinite(Date.parse(item.created_at as string))) throw new Error("Invalid enrichment timestamp");
  if ((item.title as string).length > 160 || (item.summary as string).length > 2_000) throw new Error("Enrichment text exceeds bounds");
  stringArray(item.source_events, "enrichment source events", 20, 128, true);
  stringArray(item.tags, "enrichment tags", 16, 64);
  stringArray(item.predictive_tags, "enrichment predictive tags", 16, 64);
  stringArray(item.retrieval_phrases, "enrichment retrieval phrases", 12, 240);
  if (item.model !== undefined && (typeof item.model !== "string" || !item.model || item.model.length > 160)) throw new Error("Invalid enrichment model");
}

export function assertEnrichmentOverlayPath(root: string, file: string, overlay: EnrichmentOverlay): void {
  const expected = path.join(vaultPaths(root).enrichments, overlay.project_id, `${overlay.memory_id}.json`);
  if (path.resolve(file) !== path.resolve(expected)) throw new Error("Invalid enrichment overlay path");
}

export function assertEnrichmentBatchRecord(value: unknown): asserts value is EnrichmentBatchRecord {
  const item = object(value, "enrichment batch");
  if (item.schema_version !== 1 || typeof item.batch_id !== "string" || typeof item.project_id !== "string" || typeof item.created_at !== "string" || !Array.isArray(item.targets)) throw new Error("Invalid enrichment batch");
  assertSafeId(item.batch_id, "enrichment batch id");
  assertSafeId(item.project_id, "project id");
  if (!Number.isFinite(Date.parse(item.created_at))) throw new Error("Invalid enrichment batch timestamp");
  if (!item.targets.length || item.targets.length > 20) throw new Error("Invalid enrichment batch targets");
  for (const target of item.targets) {
    const entry = object(target, "enrichment batch target");
    if (typeof entry.memory_id !== "string" || typeof entry.source_hash !== "string") throw new Error("Invalid enrichment batch target");
    assertSafeId(entry.memory_id, "memory id");
    if (!/^[a-f0-9]{64}$/.test(entry.source_hash)) throw new Error("Invalid enrichment batch source hash");
    stringArray(entry.source_events, "enrichment batch source events", 20, 128, true);
  }
}

export function assertEnrichmentBatchPath(root: string, file: string, batch: EnrichmentBatchRecord): void {
  const expected = path.join(vaultPaths(root).registry, "enrichment-batches", batch.project_id, `${batch.batch_id}.json`);
  if (path.resolve(file) !== path.resolve(expected)) throw new Error("Invalid enrichment batch path");
}

export function assertEnrichmentSubmission(value: unknown): asserts value is EnrichmentSubmission {
  const item = object(value, "enrichment submission");
  if (item.schema_version !== 1 || typeof item.batch_id !== "string" || typeof item.project_id !== "string" || !Array.isArray(item.items)) throw new Error("Invalid enrichment submission");
  assertSafeId(item.batch_id, "enrichment batch id");
  assertSafeId(item.project_id, "project id");
  if (item.agent !== "codex" && item.agent !== "claude-code") throw new Error("Invalid enrichment agent");
  if (item.model !== undefined && (typeof item.model !== "string" || !item.model.trim() || item.model.length > 160)) throw new Error("Invalid enrichment model");
  if (!item.items.length || item.items.length > 20) throw new Error("Invalid enrichment submission items");
  const ids = new Set<string>();
  for (const candidate of item.items) {
    const result = object(candidate, "enrichment submission item");
    if (typeof result.memory_id !== "string" || typeof result.title !== "string" || typeof result.summary !== "string") throw new Error("Invalid enrichment submission item");
    assertSafeId(result.memory_id, "memory id");
    if (ids.has(result.memory_id)) throw new Error("Duplicate enrichment memory id");
    ids.add(result.memory_id);
    if (!result.title.trim() || result.title.length > 160 || !result.summary.trim() || result.summary.length > 2_000) throw new Error("Invalid enrichment text");
    if (!MEMORY_TYPES.has(result.type as ProcessedMemory["type"])) throw new Error("Invalid enrichment memory type");
    stringArray(result.evidence_refs, "enrichment evidence refs", 20, 128, true);
    stringArray(result.tags, "enrichment tags", 16, 64);
    stringArray(result.predictive_tags, "enrichment predictive tags", 16, 64);
    stringArray(result.retrieval_phrases, "enrichment retrieval phrases", 12, 240);
    const submittedText = [result.title, result.summary, ...result.tags, ...result.predictive_tags, ...result.retrieval_phrases].join("\n");
    if (classifySensitivity(submittedText).level !== "normal") throw new Error("Enrichment output contains sensitive content");
  }
}

function enrichmentId(input: EnrichmentSubmission, item: EnrichmentSubmissionItem, sourceHash: string): string {
  return `en_${createHash("sha256").update(JSON.stringify({ input: { agent: input.agent, model: input.model }, item, sourceHash })).digest("hex").slice(0, 24)}`;
}

function validOverlayForMemory(overlay: EnrichmentOverlay | undefined, memory: ProcessedMemory): overlay is EnrichmentOverlay {
  return Boolean(overlay && overlay.project_id === memory.project_id && overlay.memory_id === memory.id && overlay.source_hash === memory.source_hash && sameSet(overlay.source_events, memory.source_events));
}

async function rawById(root: string, project: string): Promise<Map<string, RawEvent>> {
  const p = vaultPaths(root);
  const result = new Map<string, RawEvent>();
  for (const file of await listJsonFiles(path.join(p.raw, project), p.root)) {
    try {
      const event = await readJson<unknown>(file);
      assertRawEvent(event);
      assertRawRecordPath(p, file, event);
      result.set(event.event_id, event);
    } catch { /* doctor reports invalid records */ }
  }
  return result;
}

function verifiedSources(memory: ProcessedMemory, raw: Map<string, RawEvent>): boolean {
  if (!memory.source_hash || !memory.source_events.length) return false;
  return memory.source_events.every(eventId => {
    const event = raw.get(eventId);
    return Boolean(event && event.sensitivity === "normal" && createHash("sha256").update(event.content).digest("hex") === event.content_hash && event.content_hash === memory.source_hash);
  });
}

function normalizedStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value)) && new Set(left).size === left.length;
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string, maxItems: number, maxLength: number, requireNonEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || (requireNonEmpty && !value.length) || value.length > maxItems || !value.every(item => typeof item === "string" && item.length > 0 && item.length <= maxLength)) {
    throw new Error(`Invalid ${label}`);
  }
}
