import path from "node:path";
import { assertWritableInside, atomicJson, readJson } from "./io.js";
import { effectiveMemoryStates } from "./memory-events.js";
import { applyEnrichment, readEnrichmentOverlays } from "./enrichment.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertProcessedMemory, assertTagRegistry } from "./schema-validation.js";
import { assertProcessedRecordPath, assertTagRegistryPath } from "./record-paths.js";
import { listJsonFiles } from "./vault.js";
import { resolveEffectiveSearchDocuments } from "./effective-search-document.js";
import { dot, normalize as normalizeVector } from "./local/embedding-index.js";
import { resolveSettings } from "./settings.js";
import { classifySensitivity } from "./sensitivity.js";

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
  const overlays = await readEnrichmentOverlays(root, project);
  const entries = new Map<string, TagRegistryEntry>();
  const skipped: string[] = [];
  for (const file of await listJsonFiles(path.join(p.processed, project), p.root)) {
    try {
      const baseline = await readJson<unknown>(file);
      assertProcessedMemory(baseline);
      assertProcessedRecordPath(p, file, baseline);
      const memory = applyEnrichment(baseline, overlays.get(baseline.id));
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
  const file = path.join(p.registry, "tags", `${project}.json`);
  await assertWritableInside(p.root, file);
  await atomicJson(file, registry);
  return registry;
}

export async function readTagRegistry(root: string, projectId: string): Promise<TagRegistry | undefined> {
  const p = vaultPaths(root);
  const file = path.join(p.registry, "tags", `${assertSafeId(projectId, "project id")}.json`);
  await assertWritableInside(p.root, file);
  try { const value = await readJson<unknown>(file); assertTagRegistry(value); assertTagRegistryPath(p, file, value); return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export interface TagCandidate {
  tag: string;
  lexical_match: boolean;
  semantic_similarity?: number;
  evidence_refs: string[];
}

export interface TagSuggestions {
  project_id: string;
  term: string;
  semantic_status: "off" | "active" | "privacy_blocked" | "unavailable";
  degraded_reason?: string;
  considered_tags: number;
  total_tags: number;
  candidates: TagCandidate[];
}

/** Read-only discovery. Similarity is a ranking signal, never a relation or its confidence. */
export async function suggestTags(root: string, projectId: string, term: string, options: {
  limit?: number;
  embed?: (query: string, tags: string[]) => Promise<{ dimension: number; vectors: number[][] }>;
} = {}): Promise<TagSuggestions> {
  const project = assertSafeId(projectId, "project id");
  if (!term.trim() || [...term].length > 128) throw new Error("Tag query must contain 1 to 128 characters");
  const limit = options.limit ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Tag limit must be from 1 to 20");
  const result: TagSuggestions = { project_id: project, term, semantic_status: "off", considered_tags: 0, total_tags: 0, candidates: [] };
  if (classifySensitivity(term).level !== "normal") return { ...result, semantic_status: "privacy_blocked" };
  const registry = await readTagRegistry(root, project);
  // A stale registry cannot authorize embedding revoked, sensitive, or invalid evidence.
  const evidenceByTag = new Map<string, Set<string>>();
  for (const document of await resolveEffectiveSearchDocuments(root, project)) {
    if (!document.eligibility.index) continue;
    for (const tag of document.tag_terms) {
      const key = normalizeTag(tag);
      const evidence = evidenceByTag.get(key) ?? new Set<string>();
      for (const source of document.evidence_descriptors) evidence.add(source.event_id);
      evidenceByTag.set(key, evidence);
    }
  }
  const entries = (registry?.entries ?? []).filter(entry => evidenceByTag.has(entry.normalized_tag))
    .sort((a, b) => Number(b.normalized_tag === normalizeTag(term)) - Number(a.normalized_tag === normalizeTag(term))
      || b.usage_count - a.usage_count || a.normalized_tag.localeCompare(b.normalized_tag));
  result.total_tags = entries.length;
  const candidates: TagCandidate[] = entries.slice(0, 128).map(entry => ({
    tag: entry.normalized_tag,
    lexical_match: normalizeTag(term) === entry.normalized_tag,
    evidence_refs: [...evidenceByTag.get(entry.normalized_tag)!].sort().slice(0, 5)
  }));
  result.considered_tags = candidates.length;
  result.candidates = candidates.filter(candidate => candidate.lexical_match).slice(0, limit);
  const settings = await resolveSettings(root, { projectId: project });
  if (settings.values["embedding.desired_enabled"].value !== true || !candidates.length) return result;
  if (!options.embed) return { ...result, semantic_status: "unavailable", degraded_reason: "embedding.tag_candidates_unavailable" };
  try {
    const embedded = await options.embed(term, candidates.map(candidate => candidate.tag));
    if (embedded.vectors.length !== candidates.length + 1) throw new Error("embedding.response_dimension_mismatch");
    const vectors = embedded.vectors.map(vector => normalizeVector(vector, embedded.dimension));
    candidates.forEach((candidate, index) => { candidate.semantic_similarity = dot(vectors[0]!, vectors[index + 1]!); });
    candidates.sort((a, b) => Number(b.lexical_match) - Number(a.lexical_match)
      || b.semantic_similarity! - a.semantic_similarity! || a.tag.localeCompare(b.tag));
    return { ...result, semantic_status: "active", candidates: candidates.slice(0, limit) };
  } catch {
    return { ...result, semantic_status: "unavailable", degraded_reason: "embedding.tag_candidates_unavailable" };
  }
}

function normalizeTag(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/^-+|-+$/g, ""); }
function later(a: string, b: string): string { return a.localeCompare(b) >= 0 ? a : b; }
