import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateHeldoutDataset } from "./eval-heldout.js";
import { runEvalDataset } from "./eval-runner.js";

test("held-out generator is deterministic, scalable, and spans a year", () => {
  const first = generateHeldoutDataset(2025, 240);
  assert.deepEqual(first, generateHeldoutDataset(2025, 240));
  assert.equal(first.events.length, 252);
  assert.equal(new Set(first.events.map(item => item.event_id)).size, first.events.length);
  assert.equal(first.events.some(item => item.savepoint_status === "partial"), true);
  assert.equal(first.oracle.some(item => item.forbidden_evidence.includes("ho_other_db")), true);
  assert.equal(first.mutations?.length, 2);
  assert.ok(Date.parse(first.end) - Date.parse(first.start) > 360 * 24 * 60 * 60 * 1000);
});

test("held-out fixture survives noise, near collisions, correction chains, and project isolation", async () => {
  const dataset = generateHeldoutDataset(2025, 240);
  const result = await runEvalDataset(await mkdtemp(path.join(os.tmpdir(), "linger-heldout-")), dataset);
  assert.equal(result.imported, dataset.events.length);
  assert.equal(result.scores.missing_predictions.length, 0);
  assert.equal(result.scores.macro_composite, 1);
  assert.deepEqual(result.predictions.find(item => item.query_id === "ho_q_partial")?.warning_flags, ["partial_source"]);
  assert.deepEqual(result.predictions.find(item => item.query_id === "ho_q_deleted")?.evidence_ids, []);
  assert.deepEqual(result.predictions.find(item => item.query_id === "ho_q_tampered")?.evidence_ids, []);
});
