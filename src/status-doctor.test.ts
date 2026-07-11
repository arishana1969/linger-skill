import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { processQueue } from "./processing.js";
import { vaultPaths } from "./paths.js";
import { vaultStats } from "./vault.js";

test("status reports actionable queue counts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-status-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-status-"));
  const file = path.join(vaultPaths(root).tmp, "pending", "p", "broken.json");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "not json");
  const report = await doctor(root);
  assert.equal(report.ok, false);
  assert.match(report.errors[0] ?? "", /invalid_pending/);
});
