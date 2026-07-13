import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { forget } from "./control.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { rebuildTagRegistry, readTagRegistry } from "./tag-registry.js";

test("rebuilds tag counts from active processed source records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-tags-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t1", role: "user", content: "database storage decision", sourceAgent: "test" });
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t2", role: "user", content: "database migration plan", sourceAgent: "test" });
  await processQueue(root);
  const registry = await rebuildTagRegistry(root, "p");
  assert.equal(registry.entries.find(entry => entry.normalized_tag === "database")?.usage_count, 2);
  assert.equal((await readTagRegistry(root, "p"))?.entries.length, registry.entries.length);
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
