import { resolveEffectiveSearchDocuments } from "../effective-search-document.js";
import { embeddingIndexStatus, searchEmbeddingIndex } from "./embedding-index.js";
import { assertSafeId } from "../paths.js";
import { search, type SearchOptions } from "../search.js";
import { classifySensitivity } from "../sensitivity.js";
import { resolveSettings } from "../settings.js";
import type { SearchHit } from "../types.js";

export interface HybridSearchResult {
  hits: SearchHit[];
  effective_mode: "deterministic-only" | "hybrid";
  semantic_status: "off" | "privacy_blocked" | "active" | "unavailable" | "timeout" | "failed";
  degraded_reason?: string;
  index_generation?: string;
  stale_rows?: number;
}

export type SemanticQueryEmbedder = (query: string, timeoutMs: number) => Promise<number[]>;

export async function hybridSearch(
  root: string,
  options: SearchOptions & {
    embedQuery: SemanticQueryEmbedder;
    minimumSimilarity: number;
    semanticTimeoutMs?: number;
  }
): Promise<HybridSearchResult> {
  const projectId = assertSafeId(options.projectId, "project id");
  if (!Number.isFinite(options.minimumSimilarity) || options.minimumSimilarity < -1 || options.minimumSimilarity > 1) throw new Error("Invalid semantic similarity threshold");
  const limit = options.limit ?? 8;
  const lexicalPromise = search(root, { ...options, limit: 50 });
  const settings = await resolveSettings(root, { projectId });
  const desired = settings.values["embedding.desired_enabled"].value === true;
  const semanticWeight = settings.values["embedding.semantic_weight"].value as number;
  if (!desired || semanticWeight === 0) return deterministic(await lexicalPromise, limit, "off");
  const sensitivity = classifySensitivity(options.query).level;
  if (sensitivity !== "normal") return deterministic(await lexicalPromise, limit, "privacy_blocked", "embedding.query_sensitive_blocked");
  if (await embeddingIndexStatus(root, projectId) !== "active") return deterministic(await lexicalPromise, limit, "unavailable", "embedding.index_missing");

  const semanticTimeoutMs = options.semanticTimeoutMs ?? 3_000;
  let semantic: Awaited<ReturnType<typeof searchEmbeddingIndex>>;
  try {
    const vector = await within(options.embedQuery(options.query, semanticTimeoutMs), semanticTimeoutMs);
    semantic = await within(searchEmbeddingIndex(root, projectId, vector, 50), semanticTimeoutMs);
  } catch (error) {
    const timedOut = (error as Error).message === "semantic_timeout";
    return deterministic(await lexicalPromise, limit, timedOut ? "timeout" : "failed", timedOut ? "embedding.semantic_timeout" : "embedding.semantic_failed");
  }
  const lexical = await lexicalPromise;
  const documents = new Map((await resolveEffectiveSearchDocuments(root, projectId)).map(document => [document.memory_id, document]));
  const lexicalRanks = new Map(lexical.map((hit, index) => [hit.source, index + 1]));
  const semanticEligible = semantic.hits.filter(hit => hit.similarity >= options.minimumSimilarity);
  const semanticRanks = new Map(semanticEligible.map((hit, index) => [hit.memory_id, { rank: index + 1, hit }]));
  const lexicalById = new Map(lexical.map(hit => [hit.source, hit]));
  const ids = [...new Set([...lexicalById.keys(), ...semanticRanks.keys()])];
  const fused: SearchHit[] = [];
  for (const id of ids) {
    const lexicalHit = lexicalById.get(id);
    const semanticEntry = semanticRanks.get(id);
    const document = documents.get(id);
    if (!lexicalHit && !document?.eligibility.index) continue;
    const lexicalRank = lexicalRanks.get(id);
    const semanticRank = semanticEntry?.rank;
    const fusedScore = quantized((lexicalRank ? 1 / (60 + lexicalRank) : 0) + (semanticRank ? semanticWeight / (60 + semanticRank) : 0));
    const base: SearchHit = lexicalHit ? { ...lexicalHit } : {
      match_type: "possible_match",
      confidence: Math.min(0.5, document!.confidence),
      score: 0,
      source: id,
      snippet: [...document!.display_summary].slice(0, 500).join(""),
      raw_ref: document!.evidence_descriptors.map(descriptor => descriptor.event_id),
      warning_flags: ["semantic_only"],
      sensitivity_flags: []
    };
    fused.push({
      ...base,
      ...(lexicalRank ? { lexical_rank: lexicalRank, lexical_score: lexicalHit!.score } : {}),
      ...(semanticRank ? { semantic_rank: semanticRank, semantic_similarity: semanticEntry!.hit.similarity, index_generation: semantic.generation_id } : {}),
      fused_score: fusedScore,
      retrieval_branch: lexicalRank && semanticRank ? "hybrid" : lexicalRank ? "lexical" : "semantic",
      warning_flags: [...new Set([...base.warning_flags, ...(lexicalRank && semanticRank ? ["hybrid_hit"] : [])])]
    });
  }
  fused.sort((left, right) => exactTier(right) - exactTier(left)
    || (right.fused_score ?? 0) - (left.fused_score ?? 0)
    || matchTier(right.match_type) - matchTier(left.match_type)
    || (right.lexical_score ?? 0) - (left.lexical_score ?? 0)
    || Buffer.compare(Buffer.from(left.source), Buffer.from(right.source)));
  return {
    hits: fused.slice(0, limit),
    effective_mode: "hybrid",
    semantic_status: "active",
    index_generation: semantic.generation_id,
    stale_rows: semantic.stale_rows,
    ...(semantic.stale_rows ? { degraded_reason: "embedding.index_stale_rows" } : {})
  };
}

function deterministic(hits: SearchHit[], limit: number, status: HybridSearchResult["semantic_status"], reason?: string): HybridSearchResult {
  return {
    hits: hits.slice(0, limit).map((hit, index) => ({ ...hit, lexical_rank: index + 1, lexical_score: hit.score, retrieval_branch: "lexical" })),
    effective_mode: "deterministic-only",
    semantic_status: status,
    ...(reason ? { degraded_reason: reason } : {})
  };
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid semantic timeout");
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("semantic_timeout")), timeoutMs); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function exactTier(hit: SearchHit): number { return hit.match_type === "exact_record" && hit.retrieval_branch !== "semantic" ? 1 : 0; }
function matchTier(value: SearchHit["match_type"]): number { return value === "exact_record" ? 3 : value === "similar_record" ? 2 : value === "possible_match" ? 1 : 0; }
function quantized(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
