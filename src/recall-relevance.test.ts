import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { recall } from "./recall.js";

test("current recall follows the best-ranked decision instead of the newest unrelated decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-recall-relevance-"));
  await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "Current primary database decision: PostgreSQL because constraints matter.", sourceAgent: "test", timestamp: "2025-01-01T00:00:00.000Z" });
  await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "Current artifact storage decision: flat files because inspection matters.", sourceAgent: "test", timestamp: "2025-12-01T00:00:00.000Z" });
  await processQueue(root);
  const result = await recall(root, { projectId: "p", query: "What is the current primary database?" });
  assert.match(result.current_state ?? "", /PostgreSQL/);
  assert.equal(result.hits.length, 1);
  assert.match(result.hits[0]!.snippet, /primary database/);
});

test("distinctive absent English term does not match one generic query word", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-recall-relevance-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "Current artifact storage decision: flat files.", sourceAgent: "test" });
  await processQueue(root);
  const result = await recall(root, { projectId: "p", query: "Did we choose DynamoDB for primary storage?" });
  assert.equal(result.classification, "no_reliable_memory_found");
  assert.deepEqual(result.hits, []);
});
