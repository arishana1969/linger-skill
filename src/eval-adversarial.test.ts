import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateAdversarialDataset } from "./eval-adversarial.js";
import { runEvalDataset } from "./eval-runner.js";

test("adversarial fixture preserves scope, opt-out, and secret exclusion", async () => {
  const dataset = generateAdversarialDataset();
  const result = await runEvalDataset(await mkdtemp(path.join(os.tmpdir(), "continuity-adversarial-")), dataset);
  for (const prediction of result.predictions) {
    assert.equal(prediction.evidence_ids.includes("adv_other"), false);
    assert.equal(prediction.evidence_ids.includes("adv_secret"), false);
    assert.equal(prediction.evidence_ids.includes("adv_optout"), false);
  }
  assert.equal(result.scores.missing_predictions.length, 0);
  assert.equal(result.scores.macro_composite, 1);
});
