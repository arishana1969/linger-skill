import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { deleteLastRecord, deleteRecord } from "./delete.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("requires confirmation and deletes only the selected processed record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-delete-"));
  await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t1", role: "user", content: "删除测试内容", sourceAgent: "test" });
  await processQueue(root);
  const memory = (await search(root, { projectId: "p_test", query: "删除测试" }))[0]!;
  await assert.rejects(deleteRecord(root, { projectId: "p_test", target: "processed", id: memory.source, confirmed: false }), /confirmation/);
  const result = await deleteRecord(root, { projectId: "p_test", target: "processed", id: memory.source, confirmed: true });
  assert.equal(result.deleted, true);
  assert.equal((await search(root, { projectId: "p_test", query: "删除测试" })).length, 0);
});

test("deletes raw event by ID without accepting paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-delete-"));
  const event = await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t1", role: "user", content: "raw delete", sourceAgent: "test" });
  await deleteRecord(root, { projectId: "p_test", target: "raw", id: event!.event_id, confirmed: true });
  await assert.rejects(access(path.join(root, event!.raw_ref)));
  await assert.rejects(deleteRecord(root, { projectId: "p_test", target: "raw", id: "../../escape", confirmed: true }), /Invalid/);
});

test("invalid delete target cannot fall through to raw deletion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-delete-target-"));
  const event = await capture(root, { projectId: "p_test", sessionId: "s", turnId: "t", role: "user", content: "keep raw", sourceAgent: "test" });
  await assert.rejects(deleteRecord(root, { projectId: "p_test", target: "processd" as never, id: event!.event_id, confirmed: true }), /target must be processed or raw/);
  await access(path.join(root, event!.raw_ref));
});

test("delete last resolves only the latest record inside the requested project and layer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-delete-last-"));
  const first = await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "first retained", sourceAgent: "test", timestamp: "2025-01-01T00:00:00.000Z" });
  const second = await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "second deleted", sourceAgent: "test", timestamp: "2025-02-01T00:00:00.000Z" });
  const other = await capture(root, { projectId: "p_other", sessionId: "s", turnId: "t", role: "user", content: "other retained", sourceAgent: "test", timestamp: "2025-03-01T00:00:00.000Z" });
  await assert.rejects(deleteLastRecord(root, { projectId: "p", target: "raw", confirmed: false }), /confirmation/);
  const deleted = await deleteLastRecord(root, { projectId: "p", target: "raw", confirmed: true });
  assert.equal(deleted.id, second?.event_id);
  await access(path.join(root, first!.raw_ref));
  await assert.rejects(access(path.join(root, second!.raw_ref)));
  await access(path.join(root, other!.raw_ref));
});

test("delete last reports an empty project without broadening scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-delete-last-empty-"));
  await assert.rejects(deleteLastRecord(root, { projectId: "p", target: "processed", confirmed: true }), /No processed records/);
  await assert.rejects(deleteLastRecord(root, { projectId: "p", target: "raw", confirmed: true }), /No raw records/);
});

test("delete last processed uses record creation time and preserves the older memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-delete-last-processed-"));
  await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "older-alpha memory", sourceAgent: "test", timestamp: "2025-01-01T00:00:00.000Z" });
  await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "newer-beta memory", sourceAgent: "test", timestamp: "2025-02-01T00:00:00.000Z" });
  await processQueue(root);
  const newer = (await search(root, { projectId: "p", query: "newer-beta" }))[0]!.source;
  const deleted = await deleteLastRecord(root, { projectId: "p", target: "processed", confirmed: true });
  assert.equal(deleted.id, newer);
  assert.equal((await search(root, { projectId: "p", query: "newer-beta" })).length, 0);
  assert.equal((await search(root, { projectId: "p", query: "older-alpha" })).length, 1);
});
