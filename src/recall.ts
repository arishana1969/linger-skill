import { listDecisionViews } from "./decisions.js";
import { search, type SearchOptions } from "./search.js";
import { readTagRegistry } from "./tag-registry.js";
import type { SearchHit } from "./types.js";

export interface RecallPackage {
  classification: "exact_record_found" | "similar_record_found" | "possible_match" | "no_reliable_memory_found" | "conflicting_memories_found" | "unprocessed_raw_match";
  hits: SearchHit[];
  candidates: { topics: string[]; decisions: string[]; tags: string[] };
  truncated: boolean;
  total_characters: number;
}

export async function recall(root: string, options: SearchOptions & { maxCharacters?: number }): Promise<RecallPackage> {
  const found = await search(root, options);
  const max = options.maxCharacters ?? 12000;
  const hits: SearchHit[] = [];
  let characters = 0;
  let truncated = false;
  for (const hit of found) {
    const remaining = max - characters;
    if (remaining <= 0) { truncated = true; break; }
    const snippet = hit.snippet.slice(0, remaining);
    hits.push({ ...hit, snippet });
    characters += snippet.length;
    if (snippet.length < hit.snippet.length) { truncated = true; break; }
  }
  const decisions = await listDecisionViews(root, options.projectId);
  const registry = await readTagRegistry(root, options.projectId);
  const conflicts = decisions.filter(view => view.conflicts.length);
  const classification = classify(hits, conflicts.length > 0);
  return {
    classification, hits, truncated, total_characters: characters,
    candidates: hits.length ? { topics: [], decisions: [], tags: [] } : {
      topics: decisions.map(view => view.topic).slice(0, 5),
      decisions: decisions.map(view => view.current_state).filter((value): value is string => Boolean(value)).slice(0, 5),
      tags: (registry?.entries ?? []).slice(0, 8).map(entry => entry.normalized_tag)
    }
  };
}

function classify(hits: SearchHit[], conflicting: boolean): RecallPackage["classification"] {
  if (conflicting) return "conflicting_memories_found";
  if (!hits.length) return "no_reliable_memory_found";
  if (hits.some(hit => hit.match_type === "exact_record")) return "exact_record_found";
  if (hits.some(hit => hit.match_type === "similar_record")) return "similar_record_found";
  if (hits.every(hit => hit.match_type === "unprocessed_raw")) return "unprocessed_raw_match";
  return "possible_match";
}
