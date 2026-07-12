import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDecision } from "./decisions.js";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { processQueue } from "./processing.js";
import { processingDecision, recordProcessingRun } from "./processing-policy.js";
import { quarantineInvalidFiles } from "./repair.js";
import { search } from "./search.js";

test("filesystem-routing entry points reject unsafe project IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-path-security-"));
  await assert.rejects(search(root, { projectId: "../outside", query: "secret" }), /Invalid project id/);
  await assert.rejects(processQueue(root, "../outside"), /Invalid project id/);
  await assert.rejects(processingDecision(root, "../outside", "manual"), /Invalid project id/);
  await assert.rejects(recordProcessingRun(root, "../outside"), /Invalid project id/);
});

test("path-traversing queue identity is invalid, inert, and repairable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-path-security-"));
  const p = vaultPaths(root);
  const file = path.join(p.queue, "p", "poison.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    schema_version: 1,
    task_id: "task_poison",
    event_id: "evt_poison",
    project_id: "../outside",
    priority: "explicit",
    status: "pending",
    attempts: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));
  assert.deepEqual(await processQueue(root), { processed: 0, failed: 0 });
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_queue:")), true);
  const repaired = await quarantineInvalidFiles(root);
  assert.equal(repaired.quarantined.some(item => item.includes("queue")), true);
  assert.equal((await doctor(root)).ok, true);
});

test("safe but cross-project queue identity cannot broaden a scoped processing run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-path-security-"));
  const p = vaultPaths(root);
  const file = path.join(p.queue, "p_alpha", "task_cross.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    schema_version: 1, task_id: "task_cross", event_id: "evt_cross", project_id: "p_beta", priority: "explicit", status: "pending", attempts: 0,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z"
  }));
  assert.deepEqual(await processQueue(root, "p_alpha"), { processed: 0, failed: 0 });
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_queue:")), true);
});

test("cross-project processed record is excluded from recall and diagnosed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-path-security-"));
  await capture(root, { projectId: "p_alpha", sessionId: "s", turnId: "t", role: "user", content: "scope-sentinel durable note", sourceAgent: "test" });
  await processQueue(root, "p_alpha");
  const initial = await search(root, { projectId: "p_alpha", query: "scope-sentinel" });
  const file = path.join(vaultPaths(root).processed, "p_alpha", `${initial[0]!.source}.json`);
  const memory = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  memory.project_id = "p_beta";
  await writeFile(file, JSON.stringify(memory));
  assert.deepEqual(await search(root, { projectId: "p_alpha", query: "scope-sentinel" }), []);
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_processed:")), true);
});

test("timestamps that could alter a decision filename are rejected before persistence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-path-security-"));
  await assert.rejects(appendDecision(root, {
    projectId: "p", topic: "runtime", kind: "decision", status: "current", statement: "Use Node", source: "user_explicit", confidence: 1,
    evidenceRefs: ["evt_visible"], timestamp: "2026-01-01T00:00:00.000Z/../../escape"
  }), /Invalid decision event timestamp/);
});
