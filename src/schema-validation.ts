import type { PendingCapture } from "./pending.js";
import type { DecisionEvent, DecisionView } from "./decisions.js";
import type { TagRegistry } from "./tag-registry.js";
import type { MemoryControlEvent } from "./memory-events.js";
import type { TermRelation } from "./term-graph.js";
import type { ProjectRecord } from "./vault.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";
import { assertSafeId } from "./paths.js";

const ROLES = new Set(["user", "assistant", "system"]);
const SAVEPOINTS = new Set(["pending", "complete", "partial"]);
const SENSITIVITIES = new Set(["normal", "sensitive", "secret"]);
const MEMORY_TYPES = new Set(["conversation", "idea", "preference", "proposal", "rationale", "constraint", "rejection", "decision", "current_state", "todo", "correction"]);
const MEMORY_SOURCES = new Set(["user_explicit", "agent_inferred"]);
const MEMORY_STATUSES = new Set(["active", "revoked", "superseded"]);
const QUEUE_PRIORITIES = new Set(["normal", "explicit"]);
const QUEUE_STATUSES = new Set(["pending", "processing", "failed", "done"]);
const DECISION_KINDS = new Set(["idea", "preference", "proposal", "rationale", "constraint", "rejection", "decision", "current_state", "todo", "correction"]);
const DECISION_STATUSES = new Set(["proposed", "accepted", "rejected", "superseded", "reopened", "current", "unknown"]);
const DECISION_SOURCES = new Set(["user_explicit", "agent_inferred"]);
const MEMORY_CONTROL_KINDS = new Set(["forget", "correct", "delete"]);
const TERM_RELATION_TYPES = new Set(["synonym", "alias", "abbreviation", "related", "contextual_equivalent", "location_mapping", "product_name", "ambiguous"]);

export function assertRawEvent(value: unknown): asserts value is RawEvent {
  const item = record(value, "raw event");
  schemaOne(item, "raw event");
  strings(item, ["event_id", "session_id", "project_id", "turn_id", "timestamp", "source_agent", "content", "content_hash", "raw_ref"], "raw event");
  safeIds(item, ["event_id", "session_id", "project_id", "turn_id"], "raw event");
  isoTimestamp(item.timestamp, "raw event timestamp");
  if (!Number.isInteger(item.seq_id) || Number(item.seq_id) < 1) invalid("raw event seq_id");
  enumeration(item.role, ROLES, "raw event role");
  enumeration(item.savepoint_status, SAVEPOINTS, "raw event savepoint_status");
  enumeration(item.sensitivity, SENSITIVITIES, "raw event sensitivity");
  if (item.capture_status !== "captured") invalid("raw event capture_status");
}

export function assertProcessedMemory(value: unknown): asserts value is ProcessedMemory {
  const item = record(value, "processed memory");
  schemaOne(item, "processed memory");
  strings(item, ["id", "project_id", "title", "summary", "created_at", "updated_at", "agent"], "processed memory");
  safeIds(item, ["id", "project_id"], "processed memory");
  isoTimestamp(item.created_at, "processed memory created_at");
  isoTimestamp(item.updated_at, "processed memory updated_at");
  stringArrays(item, ["tags", "predictive_tags", "retrieval_phrases", "source_events", "supersedes", "superseded_by"], "processed memory");
  enumeration(item.type, MEMORY_TYPES, "processed memory type");
  enumeration(item.scope, new Set(["project", "global"]), "processed memory scope");
  enumeration(item.source_savepoint_status, SAVEPOINTS, "processed memory source_savepoint_status");
  enumeration(item.source, MEMORY_SOURCES, "processed memory source");
  enumeration(item.status, MEMORY_STATUSES, "processed memory status");
  enumeration(item.sensitivity, new Set(["normal", "sensitive"]), "processed memory sensitivity");
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) invalid("processed memory confidence");
  if (item.source_hash !== undefined && typeof item.source_hash !== "string") invalid("processed memory source_hash");
}

