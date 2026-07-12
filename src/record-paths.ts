import path from "node:path";
import type { VaultPaths } from "./paths.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";

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

function assertCanonicalPath(actual: string, expected: string, label: string): void {
  if (path.resolve(actual) !== path.resolve(expected)) throw new Error(`Invalid ${label} path`);
}
