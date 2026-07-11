import { unlink } from "node:fs/promises";
import path from "node:path";
import { atomicJson, readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
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
  const file = path.join(p.tmp, "pending", pending.event.project_id, `${pending.pending_id}.json`);
  await atomicJson(file, pending);
  return file;
}

export async function completePending(file: string): Promise<void> {
  await unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
}

export async function recoverPending(root: string): Promise<{ recovered: number; failed: Array<{ file: string; error: string }> }> {
  const p = vaultPaths(root);
  const files = await listJsonFiles(path.join(p.tmp, "pending"));
  let recovered = 0;
  const failed: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    try {
      const pending = await readJson<PendingCapture>(file);
      assertInside(p.root, pending.raw_file);
      assertInside(p.root, pending.queue_file);
      if (pending.sequence_file) {
        assertInside(p.root, pending.sequence_file);
        let current = 0;
        try { current = (await readJson<{ value: number }>(pending.sequence_file)).value; } catch { }
        if ((pending.sequence_value ?? 0) > current) await atomicJson(pending.sequence_file, { value: pending.sequence_value });
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

function assertInside(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Pending path escapes vault");
}
