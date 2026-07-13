import { unlink } from "node:fs/promises";
import path from "node:path";
import { assertWritableInside, atomicJson, readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import { assertPendingCapture, assertSequenceState } from "./schema-validation.js";
import { assertPendingRecordPath } from "./record-paths.js";
import { listJsonFiles } from "./vault.js";
import type { QueueItem, RawEvent } from "./types.js";

export interface PendingCapture {
  schema_version: 1;
  pending_id: string;
  event: RawEvent;
  queue_item: QueueItem;
  raw_file: string;
  queue_file: string;
  sequence_file?: string;
  sequence_value?: number;
  created_at: string;
}

export async function stagePending(root: string, pending: PendingCapture): Promise<string> {
  const p = vaultPaths(root);
  assertPendingCapture(pending);
  await assertPendingDestinations(p, pending);
  const file = path.join(p.tmp, "pending", pending.event.project_id, `${pending.pending_id}.json`);
  await assertWritableInside(p.root, file);
  await atomicJson(file, pending);
  return file;
}

export async function completePending(file: string): Promise<void> {
  await unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
}

export async function recoverPending(root: string): Promise<{ recovered: number; failed: Array<{ file: string; error: string }> }> {
  const p = vaultPaths(root);
  const files = await listJsonFiles(path.join(p.tmp, "pending"), p.root);
  let recovered = 0;
  const failed: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    try {
      const pending = await readJson<unknown>(file);
      assertPendingCapture(pending);
      assertPendingRecordPath(p, file, pending);
      await assertPendingDestinations(p, pending);
      if (pending.sequence_file) {
        let current = 0;
        try { const state = await readJson<unknown>(pending.sequence_file); assertSequenceState(state); current = state.value; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if ((pending.sequence_value ?? 0) > current) await atomicJson(pending.sequence_file, { schema_version: 1, value: pending.sequence_value });
      }
      await atomicJson(pending.raw_file, pending.event);
      await atomicJson(pending.queue_file, pending.queue_item);
      await completePending(file);
      recovered += 1;
    } catch (error) {
      failed.push({ file: path.relative(p.root, file), error: (error as Error).message });
    }
  }
  return { recovered, failed };
}

async function assertPendingDestinations(p: ReturnType<typeof vaultPaths>, pending: PendingCapture): Promise<void> {
  const expectedRaw = path.join(p.raw, pending.event.project_id, pending.event.session_id, `${pending.event.event_id}.json`);
  const expectedQueue = path.join(p.queue, pending.queue_item.project_id, `${pending.queue_item.task_id}.json`);
  const expectedSequence = path.join(p.registry, `${pending.event.project_id}.sequence.json`);
  assertSamePath(pending.raw_file, expectedRaw, "raw");
  assertSamePath(pending.queue_file, expectedQueue, "queue");
  if (pending.sequence_file) assertSamePath(pending.sequence_file, expectedSequence, "sequence");
  if (pending.event.raw_ref !== path.relative(p.root, expectedRaw)) throw new Error("Pending raw reference mismatch");
  await assertWritableInside(p.root, expectedRaw);
  await assertWritableInside(p.root, expectedQueue);
  if (pending.sequence_file) await assertWritableInside(p.root, expectedSequence);
}

function assertSamePath(actual: string, expected: string, label: string): void {
  if (path.resolve(actual) !== path.resolve(expected)) throw new Error(`Pending ${label} path mismatch`);
}
