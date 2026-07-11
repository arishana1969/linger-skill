import { createHash } from "node:crypto";
import path from "node:path";
import { readJson } from "./io.js";
import type { PendingCapture } from "./pending.js";
import { vaultPaths } from "./paths.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";
import { initVault, listJsonFiles } from "./vault.js";

export interface DoctorReport { ok: boolean; errors: string[]; warnings: string[]; }

export async function doctor(root: string): Promise<DoctorReport> {
  await initVault(root);
  const p = vaultPaths(root);
  const report: DoctorReport = { ok: true, errors: [], warnings: [] };
  for (const file of await listJsonFiles(p.raw)) {
    try {
      const event = await readJson<RawEvent>(file);
      const hash = createHash("sha256").update(event.content).digest("hex");
      if (hash !== event.content_hash) report.warnings.push(`tampered:${path.relative(p.root, file)}`);
    } catch { report.errors.push(`invalid_raw:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(p.processed)) {
    try {
      const memory = await readJson<ProcessedMemory>(file);
      if (!memory.source_events.length) report.warnings.push(`missing_evidence:${memory.id}`);
    } catch { report.errors.push(`invalid_processed:${path.relative(p.root, file)}`); }
  }
  for (const file of await listJsonFiles(path.join(p.tmp, "pending"))) {
    try { report.warnings.push(`pending_capture:${(await readJson<PendingCapture>(file)).pending_id}`); }
    catch { report.errors.push(`invalid_pending:${path.relative(p.root, file)}`); }
  }
  let backlog = 0;
  for (const file of await listJsonFiles(p.queue)) {
    try {
      const item = await readJson<QueueItem>(file);
      if (item.status === "pending" || item.status === "failed") backlog += 1;
      if (item.status === "failed") report.warnings.push(`failed_task:${item.task_id}`);
    } catch { report.errors.push(`invalid_queue:${path.relative(p.root, file)}`); }
  }
  if (backlog > 100) report.warnings.push(`severe_backlog:${backlog}`);
  report.ok = report.errors.length === 0;
  return report;
}