export function assertQueueItem(value: unknown): asserts value is QueueItem {
  const item = record(value, "queue item");
  schemaOne(item, "queue item");
  strings(item, ["task_id", "event_id", "project_id", "created_at", "updated_at"], "queue item");
  safeIds(item, ["task_id", "event_id", "project_id"], "queue item");
  isoTimestamp(item.created_at, "queue item created_at");
  isoTimestamp(item.updated_at, "queue item updated_at");
  enumeration(item.priority, QUEUE_PRIORITIES, "queue item priority");
  enumeration(item.status, QUEUE_STATUSES, "queue item status");
  if (!Number.isInteger(item.attempts) || Number(item.attempts) < 0) invalid("queue item attempts");
  if (item.error !== undefined && typeof item.error !== "string") invalid("queue item error");
}

export function assertPendingCapture(value: unknown): asserts value is PendingCapture {
  const item = record(value, "pending capture");
  schemaOne(item, "pending capture");
  strings(item, ["pending_id", "raw_file", "queue_file", "created_at"], "pending capture");
  safeIds(item, ["pending_id"], "pending capture");
  isoTimestamp(item.created_at, "pending capture created_at");
  if (item.sequence_file !== undefined && typeof item.sequence_file !== "string") invalid("pending capture sequence_file");
  if (item.sequence_value !== undefined && (!Number.isInteger(item.sequence_value) || Number(item.sequence_value) < 0)) invalid("pending capture sequence_value");
  assertRawEvent(item.event);
  assertQueueItem(item.queue_item);
  if (item.event.event_id !== item.queue_item.event_id || item.event.project_id !== item.queue_item.project_id) invalid("pending capture event/queue identity");
}

export function assertDecisionEvent(value: unknown): asserts value is DecisionEvent {
  const item = record(value, "decision event");
  schemaOne(item, "decision event");
  strings(item, ["event_id", "canonical_id", "project_id", "topic", "statement", "timestamp"], "decision event");
  safeIds(item, ["event_id", "canonical_id", "project_id"], "decision event");
  isoTimestamp(item.timestamp, "decision event timestamp");
  stringArrays(item, ["aliases", "evidence_refs", "supersedes"], "decision event");
  enumeration(item.kind, DECISION_KINDS, "decision event kind");
  enumeration(item.status, DECISION_STATUSES, "decision event status");
  enumeration(item.source, DECISION_SOURCES, "decision event source");
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) invalid("decision event confidence");
  if (item.rationale !== undefined && typeof item.rationale !== "string") invalid("decision event rationale");
}

export function assertDecisionView(value: unknown): asserts value is DecisionView {
  const item = record(value, "decision view");
  schemaOne(item, "decision view");
  strings(item, ["canonical_id", "project_id", "topic", "updated_at"], "decision view");
  safeIds(item, ["canonical_id", "project_id"], "decision view");
  isoTimestamp(item.updated_at, "decision view updated_at");
  stringArrays(item, ["aliases", "event_ids", "source_events", "conflicts"], "decision view");
  enumeration(item.current_status, DECISION_STATUSES, "decision view current_status");
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) invalid("decision view confidence");
  for (const field of ["current_event_id", "current_state"] as const) if (item[field] !== undefined && typeof item[field] !== "string") invalid(`decision view ${field}`);
  if (item.current_evidence_refs !== undefined && (!Array.isArray(item.current_evidence_refs) || !item.current_evidence_refs.every(value => typeof value === "string"))) invalid("decision view current_evidence_refs");
}

