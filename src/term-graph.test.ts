import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addTermRelation, expandTerms } from "./term-graph.js";

test("expands confident aliases only inside project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-terms-"));
  await addTermRelation(root, { project_id: "p_one", term_a: "db", term_b: "database", relation_type: "abbreviation", confidence: 0.95, context_tags: [], evidence_refs: ["mem_1"] });
  assert.equal((await expandTerms(root, "p_one", ["db"])).get("database"), 0.95);
  assert.equal((await expandTerms(root, "p_two", ["db"])).size, 0);
});

test("does not expand ambiguous, low-confidence, or context-mismatched relations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-terms-"));
  await addTermRelation(root, { project_id: "p", term_a: "cc", term_b: "Claude Code", relation_type: "ambiguous", confidence: 0.9, context_tags: [], evidence_refs: ["m1"] });
  await addTermRelation(root, { project_id: "p", term_a: "store", term_b: "vault", relation_type: "related", confidence: 0.5, context_tags: [], evidence_refs: ["m2"] });
  await addTermRelation(root, { project_id: "p", term_a: "pg", term_b: "postgresql", relation_type: "alias", confidence: 0.9, context_tags: ["backend"], evidence_refs: ["m3"] });
  assert.equal((await expandTerms(root, "p", ["cc", "store", "pg"])).size, 0);
  assert.equal((await expandTerms(root, "p", ["pg"], ["backend"])).get("postgresql"), 0.9);
});

test("rejects unknown relation types", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-terms-invalid-"));
  await assert.rejects(addTermRelation(root, { project_id: "p", term_a: "db", term_b: "database", relation_type: "equivalent" as never, confidence: 0.9, context_tags: [], evidence_refs: ["m1"] }), /Invalid term relation type/);
  assert.equal((await expandTerms(root, "p", ["db"])).size, 0);
});
