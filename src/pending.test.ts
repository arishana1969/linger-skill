import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stagePending, recoverPending, type PendingCapture } from "./pending.js";
import { vaultPaths } from "./paths.js";

test("recovers staged raw event and persistent queue item", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-pending-"));
  const p = vaultPaths(root);
  const raw = path.join(p.raw, "p_test", "s1", "evt_pending.json");
  const queue = path.join(p.queue, "p_test", "task_pending.json");
  const pending: PendingCapture = {
    schema_version: 1, pending_id: "pending_evt", raw_file: raw, queue_file: queue, created_at: "2026-01-01T00:00:00.000Z",
    event: { schema_version: 1, event_id: "evt_pending", session_id: "s1", project_id: "p_test", seq_id: 1, turn_id: "t1", role: "user", timestamp: "2026-01-01T00:00:00.000Z", source_agent: "test", content: "recover me", content_hash: "hash", savepoint_status: "pending", capture_status: "captured", sensitivity: "normal", raw_ref: "raw/p_test/s1/evt_pending.json" },
    queue_item: { schema_version: 1, task_id: "task_pending", event_id: "evt_pending", project_id: "p_test", priority: "normal", status: "pending", attempts: 0, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }
  };
  const pendingFile = await stagePending(root, pending);
  assert.deepEqual(await recoverPending(root), { recovered: 1, failed: [] });
  await access(raw);
  await access(queue);
  await assert.rejects(access(pendingFile));
});

test("refuses malicious pending paths before staging", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-pending-"));
  const p = vaultPaths(root);
  const pending = {
    schema_version: 1, pending_id: "bad", raw_file: path.join(root, "..", "escape.json"), queue_file: path.join(p.queue, "p", "q.json"), created_at: new Date().toISOString(),
    event: { schema_version: 1, event_id: "evt", session_id: "s", project_id: "p", seq_id: 1, turn_id: "t", role: "user", timestamp: new Date().toISOString(), source_agent: "test", content: "x", content_hash: "x", savepoint_status: "pending", capture_status: "captured", sensitivity: "normal", raw_ref: "x" },
    queue_item: { schema_version: 1, task_id: "q", event_id: "evt", project_id: "p", priority: "normal", status: "pending", attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  } as PendingCapture;
  await assert.rejects(stagePending(root, pending), /Pending raw path mismatch/);
});

test("recovery refuses a compromised pending record that targets another Vault file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-pending-"));
  const p = vaultPaths(root);
  const config = path.join(root, "config.json");
  await writeFile(config, "keep-config");
  const pending = {
    schema_version: 1, pending_id: "bad", raw_file: config, queue_file: path.join(p.queue, "p", "q.json"), created_at: new Date().toISOString(),
    event: { schema_version: 1, event_id: "evt", session_id: "s", project_id: "p", seq_id: 1, turn_id: "t", role: "user", timestamp: new Date().toISOString(), source_agent: "test", content: "x", content_hash: "x", savepoint_status: "pending", capture_status: "captured", sensitivity: "normal", raw_ref: "raw/p/s/evt.json" },
    queue_item: { schema_version: 1, task_id: "q", event_id: "evt", project_id: "p", priority: "normal", status: "pending", attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  } as PendingCapture;
  const staged = path.join(p.tmp, "pending", "p", "bad.json");
  await mkdir(path.dirname(staged), { recursive: true });
  await writeFile(staged, JSON.stringify(pending));
  const result = await recoverPending(root);
  assert.equal(result.recovered, 0);
  assert.match(result.failed[0]?.error ?? "", /Pending raw path mismatch/);
  assert.equal(await readFile(config, "utf8"), "keep-config");
  await access(staged);
});
