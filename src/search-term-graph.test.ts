import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { vaultPaths } from "./paths.js";

test("recall expands project alias with lower confidence and warning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-search-terms-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "database migration decision", sourceAgent: "test" });
  await processQueue(root);
  assert.equal((await search(root, { projectId: "p", query: "db" })).length, 0);
  const file = path.join(vaultPaths(root).registry, "term-graph", "p", "tr_db.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    schema_version: 1, relation_id: "tr_db", project_id: "p", term_a: "db", term_b: "database",
    relation_type: "abbreviation", confidence: 0.95, context_tags: [], evidence_refs: ["legacy_evidence"],
    created_at: "2026-01-01T00:00:00.000Z", last_verified: "2026-01-01T00:00:00.000Z"
  }));
  const hit = (await search(root, { projectId: "p", query: "db" }))[0]!;
  assert.match(hit.snippet, /database/);
  assert.deepEqual(hit.warning_flags, ["term_expansion"]);
  assert.equal(hit.match_type, "possible_match");
  assert.ok(hit.confidence < 0.65);
});
