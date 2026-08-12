import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { processQueue } from "./processing.js";
import { vaultPaths } from "./paths.js";
import { vaultStats } from "./vault.js";

test("status reports actionable queue counts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-status-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "status", sourceAgent: "test" });
  let status = await vaultStats(root);
  assert.equal(status.queue_pending, 1);
  assert.equal(status.pending_captures, 0);
  await processQueue(root);
  status = await vaultStats(root);
  assert.equal(status.queue_done, 1);
  assert.equal(status.queue_pending, 0);
});

test("doctor reports invalid pending without crashing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-status-"));
  const file = path.join(vaultPaths(root).tmp, "pending", "p", "broken.json");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "not json");
  const report = await doctor(root);
  assert.equal(report.ok, false);
  assert.equal(report.errors.some(error => error.startsWith("invalid_pending:")), true);
});

test("status and doctor do not initialize an absent Vault", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "linger-status-readonly-"));
  const root = path.join(parent, "absent");
  const status = await vaultStats(root, "p_current");
  assert.equal(status.initialized, false);
  assert.equal(status.scope, "project");
  assert.equal(status.raw_events, 0);
  assert.equal((await doctor(root)).errors.includes("invalid_vault_config:config.json"), true);
  await assert.rejects(access(root));
});

test("project status excludes records from other projects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-status-scope-"));
  await capture(root, { projectId: "p_one", sessionId: "s", turnId: "one", role: "user", content: "one", sourceAgent: "test" });
  await capture(root, { projectId: "p_two", sessionId: "s", turnId: "two", role: "user", content: "two", sourceAgent: "test" });
  const status = await vaultStats(root, "p_one");
  assert.equal(status.raw_events, 1);
  assert.equal(status.queue_pending, 1);
});
