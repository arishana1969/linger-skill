import path from "node:path";
import type { VaultPaths } from "./paths.js";
import type { DecisionEvent, DecisionView } from "./decisions.js";
import type { MemoryControlEvent } from "./memory-events.js";
import type { PendingCapture } from "./pending.js";
import type { TagRegistry } from "./tag-registry.js";
import type { TermRelation } from "./term-graph.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";
import type { ProjectRecord } from "./vault.js";

export function assertRawRecordPath(paths: VaultPaths, file: string, event: RawEvent): void {
  assertCanonicalPath(file, path.join(paths.raw, event.project_id, event.session_id, `${event.event_id}.json`), "raw record");
  if (event.raw_ref !== path.relative(paths.root, file)) throw new Error("Invalid raw record reference");
}

export function assertQueueRecordPath(paths: VaultPaths, file: string, item: QueueItem): void {
  assertCanonicalPath(file, path.join(paths.queue, item.project_id, `${item.task_id}.json`), "queue record");
}

export function assertProcessedRecordPath(paths: VaultPaths, file: string, memory: ProcessedMemory): void {
  assertCanonicalPath(file, path.join(paths.processed, memory.project_id, `${memory.id}.json`), "processed record");
}

export function assertPendingRecordPath(paths: VaultPaths, file: string, pending: PendingCapture): void {
  assertCanonicalPath(file, path.join(paths.tmp, "pending", pending.event.project_id, `${pending.pending_id}.json`), "pending record");
}

export function assertDecisionEventPath(paths: VaultPaths, file: string, event: DecisionEvent): void {
  assertCanonicalPath(file, path.join(paths.decisions, event.project_id, event.canonical_id, "events", `${event.timestamp.replaceAll(":", "-")}-${event.event_id}.json`), "decision event");
}

export function assertDecisionViewPath(paths: VaultPaths, file: string, view: DecisionView): void {
  assertCanonicalPath(file, path.join(paths.decisions, view.project_id, view.canonical_id, "current.json"), "decision view");
}

export function assertMemoryControlPath(paths: VaultPaths, file: string, event: MemoryControlEvent): void {
  assertCanonicalPath(file, path.join(paths.registry, "memory-events", event.project_id, `${event.timestamp.replaceAll(":", "-")}-${event.event_id}.json`), "memory control record");
}

export function assertTermRelationPath(paths: VaultPaths, file: string, relation: TermRelation): void {
  assertCanonicalPath(file, path.join(paths.registry, "term-graph", relation.project_id, `${relation.relation_id}.json`), "term relation record");
}

export function assertTagRegistryPath(paths: VaultPaths, file: string, registry: TagRegistry): void {
  assertCanonicalPath(file, path.join(paths.registry, "tags", `${registry.project_id}.json`), "tag registry record");
}

export function assertProjectRecordPath(paths: VaultPaths, file: string, project: ProjectRecord): void {
  assertCanonicalPath(file, path.join(paths.projects, `${project.project_id}.json`), "project record");
}

function assertCanonicalPath(actual: string, expected: string, label: string): void {
  if (path.resolve(actual) !== path.resolve(expected)) throw new Error(`Invalid ${label} path`);
}
