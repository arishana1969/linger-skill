import path from "node:path";
import { atomicJson, readJson } from "./io.js";
import { effectiveMemoryStates } from "./memory-events.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import type { ProcessedMemory } from "./types.js";
import { listJsonFiles } from "./vault.js";

export interface TagRegistryEntry {
  raw_tag: string;
  normalized_tag: string;
  aliases: string[];
  related_terms: string[];
  usage_count: number;
  created_at: string;
  last_used: string;
  examples: string[];
  confidence: number;
}

export interface TagRegistry {
  schema_version: 1;
  project_id: string;
  generated_at: string;
  entries: TagRegistryEntry[];
  skipped_files: string[];
}

export async function rebuildTagRegistry(root: string, projectId: string): Promise<TagRegistry> {
  const project = assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  const states = await effectiveMemoryStates(root, project);
  const entries = new Map<string, TagRegistryEntry>();
  const skipped: string[] = [];
  for (const file of await listJsonFiles(path.join(p.processed, project))) {
    try {
      const memory = await readJson<ProcessedMemory>(file);
      if (memory.status !== "active" || states.has(memory.id)) continue;
      for (const raw of [...new Set([...memory.tags, ...memory.predictive_tags])]) {
        const normalized = normalizeTag(raw);
        if (!normalized) continue;
        const current = entries.get(normalized);
        if (current) {
          current.usage_count += 1;
          current.last_used = later(current.last_used, memory.updated_at);
          current.examples = [...new Set([...current.examples, memory.id])].slice(0, 5);
          if (raw !== normalized) current.aliases = [...new Set([...current.aliases, raw])].sort();
          current.confidence = Math.max(current.confidence, memory.confidence);
        } else {
          entries.set(normalized, { raw_tag: raw, normalized_tag: normalized, aliases: raw === normalized ? [] : [raw], related_terms: [], usage_count: 1, created_at: memory.created_at, last_used: memory.updated_at, examples: [memory.id], confidence: memory.confidence });
        }
      }
    } catch { skipped.push(path.relative(p.root, file)); }
  }
  const registry: TagRegistry = { schema_version: 1, project_id: project, generated_at: new Date().toISOString(), entries: [...entries.values()].sort((a, b) => b.usage_count - a.usage_count || a.normalized_tag.localeCompare(b.normalized_tag)), skipped_files: skipped };
  await atomicJson(path.join(p.registry, "tags", `${project}.json`), registry);
  return registry;
}

export async function readTagRegistry(root: string, projectId: string): Promise<TagRegistry | undefined> {
  try { return await readJson<TagRegistry>(path.join(vaultPaths(root).registry, "tags", `${assertSafeId(projectId, "project id")}.json`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export function normalizeTag(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/^-+|-+$/g, ""); }
function later(a: string, b: string): string { return a.localeCompare(b) >= 0 ? a : b; }
