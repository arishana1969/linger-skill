import path from "node:path";
import { readJson } from "./io.js";
import { resolveEffectiveSearchDocuments, type EffectiveSearchDocument } from "./effective-search-document.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { expandTerms } from "./term-graph.js";
import { assertRawEvent } from "./schema-validation.js";
import { assertRawRecordPath } from "./record-paths.js";
import { resolveSettings } from "./settings.js";
import type { RawEvent, SearchHit } from "./types.js";
import { listJsonFiles } from "./vault.js";

const QUERY_STOP = new Set(["a", "an", "did", "do", "does", "for", "is", "of", "our", "the", "to", "was", "we", "were", "what", "which", "why", "我们", "们讨", "讨论", "论过", "之前", "前为", "为什么", "什么", "么没", "没有", "最后", "后定", "定了", "了什", "吗"]);

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
  const project = assertSafeId(options.projectId, "project id");
  const settings = await resolveSettings(root, { projectId: project });
  const timeoutMs = nonNegativeInteger(options.timeoutMs ?? settingNumber(settings, "recall.timeout_ms"), "timeoutMs");
  const deadline = Date.now() + timeoutMs;
  assertBeforeDeadline(deadline);
  const p = vaultPaths(root);
  const from = dateBoundary(options.from, "from");
  const to = dateBoundary(options.to, "to");
  if (from !== undefined && to !== undefined && from > to) throw new Error("from must not be after to");
  const maxFiles = positiveInteger(options.maxFiles ?? settingNumber(settings, "recall.max_files"), "maxFiles");
  const maxRawFragmentCharacters = positiveInteger(options.maxRawFragmentCharacters ?? settingNumber(settings, "recall.max_raw_fragment_characters"), "maxRawFragmentCharacters");
  const originalTokens = tokenize(options.query).filter(token => !QUERY_STOP.has(token));
  if (!originalTokens.length) return [];
  const expansions = await within(expandTerms(root, project, lexicalTerms(options.query), options.contextTags), deadline);
  const weights = new Map<string, number>(originalTokens.map(token => [token, 1]));
  for (const [term, confidence] of expansions) for (const token of tokenize(term)) weights.set(token, Math.max(weights.get(token) ?? 0, confidence * 0.75));
  const searchTokens = [...weights.keys()];
  const documents = await within(resolveEffectiveSearchDocuments(root, project, { maxFiles }), deadline);
  const active = documents.filter(document =>
    (options.includeSensitive ? document.eligibility.lexical_explicit_sensitive : document.eligibility.lexical_default)
    && inRange(document.created_at, from, to)
  );
  const documentFrequency = new Map<string, number>();
  for (const token of searchTokens) {
    assertBeforeDeadline(deadline);
    documentFrequency.set(token, active.filter(document => tokenize(document.canonical_text).includes(token)).length);
  }
  const hits: SearchHit[] = [];
  const explicitPriority = new Map<string, number>();
  for (const document of active) {
    assertBeforeDeadline(deadline);
    const hit = scoreMemory(document, originalTokens, searchTokens, weights, documentFrequency, active.length, expansions.size > 0);
    if (hit.score > 0) {
      hits.push(hit);
      explicitPriority.set(hit.source, document.source === "user_explicit" ? 1 : 0);
    }
  }

  if (options.includeRaw) {
    const rawFiles = (await within(listJsonFiles(path.join(p.raw, project), p.root), deadline)).slice(0, maxFiles);
    const rawEvents = (await within(Promise.all(rawFiles.map(async file => {
      try { const value = await readJson<unknown>(file); assertRawEvent(value); assertRawRecordPath(p, file, value); return value; } catch { return undefined; }
    })), deadline)).filter((event): event is RawEvent => Boolean(event));
    for (const event of rawEvents) {
      assertBeforeDeadline(deadline);
      if (!inRange(event.timestamp, from, to)) continue;
      if (event.sensitivity !== "normal" && !options.includeSensitive) continue;
      const eventTokens = tokenize(event.content);
      const overlap = searchTokens.filter(token => eventTokens.includes(token)).length;
      if (overlap) hits.push({ match_type: "unprocessed_raw", confidence: Math.min(0.6, overlap / searchTokens.length) * (event.savepoint_status === "partial" ? 0.6 : 1), score: overlap, source: event.event_id, snippet: event.content.slice(0, maxRawFragmentCharacters), raw_ref: [event.raw_ref], warning_flags: ["unprocessed_raw", ...(event.savepoint_status === "partial" ? ["partial_source"] : [])], sensitivity_flags: event.sensitivity === "normal" ? [] : [event.sensitivity] });
    }
  }
  return hits.sort((a, b) => matchRank(b.match_type) - matchRank(a.match_type) || (explicitPriority.get(b.source) ?? 0) - (explicitPriority.get(a.source) ?? 0) || b.score - a.score || b.confidence - a.confidence).slice(0, options.limit ?? settingNumber(settings, "recall.max_snippets"));
}

