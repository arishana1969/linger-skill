import path from "node:path";
import { atomicJson, readJson } from "./io.js";
import { vaultPaths, assertSafeId } from "./paths.js";
import type { ProcessedMemory } from "./types.js";

export async function forget(root: string, projectId: string, memoryId: string): Promise<ProcessedMemory> {
  const project = assertSafeId(projectId, "project id");
  const memory = assertSafeId(memoryId, "memory id");
  const file = path.join(vaultPaths(root).processed, project, `${memory}.json`);
  const current = await readJson<ProcessedMemory>(file);
  const next = { ...current, status: "revoked" as const, updated_at: new Date().toISOString() };
  await atomicJson(file, next);
  return next;
}

export async function inspect(root: string, projectId: string, memoryId: string): Promise<ProcessedMemory> {
  const file = path.join(vaultPaths(root).processed, assertSafeId(projectId, "project id"), `${assertSafeId(memoryId, "memory id")}.json`);
  return await readJson<ProcessedMemory>(file);
}