export function assertTagRegistry(value: unknown): asserts value is TagRegistry {
  const item = record(value, "tag registry");
  schemaOne(item, "tag registry");
  strings(item, ["project_id", "generated_at"], "tag registry");
  safeIds(item, ["project_id"], "tag registry");
  isoTimestamp(item.generated_at, "tag registry generated_at");
  stringArrays(item, ["skipped_files"], "tag registry");
  if (!Array.isArray(item.entries)) invalid("tag registry entries");
  for (const value of item.entries) {
    const entry = record(value, "tag registry entry");
    strings(entry, ["raw_tag", "normalized_tag", "created_at", "last_used"], "tag registry entry");
    isoTimestamp(entry.created_at, "tag registry entry created_at");
    isoTimestamp(entry.last_used, "tag registry entry last_used");
    stringArrays(entry, ["aliases", "related_terms", "examples"], "tag registry entry");
    if (!Number.isInteger(entry.usage_count) || Number(entry.usage_count) < 0) invalid("tag registry entry usage_count");
    if (typeof entry.confidence !== "number" || entry.confidence < 0 || entry.confidence > 1) invalid("tag registry entry confidence");
  }
}

export function assertMemoryControlEvent(value: unknown): asserts value is MemoryControlEvent {
  const item = record(value, "memory control event");
  schemaOne(item, "memory control event");
  strings(item, ["event_id", "project_id", "target_memory_id", "timestamp"], "memory control event");
  safeIds(item, ["event_id", "project_id", "target_memory_id"], "memory control event");
  isoTimestamp(item.timestamp, "memory control event timestamp");
  stringArrays(item, ["evidence_refs"], "memory control event");
  enumeration(item.kind, MEMORY_CONTROL_KINDS, "memory control event kind");
  for (const field of ["replacement_memory_id", "reason"] as const) if (item[field] !== undefined && typeof item[field] !== "string") invalid(`memory control event ${field}`);
  if (item.kind === "correct" && typeof item.replacement_memory_id !== "string") invalid("memory control event replacement_memory_id");
}

export function assertTermRelation(value: unknown): asserts value is TermRelation {
  const item = record(value, "term relation");
  schemaOne(item, "term relation");
  strings(item, ["relation_id", "project_id", "term_a", "term_b", "created_at", "last_verified"], "term relation");
  safeIds(item, ["relation_id", "project_id"], "term relation");
  isoTimestamp(item.created_at, "term relation created_at");
  isoTimestamp(item.last_verified, "term relation last_verified");
  stringArrays(item, ["context_tags", "evidence_refs"], "term relation");
  enumeration(item.relation_type, TERM_RELATION_TYPES, "term relation type");
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) invalid("term relation confidence");
}

export function assertProjectRecord(value: unknown): asserts value is ProjectRecord {
  const item = record(value, "project record");
  schemaOne(item, "project record");
  strings(item, ["project_id", "display_name", "root_path", "created_at", "last_seen"], "project record");
  safeIds(item, ["project_id"], "project record");
  isoTimestamp(item.created_at, "project record created_at");
  isoTimestamp(item.last_seen, "project record last_seen");
  enumeration(item.identity_source, new Set(["git_remote_root", "git_root", "absolute_path"]), "project record identity_source");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}
function schemaOne(item: Record<string, unknown>, label: string): void { if (item.schema_version !== 1) invalid(`${label} schema_version`); }
function strings(item: Record<string, unknown>, fields: string[], label: string): void { for (const field of fields) if (typeof item[field] !== "string" || !(item[field] as string).length) invalid(`${label} ${field}`); }
function stringArrays(item: Record<string, unknown>, fields: string[], label: string): void { for (const field of fields) if (!Array.isArray(item[field]) || !(item[field] as unknown[]).every(value => typeof value === "string")) invalid(`${label} ${field}`); }
function safeIds(item: Record<string, unknown>, fields: string[], label: string): void { for (const field of fields) { try { assertSafeId(item[field] as string, `${label} ${field}`); } catch { invalid(`${label} ${field}`); } } }
function isoTimestamp(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(label);
}
function enumeration(value: unknown, allowed: Set<string>, label: string): void { if (typeof value !== "string" || !allowed.has(value)) invalid(label); }
function invalid(label: string): never { throw new Error(`Invalid ${label}`); }
