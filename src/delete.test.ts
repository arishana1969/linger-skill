import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { deleteRecord } from "./delete.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("requires confirmation and deletes only the selected processed record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-delete-"));
  await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t1", role: "user", content: "删除测试内容", sourceAgent: "test" });
  await processQueue(root);
  const memory = (await search(root, { projectId: "p_test", query: "删除测试" }))[0]!;
  await assert.rejects(deleteRecord(root, { projectId: "p_test", target: "processed", id: memory.source, confirmed: false }), /confirmation/);
  const result = await deleteRecord(root, { projectId: "p_test", target: "processed", id: memory.source, confirmed: true });
  assert.equal(result.deleted, true);
  assert.equal((await search(root, { projectId: "p_test", query: "删除测试" })).length, 0);
});

test("deletes raw event by ID without accepting paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-delete-"));
  const event = await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t1", role: "user", content: "raw delete", sourceAgent: "test" });
  await deleteRecord(root, { projectId: "p_test", target: "raw", id: event!.event_id, confirmed: true });
  await assert.rejects(access(path.join(root, event!.raw_ref)));
  await assert.rejects(deleteRecord(root, { projectId: "p_test", target: "raw", id: "../../escape", confirmed: true }), /Invalid/);
});

test("invalid delete target cannot fall through to raw deletion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-delete-target-"));
  const event = await capture(root, { projectId: "p_test", sessionId: "s", turnId: "t", role: "user", content: "keep raw", sourceAgent: "test" });
  await assert.rejects(deleteRecord(root, { projectId: "p_test", target: "processd" as never, id: event!.event_id, confirmed: true }), /target must be processed or raw/);
  await access(path.join(root, event!.raw_ref));
});
