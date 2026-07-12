import type { PendingCapture } from "./pending.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";

const ROLES = new Set(["user", "assistant", "system"]);
const SAVEPOINTS = new Set(["pending", "complete", "partial"]);
const SENSITIVITIES = new Set(["normal", "sensitive", "secret"]);
const MEMORY_TYPES = new Set(["conversation", "idea", "preference", "proposal", "rationale", "constraint", "rejection", "decision", "current_state", "todo", "correction"]);
const MEMORY_SOURCES = new Set(["user_explicit", "agent_inferred"]);
const MEMORY_STATUSES = new Set(["active", "revoked", "superseded"]);
const QUEUE_PRIORITIES = new Set(["normal", "explicit"]);
const QUEUE_STATUSES = new Set(["pending", "processing", "failed", "done"]);

export function assertRawEvent(value: unknown): asserts value is RawEvent {
  const item = record(value, "raw event");
  schemaOne(item, "raw event");
  strings(item, ["event_id", "session_id", "project_id", "turn_id", "timestamp", "source_agent", "content", "content_hash", "raw_ref"], "raw event");
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
  enumeration(item.priority, QUEUE_PRIORITIES, "queue item priority");
  enumeration(item.status, QUEUE_STATUSES, "queue item status");
  if (!Number.isInteger(item.attempts) || Number(item.attempts) < 0) invalid("queue item attempts");
  if (item.error !== undefined && typeof item.error !== "string") invalid("queue item error");
}

export function assertPendingCapture(value: unknown): asserts value is PendingCapture {
  const item = record(value, "pending capture");
  schemaOne(item, "pending capture");
  strings(item, ["pending_id", "raw_file", "queue_file", "created_at"], "pending capture");
  if (item.sequence_file !== undefined && typeof item.sequence_file !== "string") invalid("pending capture sequence_file");
  if (item.sequence_value !== undefined && (!Number.isInteger(item.sequence_value) || Number(item.sequence_value) < 0)) invalid("pending capture sequence_value");
  assertRawEvent(item.event);
  assertQueueItem(item.queue_item);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}
function schemaOne(item: Record<string, unknown>, label: string): void { if (item.schema_version !== 1) invalid(`${label} schema_version`); }
function strings(item: Record<string, unknown>, fields: string[], label: string): void { for (const field of fields) if (typeof item[field] !== "string" || !(item[field] as string).length) invalid(`${label} ${field}`); }
function stringArrays(item: Record<string, unknown>, fields: string[], label: string): void { for (const field of fields) if (!Array.isArray(item[field]) || !(item[field] as unknown[]).every(value => typeof value === "string")) invalid(`${label} ${field}`); }
function enumeration(value: unknown, allowed: Set<string>, label: string): void { if (typeof value !== "string" || !allowed.has(value)) invalid(label); }
function invalid(label: string): never { throw new Error(`Invalid ${label}`); }
