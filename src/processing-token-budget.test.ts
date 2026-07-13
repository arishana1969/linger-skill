import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { vaultStats } from "./vault.js";

test("defers later items when the estimated-token budget is exhausted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-processing-tokens-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "one", role: "user", content: `first-budget ${"a".repeat(400)}`, sourceAgent: "test" });
  await capture(root, { projectId: "p", sessionId: "s", turnId: "two", role: "user", content: `second-budget ${"b".repeat(400)}`, sourceAgent: "test" });
  assert.deepEqual(await processQueue(root, "p", 100, 110), { processed: 1, failed: 0 });
  assert.equal((await vaultStats(root)).queue_pending, 1);
  assert.deepEqual(await processQueue(root, "p", 100, 110), { processed: 1, failed: 0 });
  assert.equal((await vaultStats(root)).queue_pending, 0);
});

test("processes one oversized first item to avoid permanent starvation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-processing-tokens-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "large", role: "user", content: `oversized-budget ${"x".repeat(1000)}`, sourceAgent: "test" });
  assert.deepEqual(await processQueue(root, "p", 100, 10), { processed: 1, failed: 0 });
});
