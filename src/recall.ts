import { listDecisionViews } from "./decisions.js";
import { search, type SearchOptions } from "./search.js";
import { readTagRegistry } from "./tag-registry.js";
import type { SearchHit } from "./types.js";

export interface RecallPackage {
  classification: "exact_record_found" | "similar_record_found" | "possible_match" | "no_reliable_memory_found" | "conflicting_memories_found" | "unprocessed_raw_match";
  hits: SearchHit[];
  candidates: { topics: string[]; decisions: string[]; tags: string[]; time_ranges: string[] };
  truncated: boolean;
  total_characters: number;
  current_state?: string;
  decision_topic?: string;
}

export async function recall(root: string, options: SearchOptions & { maxCharacters?: number }): Promise<RecallPackage> {
  let found = await search(root, options);
  if (/(?:为什么|原因|理由|why|reason)/i.test(options.query)) {
    const rationale = found.filter(hit => /(?:因为|由于|\b因|because|reason|cost|complexity|constraint)/i.test(hit.snippet));
    if (rationale.length) found = rationale;
  }
  const decisions = await listDecisionViews(root, options.projectId);
  const initialEvidence = new Set(found.flatMap(hit => hit.raw_ref));
  const evidenceRank = new Map<string, number>();
  found.forEach((hit, index) => hit.raw_ref.forEach(event => evidenceRank.set(event, Math.min(evidenceRank.get(event) ?? Number.POSITIVE_INFINITY, index))));
  const decisionRank = (sourceEvents: string[]) => Math.min(...sourceEvents.map(event => evidenceRank.get(event) ?? Number.POSITIVE_INFINITY));
  const matchedDecision = decisions
    .filter(view => view.source_events.some(event => initialEvidence.has(event)))
    .sort((a, b) => decisionRank(a.source_events) - decisionRank(b.source_events) || b.updated_at.localeCompare(a.updated_at))[0];
  const asksForCurrent = /(?:当前|现在|目前|current|currently|now)/i.test(options.query);
  const asksForRationale = /(?:为什么|原因|理由|why|reason)/i.test(options.query);
  if (matchedDecision?.current_evidence_refs?.length && (asksForCurrent || asksForRationale)) {
    const currentEvidence = new Set(matchedDecision.current_evidence_refs);
    const currentHits = found.filter(hit => hit.raw_ref.some(event => currentEvidence.has(event)));
    if (currentHits.length) found = currentHits;
  }
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
  const registry = await readTagRegistry(root, options.projectId).catch(() => undefined);
  const classification = classify(hits, Boolean(matchedDecision?.conflicts.length));
  return {
    classification, hits, truncated, total_characters: characters, current_state: matchedDecision?.current_state, decision_topic: matchedDecision?.topic,
    candidates: hits.length ? { topics: [], decisions: [], tags: [], time_ranges: [] } : {
      topics: decisions.map(view => view.topic).slice(0, 5),
      decisions: decisions.map(view => view.current_state).filter((value): value is string => Boolean(value)).slice(0, 5),
      tags: (registry?.entries ?? []).slice(0, 8).map(entry => entry.normalized_tag),
      time_ranges: [...new Set((registry?.entries ?? []).map(entry => entry.last_used.slice(0, 7)).filter(value => /^\d{4}-\d{2}$/.test(value)))].sort().reverse().slice(0, 5)
    }
  };
}

function classify(hits: SearchHit[], conflicting: boolean): RecallPackage["classification"] {
  if (!hits.length) return "no_reliable_memory_found";
  if (conflicting) return "conflicting_memories_found";
  if (hits.some(hit => hit.match_type === "exact_record")) return "exact_record_found";
  if (hits.some(hit => hit.match_type === "similar_record")) return "similar_record_found";
  if (hits.every(hit => hit.match_type === "unprocessed_raw")) return "unprocessed_raw_match";
  return "possible_match";
}
