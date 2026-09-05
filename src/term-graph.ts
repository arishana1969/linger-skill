import path from "node:path";
import { createHash } from "node:crypto";
import { assertWritableInside, atomicJson, readJson } from "./io.js";
import { assessEvidence, resolveEvidenceDescriptors } from "./effective-search-document.js";
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

export async function readTermRelations(root: string, projectId: string): Promise<TermRelation[]> {
  const project = assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  const relations: TermRelation[] = [];
  for (const file of await listJsonFiles(path.join(p.registry, "term-graph", project), p.root)) {
    try {
      const value = await readJson<unknown>(file);
      assertTermRelation(value);
      assertTermRelationPath(p, file, value);
      relations.push(value);
    } catch { /* Doctor reports invalid relations; lexical search remains available. */ }
  }
  return relations;
}

/** Explicit curation; embeddings do not call this writer. Same pair/context updates in place. */
export async function setTermRelation(root: string, input: {
  projectId: string;
  termA: string;
  termB: string;
  relationType: TermRelationType;
  confidence: number;
  contextTags?: string[];
  evidenceRefs: string[];
}): Promise<TermRelation> {
  const project = assertSafeId(input.projectId, "project id");
  const terms = [normalize(input.termA), normalize(input.termB)].sort();
  if (terms.some(term => !term || [...term].length > 128) || termKey(terms[0]!) === termKey(terms[1]!)) throw new Error("Relation requires two distinct terms of 1 to 128 characters");
  const context = [...new Set((input.contextTags ?? []).map(normalize).filter(Boolean))].sort();
  if (input.relationType === "contextual_equivalent" && !context.length) throw new Error("Contextual equivalence requires context tags");
  const now = new Date().toISOString();
  const id = `tr_${createHash("sha256").update(JSON.stringify([terms.map(termKey).sort(), context])).digest("hex").slice(0, 24)}`;
  const relation: TermRelation = {
    schema_version: 1, relation_id: id, project_id: project,
    term_a: terms[0]!, term_b: terms[1]!, relation_type: input.relationType,
    confidence: input.confidence, context_tags: context,
    evidence_refs: [...new Set(input.evidenceRefs)].sort(), created_at: now, last_verified: now
  };
  assertTermRelation(relation);
  const evidence = assessEvidence(relation.evidence_refs, await resolveEvidenceDescriptors(root, project, relation.evidence_refs));
  if (evidence.integrity !== "verified" || evidence.sensitivity !== "normal") throw new Error("Relation requires verified normal-sensitivity evidence in this project");
  const file = path.join(vaultPaths(root).registry, "term-graph", project, `${id}.json`);
  await assertWritableInside(root, file);
  try {
    const previous = await readJson<unknown>(file);
    assertTermRelation(previous);
    assertTermRelationPath(vaultPaths(root), file, previous);
    relation.created_at = previous.created_at;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await atomicJson(file, relation);
  return relation;
}

export async function expandTerms(root: string, projectId: string, queryTerms: string[], contextTags: string[] = []): Promise<Map<string, number>> {
  const query = queryTerms.map(termKey).filter(Boolean);
  const context = new Set(contextTags.map(normalize).filter(Boolean));
  const relations = (await readTermRelations(root, projectId)).filter(relation => relation.confidence >= 0.6
    && (!relation.context_tags.length || relation.context_tags.some(tag => context.has(normalize(tag)))));
  // An explicit non-equivalence vetoes a competing legacy equivalence for the same pair.
  const blocked = new Set(relations.filter(relation => relation.relation_type === "ambiguous" || relation.relation_type === "related").map(pairKey));
  const expanded = new Map<string, number>();
  for (const relation of relations) {
    if (blocked.has(pairKey(relation))) continue;
    if (relation.relation_type === "contextual_equivalent" && !relation.context_tags.length) continue;
    const a = normalize(relation.term_a), b = normalize(relation.term_b);
    if (matches(query, a)) expanded.set(b, Math.max(expanded.get(b) ?? 0, relation.confidence));
    if (matches(query, b)) expanded.set(a, Math.max(expanded.get(a) ?? 0, relation.confidence));
  }
  return expanded;
}

function normalize(value: string): string { return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " "); }
function termKey(value: string): string { return normalize(value.replaceAll("-", " ")); }
function pairKey(relation: TermRelation): string { return JSON.stringify([termKey(relation.term_a), termKey(relation.term_b)].sort()); }
function matches(query: string[], term: string): boolean {
  const phrase = termKey(term);
  return query.some(text => text === phrase || (phrase.includes(" ") && ` ${text} `.includes(` ${phrase} `)));
}
