import { randomUUID } from "node:crypto";
import path from "node:path";
import { atomicJson, readJson } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertTermRelation } from "./schema-validation.js";
import { assertTermRelationPath } from "./record-paths.js";
import { listJsonFiles } from "./vault.js";

export type TermRelationType = "synonym" | "alias" | "abbreviation" | "related" | "contextual_equivalent" | "location_mapping" | "product_name" | "ambiguous";

const RELATION_TYPES = new Set<TermRelationType>(["synonym", "alias", "abbreviation", "related", "contextual_equivalent", "location_mapping", "product_name", "ambiguous"]);

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

export async function addTermRelation(root: string, input: Omit<TermRelation, "schema_version" | "relation_id" | "created_at" | "last_verified"> & { timestamp?: string }): Promise<TermRelation> {
  const project = assertSafeId(input.project_id, "project id");
  const a = normalize(input.term_a);
  const b = normalize(input.term_b);
  if (!a || !b || a === b) throw new Error("Term relation requires two distinct terms");
  if (!RELATION_TYPES.has(input.relation_type)) throw new Error("Invalid term relation type");
  if (input.confidence < 0 || input.confidence > 1) throw new Error("Confidence must be between 0 and 1");
  if (!input.evidence_refs.length) throw new Error("Term relation requires evidence");
  const timestamp = input.timestamp ?? new Date().toISOString();
  const relation: TermRelation = {
    schema_version: 1, relation_id: `tr_${randomUUID()}`, project_id: project, term_a: a, term_b: b,
    relation_type: input.relation_type, confidence: input.confidence, context_tags: [...new Set(input.context_tags.map(normalize).filter(Boolean))],
    evidence_refs: [...new Set(input.evidence_refs)], created_at: timestamp, last_verified: timestamp
  };
  assertTermRelation(relation);
  await atomicJson(path.join(vaultPaths(root).registry, "term-graph", project, `${relation.relation_id}.json`), relation);
  return relation;
}

export async function expandTerms(root: string, projectId: string, queryTerms: string[], contextTags: string[] = []): Promise<Map<string, number>> {
  const project = assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  const query = new Set(queryTerms.map(normalize).filter(Boolean));
  const context = new Set(contextTags.map(normalize).filter(Boolean));
  const expanded = new Map<string, number>();
  for (const file of await listJsonFiles(path.join(p.registry, "term-graph", project))) {
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
