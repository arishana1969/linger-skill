import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateYearDataset } from "./eval-generator.js";
import { runEvalDataset } from "./eval-runner.js";

test("runs year fixture through real vault without oracle leakage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-eval-run-"));
  const dataset = generateYearDataset(2025);
  const result = await runEvalDataset(root, dataset);
  assert.equal(result.imported, dataset.events.length - 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.predictions.length, dataset.oracle.length);
  assert.equal(result.predictions.flatMap(value => value.evidence_ids).includes("evt_other_pg"), false);
  assert.equal(result.scores.missing_predictions.length, 0);
  assert.ok(result.scores.macro_composite >= 0 && result.scores.macro_composite <= 1);
});
