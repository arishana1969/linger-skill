import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "../capture.js";
import { forget } from "../control.js";
import { resolveEffectiveSearchDocuments } from "../effective-search-document.js";
import { buildEmbeddingIndex, searchEmbeddingIndex, type EmbeddingBatcher } from "./embedding-index.js";
import { processQueue } from "../processing.js";
import { hybridSearch } from "./hybrid-search.js";
import { setSetting } from "../settings.js";

test("builds an immutable flat generation and invalidates forgotten rows at read time", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-embedding-index-"));
  await setSetting(root, { scope: "project", projectId: "p", key: "embedding.profile_id", value: "local-test" });
  await setSetting(root, { scope: "project", projectId: "p", key: "embedding.desired_enabled", value: true });

  await capture(root, { projectId: "p", sessionId: "s", turnId: "t1", role: "user", content: "alpha-orchid storage decision", sourceAgent: "test" });
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t2", role: "user", content: "beta-lantern release decision", sourceAgent: "test" });
  await processQueue(root);
  const embed: EmbeddingBatcher = async inputs => ({
    dimension: 3,
    vectors: inputs.map(value => value.includes("alpha-orchid") ? [1, 0, 0] : value.includes("beta-lantern") ? [0, 1, 0] : [0, 0, 1])
  });
  const built = await buildEmbeddingIndex(root, {
    projectId: "p",
    profileId: "local-test",
    runtimeIdentity: "a".repeat(64),
    modelIdentity: "local-test/model@revision",
    dimension: 3,
    inputPolicyId: "local-test-input/v1",
    prepareInput: value => value,
    embed,
    now: new Date("2026-08-11T01:00:00.000Z")
  });
  assert.equal(built.vector_count, 2);

  const documents = await resolveEffectiveSearchDocuments(root, "p");
  const alpha = documents.find(document => document.canonical_text.includes("alpha-orchid"))!;
  const semanticOnly = await hybridSearch(root, { projectId: "p", query: "unrelated semantic wording", embedQuery: async () => [1, 0, 0], minimumSimilarity: 0.5 });
  assert.equal(semanticOnly.effective_mode, "hybrid");
  assert.equal(semanticOnly.hits[0]?.source, alpha.memory_id);
  assert.equal(semanticOnly.hits[0]?.match_type, "possible_match");
  assert.ok(semanticOnly.hits[0]?.warning_flags.includes("semantic_only"));

  const exactProtected = await hybridSearch(root, { projectId: "p", query: "beta-lantern", embedQuery: async () => [1, 0, 0], minimumSimilarity: 0.5 });
  assert.equal(exactProtected.hits[0]?.match_type, "exact_record");
  let secretCalled = false;
  const privacy = await hybridSearch(root, { projectId: "p", query: "person@example.com", embedQuery: async () => { secretCalled = true; return [1, 0, 0]; }, minimumSimilarity: 0.5 });
  assert.equal(privacy.semantic_status, "privacy_blocked");
  assert.equal(secretCalled, false);

  assert.equal((await searchEmbeddingIndex(root, "p", [1, 0, 0])).hits[0]?.memory_id, alpha.memory_id);
  await forget(root, "p", alpha.memory_id);
  const after = await searchEmbeddingIndex(root, "p", [1, 0, 0]);
  assert.equal(after.hits.some(hit => hit.memory_id === alpha.memory_id), false);
  assert.equal(after.stale_rows, 1);
});
