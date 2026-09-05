import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { forget } from "./control.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { rebuildTagRegistry, readTagRegistry, suggestTags } from "./tag-registry.js";
import { setSetting } from "./settings.js";
import { readTermRelations, setTermRelation, type TermRelationType } from "./term-graph.js";
import { hybridSearch } from "./local/hybrid-search.js";
import { suggestLocalTags } from "./local/local-embedding-runtime.js";
import { vaultPaths } from "./paths.js";

test("rebuilds tag counts from active processed source records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-tags-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t1", role: "user", content: "database storage decision", sourceAgent: "test" });
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t2", role: "user", content: "database migration plan", sourceAgent: "test" });
  await processQueue(root);
  const registry = await rebuildTagRegistry(root, "p");
  assert.equal(registry.entries.find(entry => entry.normalized_tag === "database")?.usage_count, 2);
  assert.equal((await readTagRegistry(root, "p"))?.entries.length, registry.entries.length);
  const candidate = (await suggestTags(root, "p", "database")).candidates[0]!;
  assert.equal(candidate.evidence_refs.length, 1);
  const relation = await setTermRelation(root, { projectId: "p", termA: "db", termB: candidate.tag,
    relationType: "abbreviation", confidence: 0.9, evidenceRefs: candidate.evidence_refs });
  assert.deepEqual(relation.evidence_refs, candidate.evidence_refs);
});

test("rebuild excludes forgotten memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-tags-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "obsolete-tag content", sourceAgent: "test" });
  await processQueue(root);
  const hit = (await search(root, { projectId: "p", query: "obsolete-tag" }))[0]!;
  await forget(root, "p", hit.source);
  const registry = await rebuildTagRegistry(root, "p");
  assert.equal(registry.entries.some(entry => entry.normalized_tag === "obsolete-tag"), false);
});

test("fixed semantic acceptance set: discovery, typed relations, lexical protection, and offline fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-tag-semantics-"));
  const cases: Array<[string, string, TermRelationType, boolean]> = [
    ["automobile", "car", "synonym", true],
    ["db", "database", "abbreviation", true],
    ["storage", "postgresql", "related", false], // Related / narrower concept, not a synonym.
    ["enable", "disable", "related", false], // Opposites can be close in embedding space.
    ["cc", "compiler", "ambiguous", false]
  ];
  const evidence = await capture(root, { projectId: "p", sessionId: "s", turnId: "definitions", role: "user", sourceAgent: "test",
    content: "Reviewed vocabulary: automobile means car; db abbreviates database; storage and postgresql are related, enable and disable are opposites, cc is ambiguous." });
  for (const [, target] of cases) {
    await capture(root, { projectId: "p", sessionId: "s", turnId: target, role: "user", sourceAgent: "test", content: `${target} acceptance memory contains a durable project note.` });
  }
  await capture(root, { projectId: "other", sessionId: "s", turnId: "foreign", role: "user", sourceAgent: "test", content: "foreign-only acceptance memory for a separate project" });
  await processQueue(root);
  const disabled = await suggestTags(root, "p", "database", { embed: async () => { throw new Error("must not embed when disabled"); } });
  assert.equal(disabled.semantic_status, "off");
  assert.equal(disabled.candidates[0]?.tag, "database");
  await setSetting(root, { scope: "project", projectId: "p", key: "embedding.desired_enabled", value: true });
  const suggestions = await suggestTags(root, "p", "db", { limit: 20, embed: async (_query, tags) => {
    assert.equal(tags.includes("foreign-only"), false);
    // Deliberately equal high similarity: the relation layer must still distinguish all five cases.
    return { dimension: 2, vectors: [tags[0], ...tags].map(() => [1, 0]) };
  } });
  assert.equal(suggestions.semantic_status, "active");
  assert.equal(suggestions.candidates.find(candidate => candidate.tag === "database")?.semantic_similarity, 1);
  assert.equal(JSON.stringify(suggestions).includes('"vectors"'), false);
  assert.deepEqual(await readTermRelations(root, "p"), []);
  for (const [termA, termB, relationType, expands] of cases) {
    const target = (await search(root, { projectId: "p", query: termB })).find(hit => hit.snippet.startsWith(`${termB} acceptance`))!;
    assert.ok(target);
    assert.equal((await search(root, { projectId: "p", query: termA })).some(hit => hit.source === target.source), false);
    await setTermRelation(root, { projectId: "p", termA, termB, relationType, confidence: 0.95, evidenceRefs: [evidence!.event_id] });
    const hits = await search(root, { projectId: "p", query: termA });
    const expanded = hits.find(hit => hit.source === target.source);
    assert.equal(Boolean(expanded), expands, relationType);
    if (expanded) {
      assert.equal(expanded.match_type, "possible_match");
      assert.ok(expanded.confidence < 0.5);
      assert.ok(expanded.warning_flags.includes("term_expansion"));
      assert.equal(hits[0]?.match_type, "exact_record");
    }
  }
  const lexical = await search(root, { projectId: "p", query: "db" });
  const fallback = await hybridSearch(root, { projectId: "p", query: "db", embedQuery: async () => { throw new Error("offline"); }, minimumSimilarity: 0.82 });
  assert.deepEqual(fallback.hits.map(hit => [hit.source, hit.confidence, hit.match_type]), lexical.map(hit => [hit.source, hit.confidence, hit.match_type]));
  assert.equal(fallback.effective_mode, "deterministic-only");
  const unavailable = await suggestLocalTags(root, "p", "database");
  assert.equal(unavailable.semantic_status, "unavailable");
  assert.equal(unavailable.candidates[0]?.tag, "database");
  const privacy = await suggestTags(root, "p", "person@example.com", { embed: async () => { throw new Error("must not embed sensitive query"); } });
  assert.equal(privacy.semantic_status, "privacy_blocked");
  await setSetting(root, { scope: "project", projectId: "p", key: "embedding.desired_enabled", value: false });
  assert.deepEqual(await search(root, { projectId: "p", query: "db" }), lexical);
});

