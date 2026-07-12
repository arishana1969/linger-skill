import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { getDecisionTrail } from "./decisions.js";
import { processQueue } from "./processing.js";

test("automatic correction enters the append-only decision trail and becomes current", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-processing-correction-"));
  await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "Current adapter decision: webhooks", sourceAgent: "test", timestamp: "2025-01-01T00:00:00.000Z" });
  await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "Current adapter decision: polling", sourceAgent: "test", timestamp: "2025-02-01T00:00:00.000Z" });
  await capture(root, { projectId: "p", sessionId: "s3", turnId: "t3", role: "user", content: "Correction: current adapter decision is webhooks", sourceAgent: "test", timestamp: "2025-03-01T00:00:00.000Z" });
  await processQueue(root);
  const trail = await getDecisionTrail(root, "p", "adapter");
  assert.equal(trail?.events.length, 3);
  assert.equal(trail?.events.at(-1)?.kind, "correction");
  assert.match(trail?.view.current_state ?? "", /Correction.*webhooks/);
  assert.equal(trail?.view.conflicts.length, 0);
});
