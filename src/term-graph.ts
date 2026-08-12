import path from "node:path";
import { readJson } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertTermRelation } from "./schema-validation.js";
import { assertTermRelationPath } from "./record-paths.js";
import { listJsonFiles } from "./vault.js";

export type TermRelationType = "synonym" | "alias" | "abbreviation" | "related" | "contextual_equivalent" | "location_mapping" | "product_name" | "ambiguous";

export interface TermRelation {
  schema_version: 1;
  relation_id: string;
  project_id: string;
  term_a: string;
  term_b: string;
  relation_type: TermRelationType;
  confidence: number;
  context_tags: string[];
  evidence_refs: string[];
  created_at: string;
  last_verified: string;
}

export async function expandTerms(root: string, projectId: string, queryTerms: string[], contextTags: string[] = []): Promise<Map<string, number>> {
  const project = assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  const query = new Set(queryTerms.map(normalize).filter(Boolean));
  const context = new Set(contextTags.map(normalize).filter(Boolean));
  const expanded = new Map<string, number>();
  for (const file of await listJsonFiles(path.join(p.registry, "term-graph", project), p.root)) {
    let relation: TermRelation;
    try { const value = await readJson<unknown>(file); assertTermRelation(value); assertTermRelationPath(p, file, value); relation = value; } catch { continue; }
    if (relation.relation_type === "ambiguous" || relation.confidence < 0.6) continue;
    if (relation.context_tags.length && !relation.context_tags.some(tag => context.has(tag))) continue;
    if (query.has(relation.term_a)) expanded.set(relation.term_b, Math.max(expanded.get(relation.term_b) ?? 0, relation.confidence));
    if (query.has(relation.term_b) && relation.relation_type !== "related") expanded.set(relation.term_a, Math.max(expanded.get(relation.term_a) ?? 0, relation.confidence));
  }
  return expanded;
}

function normalize(value: string): string { return value.trim().toLowerCase(); }
