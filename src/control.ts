import path from "node:path";
import { readJson } from "./io.js";
import { appendMemoryControl, correctMemory, effectiveMemoryStates, type MemoryControlEvent } from "./memory-events.js";
import { vaultPaths, assertSafeId } from "./paths.js";
import { rebuildTagRegistry } from "./tag-registry.js";
import type { ProcessedMemory } from "./types.js";

export async function forget(root: string, projectId: string, memoryId: string, reason?: string): Promise<MemoryControlEvent> {
  const project = assertSafeId(projectId, "project id");
  const memory = assertSafeId(memoryId, "memory id");
  await readJson<ProcessedMemory>(path.join(vaultPaths(root).processed, project, `${memory}.json`));
  const event = await appendMemoryControl(root, { kind: "forget", project_id: project, target_memory_id: memory, reason, evidence_refs: [] });
  await rebuildTagRegistry(root, project);
  return event;
}

export async function correct(root: string, projectId: string, memoryId: string, summary: string, evidenceRefs: string[], reason?: string): Promise<Awaited<ReturnType<typeof correctMemory>>> {
  const result = await correctMemory(root, projectId, memoryId, { summary, evidenceRefs, reason, source: "user_explicit" });
  await rebuildTagRegistry(root, projectId);
  return result;
}

export async function inspect(root: string, projectId: string, memoryId: string): Promise<{ memory: ProcessedMemory; effective_status: string; control_events: string[] }> {
  const project = assertSafeId(projectId, "project id");
  const memory = assertSafeId(memoryId, "memory id");
  const record = await readJson<ProcessedMemory>(path.join(vaultPaths(root).processed, project, `${memory}.json`));
  const state = (await effectiveMemoryStates(root, project)).get(memory);
  return { memory: record, effective_status: state?.status ?? record.status, control_events: state?.event_ids ?? [] };
}
