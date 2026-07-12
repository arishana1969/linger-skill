import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("keeps short assistant chatter in raw without creating processed memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-processing-short-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "assistant", content: "收到", sourceAgent: "test" });
  assert.deepEqual(await processQueue(root), { processed: 1, failed: 0 });
  assert.deepEqual(await search(root, { projectId: "p", query: "收到" }), []);
  const raw = await search(root, { projectId: "p", query: "收到", includeRaw: true });
  assert.equal(raw[0]?.match_type, "unprocessed_raw");
});

test("keeps short assistant decisions as durable processed evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-processing-short-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "assistant", content: "决定用 SQLite", sourceAgent: "test" });
  await processQueue(root);
  const hit = (await search(root, { projectId: "p", query: "SQLite" }))[0]!;
  assert.notEqual(hit.match_type, "unprocessed_raw");
});
