import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("filters processed recall by inclusive time range", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-search-bounds-"));
  await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "alpha historical choice", sourceAgent: "test", timestamp: "2025-01-01T00:00:00.000Z" });
  await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "alpha current choice", sourceAgent: "test", timestamp: "2025-12-01T00:00:00.000Z" });
  await processQueue(root);
  const hits = await search(root, { projectId: "p", query: "alpha", from: "2025-06-01", to: "2025-12-31" });
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.snippet, /current/);
});

test("bounds scanned files and raw fragment characters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-search-bounds-"));
  await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: `needle ${"x".repeat(100)}`, sourceAgent: "test", timestamp: "2025-01-01T00:00:00.000Z" });
  await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "needle second", sourceAgent: "test", timestamp: "2025-02-01T00:00:00.000Z" });
  const hits = await search(root, { projectId: "p", query: "needle", includeRaw: true, maxFiles: 1, maxRawFragmentCharacters: 12 });
  assert.equal(hits.length, 1);
  assert.ok(hits[0]!.snippet.length <= 12);
});

test("rejects invalid search bounds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-search-bounds-"));
  await assert.rejects(search(root, { projectId: "p", query: "x", maxFiles: 0 }), /positive integer/);
  await assert.rejects(search(root, { projectId: "p", query: "x", from: "2026-01-01", to: "2025-01-01" }), /must not be after/);
  await assert.rejects(search(root, { projectId: "p", query: "x", timeoutMs: -1 }), /non-negative integer/);
});

test("fails explicitly when the search deadline is exhausted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-search-bounds-"));
  await assert.rejects(search(root, { projectId: "p", query: "x", timeoutMs: 0 }), /Search timed out/);
});
