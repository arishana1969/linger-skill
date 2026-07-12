import { randomUUID } from "node:crypto";
import path from "node:path";
import { atomicJson, readJson, withFileLock } from "./io.js";
import { writeProcessedMarkdown } from "./processed-markdown.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertMemoryControlEvent } from "./schema-validation.js";
import { listJsonFiles } from "./vault.js";
import type { ProcessedMemory } from "./types.js";

export type MemoryControlKind = "forget" | "correct" | "delete";

export interface MemoryControlEvent {
  schema_version: 1;
  event_id: string;
  kind: MemoryControlKind;
  project_id: string;
  target_memory_id: string;
  replacement_memory_id?: string;
  reason?: string;
  evidence_refs: string[];
  timestamp: string;
}

export interface EffectiveMemoryState {
  status: "active" | "revoked" | "superseded" | "deleted";
  replacement_memory_id?: string;
  event_ids: string[];
}

export async function appendMemoryControl(root: string, input: Omit<MemoryControlEvent, "schema_version" | "event_id" | "timestamp"> & { timestamp?: string }): Promise<MemoryControlEvent> {
  const project = assertSafeId(input.project_id, "project id");
  const target = assertSafeId(input.target_memory_id, "memory id");
  if (input.kind === "correct" && !input.replacement_memory_id) throw new Error("Correction requires a replacement memory");
  if (input.kind !== "forget" && !input.evidence_refs.length) throw new Error(`${input.kind} requires evidence`);
  const p = vaultPaths(root);
  return await withFileLock(path.join(p.tmp, `${project}.memory-control.lock`), async () => {
    const event: MemoryControlEvent = {
      schema_version: 1,
      event_id: `mce_${randomUUID()}`,
      kind: input.kind,
      project_id: project,
      target_memory_id: target,
      replacement_memory_id: input.replacement_memory_id ? assertSafeId(input.replacement_memory_id, "replacement memory id") : undefined,
      reason: input.reason?.trim() || undefined,
      evidence_refs: [...new Set(input.evidence_refs)],
      timestamp: input.timestamp ?? new Date().toISOString()
    };
    await atomicJson(path.join(p.registry, "memory-events", project, `${event.timestamp.replaceAll(":", "-")}-${event.event_id}.json`), event);
    return event;
  });
}

export async function effectiveMemoryStates(root: string, projectId: string): Promise<Map<string, EffectiveMemoryState>> {
  const project = assertSafeId(projectId, "project id");
  const files = await listJsonFiles(path.join(vaultPaths(root).registry, "memory-events", project));
  const events = (await Promise.all(files.map(async file => {
    try { const value = await readJson<unknown>(file); assertMemoryControlEvent(value); return value; } catch { return undefined; }
  }))).filter((event): event is MemoryControlEvent => Boolean(event)).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.event_id.localeCompare(b.event_id));
  const states = new Map<string, EffectiveMemoryState>();
  for (const event of events) {
    const previous = states.get(event.target_memory_id);
    states.set(event.target_memory_id, {
      status: event.kind === "forget" ? "revoked" : event.kind === "correct" ? "superseded" : "deleted",
      replacement_memory_id: event.replacement_memory_id,
      event_ids: [...(previous?.event_ids ?? []), event.event_id]
    });
  }
  return states;
}

export async function correctMemory(root: string, projectId: string, targetMemoryId: string, correction: { summary: string; evidenceRefs: string[]; reason?: string; source?: "user_explicit" | "agent_inferred" }): Promise<{ memory: ProcessedMemory; event: MemoryControlEvent }> {
  if (!correction.summary.trim()) throw new Error("Correction summary is required");
  if (!correction.evidenceRefs.length) throw new Error("Correction requires evidence");
  const project = assertSafeId(projectId, "project id");
  const target = assertSafeId(targetMemoryId, "memory id");
  const p = vaultPaths(root);
  const old = await readJson<ProcessedMemory>(path.join(p.processed, project, `${target}.json`));
  const timestamp = new Date().toISOString();
  const id = `mem_${randomUUID().replaceAll("-", "")}`;
  const text = correction.summary.trim();
  const tags = [...new Set([...(text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []), ...(text.match(/[\p{Script=Han}]{2,8}/gu) ?? [])])].slice(0, 12);
  const memory: ProcessedMemory = {
    ...old,
    id,
    type: "correction",
    title: correction.summary.trim().slice(0, 80),
    summary: correction.summary.trim(),
    tags,
    predictive_tags: tags,
    retrieval_phrases: tags.map(tag => `关于 ${tag} 的纠正`),
    source_events: [...new Set(correction.evidenceRefs)],
    source_hash: undefined,
    source_savepoint_status: "complete",
    confidence: correction.source === "agent_inferred" ? 0.8 : 1,
    source: correction.source ?? "user_explicit",
    status: "active",
    supersedes: [target],
    superseded_by: [],
    created_at: timestamp,
    updated_at: timestamp,
    agent: "continuity-correction"
  };
  await atomicJson(path.join(p.processed, project, `${id}.json`), memory);
  await writeProcessedMarkdown(root, memory);
  const event = await appendMemoryControl(root, { kind: "correct", project_id: project, target_memory_id: target, replacement_memory_id: id, reason: correction.reason, evidence_refs: correction.evidenceRefs });
  return { memory, event };
}
