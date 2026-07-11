import path from "node:path";
import { readJson } from "./io.js";
import { effectiveMemoryStates } from "./memory-events.js";
import { vaultPaths } from "./paths.js";
import { initVault, listJsonFiles } from "./vault.js";
import type { ProcessedMemory, RawEvent, SearchHit } from "./types.js";

export interface SearchOptions {
  projectId: string;
  query: string;
  includeSensitive?: boolean;
  includeRaw?: boolean;
  limit?: number;
}

export async function search(root: string, options: SearchOptions): Promise<SearchHit[]> {
  const config = await initVault(root);
  const p = vaultPaths(root);
  const tokens = tokenize(options.query);
  if (!tokens.length) return [];
  const files = await listJsonFiles(path.join(p.processed, options.projectId));
  const controlStates = await effectiveMemoryStates(root, options.projectId);
  const memories = await Promise.all(files.map(readJson<ProcessedMemory>));
  const active = memories.filter(memory => memory.status === "active" && !controlStates.has(memory.id) && (options.includeSensitive || memory.sensitivity === "normal"));
  const documentFrequency = new Map<string, number>();
  for (const token of tokens) documentFrequency.set(token, active.filter(memory => tokenize(searchable(memory)).includes(token)).length);
  const hits = active.map(memory => scoreMemory(memory, tokens, documentFrequency, active.length)).filter(hit => hit.score > 0);

  if (options.includeRaw) {
    for (const file of await listJsonFiles(path.join(p.raw, options.projectId))) {
      const event = await readJson<RawEvent>(file);
      if (event.sensitivity !== "normal" && !options.includeSensitive) continue;
      const overlap = tokens.filter(token => tokenize(event.content).includes(token)).length;
      if (overlap) hits.push({
        match_type: "unprocessed_raw",
        confidence: Math.min(0.6, overlap / tokens.length),
        score: overlap,
        source: event.event_id,
        snippet: event.content.slice(0, 500),
        raw_ref: [event.raw_ref],
        warning_flags: ["unprocessed_raw"],
        sensitivity_flags: event.sensitivity === "normal" ? [] : [event.sensitivity]
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score || b.confidence - a.confidence).slice(0, options.limit ?? config.max_snippets);
}

function scoreMemory(memory: ProcessedMemory, query: string[], df: Map<string, number>, total: number): SearchHit {
  const textTokens = tokenize(searchable(memory));
  let score = 0;
  for (const token of query) {
    const tf = textTokens.filter(value => value === token).length;
    if (!tf) continue;
    const idf = Math.log(1 + (total - (df.get(token) ?? 0) + 0.5) / ((df.get(token) ?? 0) + 0.5));
    score += idf * ((tf * 2.2) / (tf + 1.2));
    if (memory.tags.includes(token)) score += 2;
  }
  if (memory.source === "user_explicit") score *= 1.35;
  const coverage = query.filter(token => textTokens.includes(token)).length / query.length;
  return {
    match_type: coverage === 1 ? "exact_record" : coverage >= 0.5 ? "similar_record" : "possible_match",
    confidence: Math.min(1, memory.confidence * (0.5 + coverage / 2)),
    score,
    source: memory.id,
    snippet: memory.summary.slice(0, 500),
    raw_ref: memory.source_events,
    warning_flags: [],
    sensitivity_flags: memory.sensitivity === "normal" ? [] : [memory.sensitivity]
  };
}

function searchable(memory: ProcessedMemory): string {
  return [memory.title, memory.summary, ...memory.tags, ...memory.predictive_tags, ...memory.retrieval_phrases].join(" ");
}

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
  const chunks = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const cjk: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= 2) cjk.push(chunk);
    else for (let index = 0; index < chunk.length - 1; index += 1) cjk.push(chunk.slice(index, index + 2));
  }
  return [...latin, ...cjk];
}
