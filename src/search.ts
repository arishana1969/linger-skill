import { createHash } from "node:crypto";
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
  from?: string;
  to?: string;
  maxFiles?: number;
  maxRawFragmentCharacters?: number;
  timeoutMs?: number;
}

export async function search(root: string, options: SearchOptions): Promise<SearchHit[]> {
  const config = await initVault(root);
  const timeoutMs = nonNegativeInteger(options.timeoutMs ?? config.search_timeout_ms ?? 2000, "timeoutMs");
  const deadline = Date.now() + timeoutMs;
  assertBeforeDeadline(deadline);
  const p = vaultPaths(root);
  const from = dateBoundary(options.from, "from");
  const to = dateBoundary(options.to, "to");
  if (from !== undefined && to !== undefined && from > to) throw new Error("from must not be after to");
  const maxFiles = positiveInteger(options.maxFiles ?? config.max_files ?? 5000, "maxFiles");
  const maxRawFragmentCharacters = positiveInteger(options.maxRawFragmentCharacters ?? config.max_raw_fragment_characters ?? 500, "maxRawFragmentCharacters");
  const originalTokens = tokenize(options.query).filter(token => !QUERY_STOP.has(token));
  if (!originalTokens.length) return [];
  const expansions = await within(expandTerms(root, options.projectId, lexicalTerms(options.query), options.contextTags), deadline);
  const weights = new Map<string, number>(originalTokens.map(token => [token, 1]));
  for (const [term, confidence] of expansions) for (const token of tokenize(term)) weights.set(token, Math.max(weights.get(token) ?? 0, confidence * 0.75));
  const searchTokens = [...weights.keys()];
  const files = (await within(listJsonFiles(path.join(p.processed, options.projectId)), deadline)).slice(0, maxFiles);
  const memories = await within(Promise.all(files.map(readJson<ProcessedMemory>)), deadline);
  const rawFiles = (await within(listJsonFiles(path.join(p.raw, options.projectId)), deadline)).slice(0, maxFiles);
  const rawEvents = (await within(Promise.all(rawFiles.map(async file => {
    try { return await readJson<RawEvent>(file); } catch { return undefined; }
  })), deadline)).filter((event): event is RawEvent => Boolean(event));
  const rawHashes = new Map(rawEvents.map(event => [event.event_id, { declared: event.content_hash, computed: createHash("sha256").update(event.content).digest("hex") }]));
  const integrity = new Map(memories.map(memory => [memory.id, sourceIntegrity(memory, rawHashes)]));
  const controlStates = await within(effectiveMemoryStates(root, options.projectId), deadline);
  const active = memories.filter(memory => memory.status === "active" && !controlStates.has(memory.id) && integrity.get(memory.id) !== "tampered" && inRange(memory.created_at, from, to) && (options.includeSensitive || memory.sensitivity === "normal"));
  const documentFrequency = new Map<string, number>();
  for (const token of searchTokens) {
    assertBeforeDeadline(deadline);
    documentFrequency.set(token, active.filter(memory => tokenize(searchable(memory)).includes(token)).length);
  }
  const hits: SearchHit[] = [];
  for (const memory of active) {
    assertBeforeDeadline(deadline);
    const hit = scoreMemory(memory, originalTokens, searchTokens, weights, documentFrequency, active.length, expansions.size > 0, integrity.get(memory.id) === "verified" ? "verified" : "unverified");
    if (hit.score > 0) hits.push(hit);
  }

  if (options.includeRaw) {
    for (const event of rawEvents) {
      assertBeforeDeadline(deadline);
      if (!inRange(event.timestamp, from, to)) continue;
      if (event.sensitivity !== "normal" && !options.includeSensitive) continue;
      const eventTokens = tokenize(event.content);
      const overlap = searchTokens.filter(token => eventTokens.includes(token)).length;
      if (overlap) hits.push({ match_type: "unprocessed_raw", confidence: Math.min(0.6, overlap / searchTokens.length) * (event.savepoint_status === "partial" ? 0.6 : 1), score: overlap, source: event.event_id, snippet: event.content.slice(0, maxRawFragmentCharacters), raw_ref: [event.raw_ref], warning_flags: ["unprocessed_raw", ...(event.savepoint_status === "partial" ? ["partial_source"] : [])], sensitivity_flags: event.sensitivity === "normal" ? [] : [event.sensitivity] });
    }
  }
  return hits.sort((a, b) => b.score - a.score || b.confidence - a.confidence).slice(0, options.limit ?? config.max_snippets);
}

async function within<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Search timed out");
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Search timed out")), remaining); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertBeforeDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw new Error("Search timed out");
}

function dateBoundary(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO date or timestamp`);
  return parsed;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function inRange(timestamp: string, from?: number, to?: number): boolean {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && (from === undefined || value >= from) && (to === undefined || value <= to);
}

function scoreMemory(memory: ProcessedMemory, original: string[], candidates: string[], weights: Map<string, number>, df: Map<string, number>, total: number, expanded: boolean, integrity: "verified" | "unverified"): SearchHit {
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
    confidence: Math.min(1, memory.confidence * (0.5 + coverage / 2) * (expansionHit && coverage === 0 ? 0.8 : 1) * (memory.source_savepoint_status === "partial" ? 0.6 : 1) * (integrity === "unverified" ? 0.75 : 1)),
    score, source: memory.id, snippet: memory.summary.slice(0, 500), raw_ref: memory.source_events,
    warning_flags: [...(expanded && expansionHit ? ["term_expansion"] : []), ...(memory.source_savepoint_status === "partial" ? ["partial_source"] : []), ...(integrity === "unverified" ? ["unverified_source"] : [])], sensitivity_flags: memory.sensitivity === "normal" ? [] : [memory.sensitivity]
  };
}

function sourceIntegrity(memory: ProcessedMemory, rawHashes: Map<string, { declared: string; computed: string }>): "verified" | "tampered" | "unverified" {
  if (!memory.source_hash) return "unverified";
  const sources = memory.source_events.map(id => rawHashes.get(id)).filter((value): value is { declared: string; computed: string } => Boolean(value));
  if (!sources.length) return "unverified";
  return sources.some(source => source.declared === source.computed && source.computed === memory.source_hash) ? "verified" : "tampered";
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
