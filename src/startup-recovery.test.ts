import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleHook } from "./hook-handler.js";
import { stagePending, type PendingCapture } from "./pending.js";
import { vaultPaths } from "./paths.js";
import { search } from "./search.js";
import { projectId } from "./vault.js";

test("SessionStart recovers pending capture before processing queue", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-startup-vault-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "continuity-startup-project-"));
  const project = await projectId(cwd);
  const p = vaultPaths(root);
  const timestamp = new Date().toISOString();
  const content = "启动时恢复数据库决策";
  const pending: PendingCapture = {
    schema_version: 1, pending_id: "evt_startup", raw_file: path.join(p.raw, project, "s1", "evt_startup.json"), queue_file: path.join(p.queue, project, "task_startup.json"), sequence_file: path.join(p.registry, `${project}.sequence.json`), sequence_value: 1, created_at: timestamp,
    event: { schema_version: 1, event_id: "evt_startup", session_id: "s1", project_id: project, seq_id: 1, turn_id: "t1", role: "user", timestamp, source_agent: "test", content, content_hash: createHash("sha256").update(content).digest("hex"), savepoint_status: "pending", capture_status: "captured", sensitivity: "normal", raw_ref: path.relative(p.root, path.join(p.raw, project, "s1", "evt_startup.json")) },
    queue_item: { schema_version: 1, task_id: "task_startup", event_id: "evt_startup", project_id: project, priority: "normal", status: "pending", attempts: 0, created_at: timestamp, updated_at: timestamp }
  };
  await stagePending(root, pending);
  const result = await handleHook(root, { hook_event_name: "SessionStart", session_id: "s1", cwd }, "codex");
  assert.equal(result.recovered, 1);
  assert.equal(result.processed, 1);
  assert.match((await search(root, { projectId: project, query: "恢复数据库" }))[0]?.snippet ?? "", /启动时恢复/);
});
