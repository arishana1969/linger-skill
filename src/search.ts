import path from "node:path";
import { readJson } from "./io.js";
import { effectiveMemoryStates } from "./memory-events.js";
import { vaultPaths } from "./paths.js";
import { expandTerms } from "./term-graph.js";
import type { ProcessedMemory, RawEvent, SearchHit } from "./types.js";
import { initVault, listJsonFiles } from "./vault.js";

const QUERY_STOP = new Set(["我们", "们讨", "讨论", "论过", "之前", "前为", "为什么", "什么", "么没", "没有", "最后", "后定", "定了", "了什", "吗"]);

export interface SearchOptions {
  projectId: string;
  query: string;
  includeSensitive?: boolean;
  includeRaw?: boolean;
  limit?: number;
  contextTags?: string[];
}

export async function search(root: string, options: SearchOptions): Promise<SearchHit[]> {
  const config = await initVault(root);
  const p = vaultPaths(root);
  const originalTokens = tokenize(options.query).filter(token => !QUERY_STOP.has(token));
  if (!originalTokens.length) return [];
  const expansions = await expandTerms(root, options.projectId, lexicalTerms(options.query), options.contextTags);
  const weights = new Map<string, number>(originalTokens.map(token => [token, 1]));
  for (const [term, confidence] of expansions) for (const token of tokenize(term)) weights.set(token, Math.max(weights.get(token) ?? 0, confidence * 0.75));
  const searchTokens = [...weights.keys()];
  const files = await listJsonFiles(path.join(p.processed, options.projectId));
  const memories = await Promise.all(files.map(readJson<ProcessedMemory>));
  const controlStates = await effectiveMemoryStates(root, options.projectId);
  const active = memories.filter(memory => memory.status === "active" && !controlStates.has(memory.id) && (options.includeSensitive || memory.sensitivity === "normal"));
  const documentFrequency = new Map<string, number>();
  for (const token of searchTokens) documentFrequency.set(token, active.filter(memory => tokenize(searchable(memory)).includes(token)).length);
  const hits = active.map(memory => scoreMemory(memory, originalTokens, searchTokens, weights, documentFrequency, active.length, expansions.size > 0)).filter(hit => hit.score > 0);

  if (options.includeRaw) {
    for (const file of await listJsonFiles(path.join(p.raw, options.projectId))) {
      const event = await readJson<RawEvent>(file);
      if (event.sensitivity !== "normal" && !options.includeSensitive) continue;
      const eventTokens = tokenize(event.content);
      const overlap = searchTokens.filter(token => eventTokens.includes(token)).length;
      if (overlap) hits.push({ match_type: "unprocessed_raw", confidence: Math.min(0.6, overlap / searchTokens.length), score: overlap, source: event.event_id, snippet: event.content.slice(0, 500), raw_ref: [event.raw_ref], warning_flags: ["unprocessed_raw"], sensitivity_flags: event.sensitivity === "normal" ? [] : [event.sensitivity] });
    }
  }
  return hits.sort((a, b) => b.score - a.score || b.confidence - a.confidence).slice(0, options.limit ?? config.max_snippets);
}

function scoreMemory(memory: ProcessedMemory, original: string[], candidates: string[], weights: Map<string, number>, df: Map<string, number>, total: number, expanded: boolean): SearchHit {
  const textTokens = tokenize(searchable(memory));
  let score = 0;
  let expansionHit = false;
  for (const token of candidates) {
    const tf = textTokens.filter(value => value === token).length;
    if (!tf) continue;
    const idf = Math.log(1 + (total - (df.get(token) ?? 0) + 0.5) / ((df.get(token) ?? 0) + 0.5));
    score += idf * ((tf * 2.2) / (tf + 1.2)) * (weights.get(token) ?? 1);
    if (memory.tags.includes(token)) score += 2 * (weights.get(token) ?? 1);
    if (!original.includes(token)) expansionHit = true;
  }
  const latinCandidates = candidates.filter(token => /^[a-z0-9]/.test(token));
  if (latinCandidates.length && !latinCandidates.some(token => textTokens.includes(token))) score = 0;
  if (memory.source === "user_explicit") score *= 1.35;
  const coverage = original.filter(token => textTokens.includes(token)).length / original.length;
  return {
    match_type: coverage === 1 ? "exact_record" : coverage >= 0.5 ? "similar_record" : "possible_match",
    confidence: Math.min(1, memory.confidence * (0.5 + coverage / 2) * (expansionHit && coverage === 0 ? 0.8 : 1)),
    score, source: memory.id, snippet: memory.summary.slice(0, 500), raw_ref: memory.source_events,
    warning_flags: expanded && expansionHit ? ["term_expansion"] : [], sensitivity_flags: memory.sensitivity === "normal" ? [] : [memory.sensitivity]
  };
}

function searchable(memory: ProcessedMemory): string { return [memory.title, memory.summary, ...memory.tags, ...memory.predictive_tags, ...memory.retrieval_phrases].join(" "); }
function lexicalTerms(text: string): string[] { return [...new Set([...(text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []), ...(text.match(/[\p{Script=Han}]+/gu) ?? []).map(value => value.toLowerCase())])]; }
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
  const chunks = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const cjk: string[] = [];
  for (const chunk of chunks) { if (chunk.length <= 2) cjk.push(chunk); else for (let index = 0; index < chunk.length - 1; index += 1) cjk.push(chunk.slice(index, index + 2)); }
  return [...latin, ...cjk];
}
