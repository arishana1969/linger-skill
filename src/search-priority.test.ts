import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("user-explicit evidence wins within the same lexical match tier", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-search-priority-"));
  await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "priority-zephyr priority-zephyr priority-zephyr priority-zephyr inferred", sourceAgent: "test" });
  const explicit = await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "priority-zephyr explicit", sourceAgent: "test", explicit: true });
  await processQueue(root);
  const hits = await search(root, { projectId: "p", query: "priority-zephyr" });
  assert.equal(hits[0]?.raw_ref[0], explicit?.event_id);
  assert.match(hits[0]?.snippet ?? "", /explicit/);
});

test("exact inferred evidence still outranks a less relevant explicit candidate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-search-priority-"));
  const exact = await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "alpha beta inferred", sourceAgent: "test" });
  await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "alpha explicit candidate", sourceAgent: "test", explicit: true });
  await processQueue(root);
  const hits = await search(root, { projectId: "p", query: "alpha beta" });
  assert.equal(hits[0]?.raw_ref[0], exact?.event_id);
  assert.equal(hits[0]?.match_type, "exact_record");
});