test("stale registry tags from forgotten records never enter the embedding worker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-tags-stale-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "forgotten-tag durable memory for candidate discovery", sourceAgent: "test" });
  await processQueue(root);
  const hit = (await search(root, { projectId: "p", query: "forgotten-tag" }))[0]!;
  await forget(root, "p", hit.source);
  await setSetting(root, { scope: "project", projectId: "p", key: "embedding.desired_enabled", value: true });
  const suggestions = await suggestTags(root, "p", "forgotten-tag", { embed: async () => { throw new Error("ineligible tags must not be embedded"); } });
  assert.equal(suggestions.considered_tags, 0);
  assert.deepEqual(suggestions.candidates, []);
});

test("tag work is bounded, exact names outrank higher cosine, and invalid vectors preserve lexical fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-tags-bounded-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "bounded candidate discovery fixture", sourceAgent: "test" });
  await processQueue(root);
  const hit = (await search(root, { projectId: "p", query: "bounded" }))[0]!;
  const file = path.join(vaultPaths(root).processed, "p", `${hit.source}.json`);
  const memory = JSON.parse(await readFile(file, "utf8"));
  memory.tags = [...Array.from({ length: 129 }, (_, index) => `topic-${String(index).padStart(3, "0")}`), "zz rare"];
  memory.predictive_tags = [];
  await writeFile(file, JSON.stringify(memory));
  await rebuildTagRegistry(root, "p");
  const registryBefore = await readTagRegistry(root, "p");
  await setSetting(root, { scope: "project", projectId: "p", key: "embedding.desired_enabled", value: true });
  const suggestions = await suggestTags(root, "p", "ZZ rare", { embed: async (_query, tags) => {
    assert.equal(tags.length, 128);
    assert.equal(tags[0], "zz-rare");
    return { dimension: 2, vectors: [[2, 0], ...tags.map(tag => tag === "zz-rare" ? [-3, 0] : [4, 0])] };
  } });
  assert.equal(suggestions.semantic_status, "active");
  assert.equal(suggestions.total_tags, 130);
  assert.equal(suggestions.considered_tags, 128);
  assert.equal(suggestions.candidates[0]?.tag, "zz-rare");
  assert.equal(suggestions.candidates[0]?.semantic_similarity, -1);
  assert.equal(suggestions.candidates[1]?.semantic_similarity, 1);
  assert.equal(suggestions.candidates.length, 8);
  const invalid = await suggestTags(root, "p", "ZZ rare", { embed: async (_query, tags) => ({ dimension: 2, vectors: [[1, 0], ...tags.map(() => [NaN, 0])] }) });
  assert.equal(invalid.semantic_status, "unavailable");
  assert.deepEqual(invalid.candidates.map(candidate => candidate.tag), ["zz-rare"]);
  assert.deepEqual(await readTagRegistry(root, "p"), registryBefore);
});
