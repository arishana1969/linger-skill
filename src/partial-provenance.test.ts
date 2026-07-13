import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("processed recall marks interrupted assistant evidence as partial", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-partial-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "assistant", content: "interrupted-zephyr tentative conclusion", sourceAgent: "test", savepointStatus: "partial" });
  await processQueue(root);
  const hit = (await search(root, { projectId: "p", query: "interrupted-zephyr" }))[0]!;
  assert.deepEqual(hit.warning_flags, ["partial_source"]);
  assert.ok(hit.confidence < 0.65);
});

test("unprocessed raw recall preserves the partial warning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-partial-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "assistant", content: "raw-partial-zephyr unfinished", sourceAgent: "test", savepointStatus: "partial" });
  const hit = (await search(root, { projectId: "p", query: "raw-partial-zephyr", includeRaw: true }))[0]!;
  assert.deepEqual(hit.warning_flags, ["unprocessed_raw", "partial_source"]);
  assert.ok(hit.confidence < 0.6);
});
