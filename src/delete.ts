import { unlink } from "node:fs/promises";
import path from "node:path";
import { appendMemoryControl } from "./memory-events.js";
import { assertWritableInside, readJson } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { listJsonFiles } from "./vault.js";
import type { ProcessedMemory, RawEvent } from "./types.js";
import { rebuildTagRegistry } from "./tag-registry.js";
import { assertProcessedMemory, assertRawEvent } from "./schema-validation.js";
import { assertProcessedRecordPath, assertRawRecordPath } from "./record-paths.js";

export type DeleteTarget = "processed" | "raw";

export interface DeleteResult {
  deleted: boolean;
  target: DeleteTarget;
  id: string;
  project_id: string;
  source_events?: string[];
}

export async function deleteRecord(root: string, input: { projectId: string; target: DeleteTarget; id: string; confirmed: boolean; reason?: string }): Promise<DeleteResult> {
  if (input.target !== "processed" && input.target !== "raw") throw new Error("Delete target must be processed or raw");
  if (!input.confirmed) throw new Error("Delete requires explicit confirmation");
  const project = assertSafeId(input.projectId, "project id");
  const id = assertSafeId(input.id, `${input.target} id`);
  const p = vaultPaths(root);
  if (input.target === "processed") {
    const file = path.join(p.processed, project, `${id}.json`);
    await assertWritableInside(p.root, file);
    const memory = await readJson<unknown>(file);
    assertProcessedMemory(memory);
    assertProcessedRecordPath(p, file, memory);
    await unlink(file);
    await unlink(path.join(p.processed, project, `${id}.md`)).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    await appendMemoryControl(root, { kind: "delete", project_id: project, target_memory_id: id, reason: input.reason, evidence_refs: memory.source_events.length ? memory.source_events : [id] });
    await rebuildTagRegistry(root, project);
    return { deleted: true, target: "processed", id, project_id: project, source_events: memory.source_events };
  }
  const files = await listJsonFiles(path.join(p.raw, project));
  for (const file of files) {
    let event: RawEvent;
    try { const value = await readJson<unknown>(file); assertRawEvent(value); assertRawRecordPath(p, file, value); event = value; }
    catch { continue; }
    if (event.event_id !== id) continue;
    await unlink(file);
    await unlink(path.join(p.processed, project, `${id}.md`)).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    return { deleted: true, target: "raw", id, project_id: project };
  }
  throw new Error(`Raw event not found: ${id}`);
}

export async function deleteLastRecord(root: string, input: { projectId: string; target: DeleteTarget; confirmed: boolean; reason?: string }): Promise<DeleteResult> {
  if (input.target !== "processed" && input.target !== "raw") throw new Error("Delete target must be processed or raw");
  if (!input.confirmed) throw new Error("Delete last requires explicit confirmation");
  const project = assertSafeId(input.projectId, "project id");
  const p = vaultPaths(root);
  if (input.target === "processed") {
    const records = (await Promise.all((await listJsonFiles(path.join(p.processed, project))).map(async file => {
      try { const value = await readJson<unknown>(file); assertProcessedMemory(value); assertProcessedRecordPath(p, file, value); return value; } catch { return undefined; }
    }))).filter((value): value is ProcessedMemory => Boolean(value));
    const latest = records.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
    if (!latest) throw new Error(`No processed records found for project ${project}`);
    return await deleteRecord(root, { projectId: project, target: "processed", id: latest.id, confirmed: true, reason: input.reason });
  }
  const events = (await Promise.all((await listJsonFiles(path.join(p.raw, project))).map(async file => {
    try { const value = await readJson<unknown>(file); assertRawEvent(value); assertRawRecordPath(p, file, value); return value; } catch { return undefined; }
  }))).filter((value): value is RawEvent => Boolean(value));
  const latest = events.sort((a, b) => b.seq_id - a.seq_id || b.timestamp.localeCompare(a.timestamp) || b.event_id.localeCompare(a.event_id))[0];
  if (!latest) throw new Error(`No raw records found for project ${project}`);
  return await deleteRecord(root, { projectId: project, target: "raw", id: latest.event_id, confirmed: true, reason: input.reason });
}
