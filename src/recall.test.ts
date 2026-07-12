import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDecision } from "./decisions.js";
import { recall } from "./recall.js";

test("returns candidates instead of inventing memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-recall-"));
  await appendDecision(root, { projectId: "p", topic: "storage", kind: "decision", status: "current", statement: "Use files", source: "user_explicit", confidence: 1, evidenceRefs: ["evt"] });
  const result = await recall(root, { projectId: "p", query: "unknown subject" });
  assert.equal(result.classification, "no_reliable_memory_found");
  assert.deepEqual(result.candidates.topics, ["storage"]);
});

test("enforces evidence character budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-recall-"));
  const { capture } = await import("./capture.js");
  const { processQueue } = await import("./processing.js");
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: `budget ${"x".repeat(500)}`, sourceAgent: "test" });
  await processQueue(root);
  const result = await recall(root, { projectId: "p", query: "budget", maxCharacters: 40 });
  assert.equal(result.total_characters, 40);
  assert.equal(result.truncated, true);
});

test("candidate fallback includes observed month ranges without inventing hits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-recall-"));
  const { capture } = await import("./capture.js");
  const { processQueue } = await import("./processing.js");
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "timeline-zephyr durable project note", sourceAgent: "test", timestamp: "2025-07-14T00:00:00.000Z" });
  await processQueue(root);
  const result = await recall(root, { projectId: "p", query: "unknown-cassandra" });
  assert.equal(result.classification, "no_reliable_memory_found");
  assert.deepEqual(result.candidates.time_ranges, ["2025-07"]);
});
