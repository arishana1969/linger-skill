import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { vaultPaths } from "./paths.js";
import { expandTerms, type TermRelation, type TermRelationType } from "./term-graph.js";

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
