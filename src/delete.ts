import { unlink } from "node:fs/promises";
import path from "node:path";
import { appendMemoryControl } from "./memory-events.js";
import { readJson } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { listJsonFiles } from "./vault.js";
import type { ProcessedMemory, RawEvent } from "./types.js";
import { rebuildTagRegistry } from "./tag-registry.js";

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
    const memory = await readJson<ProcessedMemory>(file);
    await unlink(file);
    await unlink(path.join(p.processed, project, `${id}.md`)).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    await appendMemoryControl(root, { kind: "delete", project_id: project, target_memory_id: id, reason: input.reason, evidence_refs: memory.source_events.length ? memory.source_events : [id] });
    await rebuildTagRegistry(root, project);
    return { deleted: true, target: "processed", id, project_id: project, source_events: memory.source_events };
  }
  const files = await listJsonFiles(path.join(p.raw, project));
  for (const file of files) {
    const event = await readJson<RawEvent>(file);
    if (event.event_id !== id) continue;
    await unlink(file);
    await unlink(path.join(p.processed, project, `${id}.md`)).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    return { deleted: true, target: "raw", id, project_id: project };
  }
  throw new Error(`Raw event not found: ${id}`);
}
