import path from "node:path";
import { assertWritableInside, atomicWrite } from "./io.js";
import { vaultPaths } from "./paths.js";
import { assertProcessedMemory } from "./schema-validation.js";
import type { ProcessedMemory } from "./types.js";

export function serializeProcessedMarkdown(memory: ProcessedMemory): string {
  const frontmatter: Record<string, unknown> = {
    schema_version: memory.schema_version,
    id: memory.id,
    type: memory.type,
    scope: memory.scope,
    project_id: memory.project_id,
    tags: memory.tags,
    predictive_tags: memory.predictive_tags,
    retrieval_phrases: memory.retrieval_phrases,
    source_events: memory.source_events,
    source_hash: memory.source_hash,
    source_savepoint_status: memory.source_savepoint_status,
    confidence: memory.confidence,
    source: memory.source,
    status: memory.status,
    sensitivity: memory.sensitivity,
    supersedes: memory.supersedes,
    superseded_by: memory.superseded_by,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    agent: memory.agent,
    model: memory.model
  };
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value !== undefined) lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---", "", `# ${memory.title.replaceAll("\n", " ")}`, "", memory.summary, "");
  return lines.join("\n");
}

export async function writeProcessedMarkdown(root: string, memory: ProcessedMemory): Promise<string> {
  assertProcessedMemory(memory);
  const file = path.join(vaultPaths(root).processed, memory.project_id, `${memory.id}.md`);
  await assertWritableInside(vaultPaths(root).root, file);
  await atomicWrite(file, serializeProcessedMarkdown(memory));
  return file;
}
