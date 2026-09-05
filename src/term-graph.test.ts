import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { vaultPaths } from "./paths.js";
import { expandTerms, readTermRelations, setTermRelation, type TermRelation, type TermRelationType } from "./term-graph.js";
import { capture } from "./capture.js";

test("expands confident aliases only inside project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-terms-"));
  await writeLegacyRelation(root, "p_one", "db", "database", "abbreviation", 0.95);
  assert.equal((await expandTerms(root, "p_one", ["db"])).get("database"), 0.95);
  assert.equal((await expandTerms(root, "p_two", ["db"])).size, 0);
});

test("does not expand ambiguous, low-confidence, or context-mismatched relations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-terms-"));
  await writeLegacyRelation(root, "p", "cc", "claude code", "ambiguous", 0.9);
  await writeLegacyRelation(root, "p", "store", "vault", "related", 0.5);
  await writeLegacyRelation(root, "p", "pg", "postgresql", "alias", 0.9, ["backend"]);
  assert.equal((await expandTerms(root, "p", ["cc", "store", "pg"])).size, 0);
  assert.equal((await expandTerms(root, "p", ["pg"], ["backend"])).get("postgresql"), 0.9);
});

test("curation is project-scoped and idempotent; contextual phrases and ambiguity constrain legacy relations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-term-curation-"));
  const evidence = await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", sourceAgent: "test",
    content: "In the backend context, GC means garbage collector; outside that context GC is ambiguous." });
  const input = { projectId: "p", termA: "GC", termB: "Garbage Collector", relationType: "contextual_equivalent" as const,
    confidence: 0.95, evidenceRefs: [evidence!.event_id], contextTags: [" Backend "] };
  await assert.rejects(setTermRelation(root, { ...input, contextTags: [] }), /requires context/);
  await assert.rejects(setTermRelation(root, { ...input, projectId: "other" }), /evidence in this project/);
  const first = await setTermRelation(root, input);
  const second = await setTermRelation(root, input);
  assert.equal(first.relation_id, second.relation_id);
  assert.equal(first.created_at, second.created_at);
  assert.equal((await readTermRelations(root, "p")).length, 1);
  assert.equal((await expandTerms(root, "p", ["gc"])).size, 0);
  assert.equal((await expandTerms(root, "p", ["why use garbage collector"], ["BACKEND"])).get("gc"), 0.95);
  assert.equal((await expandTerms(root, "other", ["gc"], ["backend"])).size, 0);

  // Schema-v1 files keep their IDs and spelling. A curated non-equivalence vetoes this older claim.
  await writeLegacyRelation(root, "p", "GC", "Garbage Collector", "alias", 0.9, ["BACKEND"]);
  assert.equal((await expandTerms(root, "p", ["gc"], ["backend"])).get("garbage collector"), 0.95);
  await setTermRelation(root, { ...input, termB: "garbage-collector", relationType: "ambiguous" });
  assert.equal((await readTermRelations(root, "p")).length, 2); // One curated pair plus the legacy file.
  assert.equal((await expandTerms(root, "p", ["gc"], ["backend"])).size, 0);
});

async function writeLegacyRelation(root: string, project: string, a: string, b: string, type: TermRelationType, confidence: number, context: string[] = []): Promise<TermRelation> {
  const relation: TermRelation = {
    schema_version: 1,
    relation_id: `tr_${a}`,
    project_id: project,
    term_a: a,
    term_b: b,
    relation_type: type,
    confidence,
    context_tags: context,
    evidence_refs: ["legacy_evidence"],
    created_at: "2026-01-01T00:00:00.000Z",
    last_verified: "2026-01-01T00:00:00.000Z"
  };
  const file = path.join(vaultPaths(root).registry, "term-graph", project, `${relation.relation_id}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(relation)}\n`);
  return relation;
}