function settingNumber(settings: Awaited<ReturnType<typeof resolveSettings>>, key: "recall.timeout_ms" | "recall.max_files" | "recall.max_raw_fragment_characters" | "recall.max_snippets"): number {
  return settings.values[key].value as number;
}

function matchRank(type: SearchHit["match_type"]): number {
  return type === "exact_record" ? 3 : type === "similar_record" ? 2 : type === "possible_match" ? 1 : 0;
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

function scoreMemory(document: EffectiveSearchDocument, original: string[], candidates: string[], weights: Map<string, number>, df: Map<string, number>, total: number, expanded: boolean): SearchHit {
  const textTokens = tokenize(document.canonical_text);
  let score = 0;
  let expansionHit = false;
  for (const token of candidates) {
    const tf = textTokens.filter(value => value === token).length;
    if (!tf) continue;
    const idf = Math.log(1 + (total - (df.get(token) ?? 0) + 0.5) / ((df.get(token) ?? 0) + 0.5));
    score += idf * ((tf * 2.2) / (tf + 1.2)) * (weights.get(token) ?? 1);
    if (document.search_tags.includes(token)) score += 2 * (weights.get(token) ?? 1);
    if (!original.includes(token)) expansionHit = true;
  }
  const latinOriginal = original.filter(token => /^[a-z0-9]/.test(token));
  const latinCoverage = latinOriginal.length ? latinOriginal.filter(token => textTokens.includes(token)).length / latinOriginal.length : 1;
  if (latinCoverage < 0.5 && !expansionHit) score = 0;
  if (document.source === "user_explicit") score *= 1.35;
  const coverage = original.filter(token => textTokens.includes(token)).length / original.length;
  const partial = document.integrity === "partial";
  return {
    match_type: coverage === 1 ? "exact_record" : coverage >= 0.5 ? "similar_record" : "possible_match",
    confidence: Math.min(1, document.confidence * (0.5 + coverage / 2) * (expansionHit && coverage === 0 ? 0.8 : 1) * (partial ? 0.6 : 1)),
    score, source: document.memory_id, snippet: [...document.display_summary].slice(0, 500).join(""), raw_ref: document.evidence_descriptors.map(source => source.event_id),
    warning_flags: [...new Set([...(expanded && expansionHit ? ["term_expansion"] : []), ...document.warning_flags])], sensitivity_flags: document.sensitivity === "normal" ? [] : [document.sensitivity]
  };
}
function lexicalTerms(text: string): string[] { return [...new Set([...(text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []), ...(text.match(/[\p{Script=Han}]+/gu) ?? []).map(value => value.toLowerCase())])]; }
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
  const chunks = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const cjk: string[] = [];
  for (const chunk of chunks) { if (chunk.length <= 2) cjk.push(chunk); else for (let index = 0; index < chunk.length - 1; index += 1) cjk.push(chunk.slice(index, index + 2)); }
  return [...latin, ...cjk];
}
